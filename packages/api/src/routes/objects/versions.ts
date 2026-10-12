/**
 * File Name: versions.ts
 * Purpose: Elysia route plugin for listing, fetching, and restoring content object revision history.
 *          Supports listing versions with actor labels, retrieving a single snapshot, and restoring a past version.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires @tangen/db revisions, contentTables, and members tables;
 *                     restore also re-applies extension data (e.g. SEO metadata) from the snapshot.
 */
import { eq, and, desc, sql, inArray } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { revisions, members } from '@tangen/db'
import { contentTables } from '@tangen/db/content-tables'
import { RequestError } from '../../lib/errors'
import { jsonbParam, textArrayParam } from '../../lib/sql-values'
import { assertObjectPermission } from '../../lib/permissions'
import { canWriteLocale } from '../../lib/field-access'
import { projectLocalization } from '../../services/i18n'
import { createRevision } from '../../lib/revisions'
import { createExtensionDataStore } from '../../hooks/runner'
import { isSafeIdent } from '@tangen/types'

/**
 * Elysia plugin providing list, get, and restore endpoints for content object revision history.
 * @returns Elysia plugin function
 */
export const objectVersionsRoute = (app: Elysia) =>
  app

    // List versions for an object (excludes the most recent, which is the current live state)
    .get('/api/v1/objects/:id/versions', async (ctx: any) => {
      const { params, query, db, workspaceId, schema, permissions } = ctx
      const { id } = params
      const typeName = query.type as string

      if (!typeName) throw new RequestError('VALIDATION_ERROR', 'type query param is required')
      assertObjectPermission(permissions, 'read', typeName)

      const typeDef = schema.types.find((t: any) => t.name === typeName)
      const maxVersions: number = (typeDef?.admin as any)?.versioning?.maxVersions ?? 10

      const rows = await db
        .select({
          id: revisions.id,
          version: revisions.version,
          versionType: revisions.versionType,
          createdAt: revisions.createdAt,
          createdBy: revisions.createdBy,
          snapshot: revisions.snapshot,
        })
        .from(revisions)
        .where(and(
          eq(revisions.objectId, id),
          eq(revisions.workspaceId, workspaceId),
          ))
        .orderBy(desc(revisions.createdAt))
        .limit(maxVersions)

      // Look up member names for any member-created revisions
      const actorIds = [...new Set(
        rows.map((r: any) => r.createdBy as string | null).filter(Boolean),
      )] as string[]
      const memberMap = new Map<string, { name: string | null; email: string }>()
      if (actorIds.length > 0) {
        const memberRows = await db
          .select({ id: members.id, name: members.name, email: members.email })
          .from(members)
          .where(inArray(members.id, actorIds))
        for (const m of memberRows) memberMap.set(m.id, { name: m.name, email: m.email })
      }

      return {
        data: rows.map((r: any) => {
          const actorId = r.createdBy as string | null
          const memberInfo = actorId ? memberMap.get(actorId) : undefined
          return {
            id: r.id,
            version: r.version,
            versionType: r.versionType as string | null,
            createdAt: r.createdAt,
            createdBy: actorId,
            createdByType: memberInfo ? 'member' as const : (actorId ? 'api_key' as const : null),
            createdByLabel: memberInfo ? (memberInfo.name ?? memberInfo.email) : null,
            title: (r.snapshot as any)?.title ?? null,
          }
        }),
      }
    })

    // Get a single version's full snapshot
    .get('/api/v1/objects/:id/versions/:versionId', async (ctx: any) => {
      const { params, query, db, workspaceId, permissions } = ctx
      const { id, versionId } = params
      const typeName = query.type as string

      if (!typeName) throw new RequestError('VALIDATION_ERROR', 'type query param is required')
      assertObjectPermission(permissions, 'read', typeName)

      const rows = await db
        .select()
        .from(revisions)
        .where(and(
          eq(revisions.id, versionId),
          eq(revisions.objectId, id),
          eq(revisions.workspaceId, workspaceId),
        ))
        .limit(1)

      if (!rows.length) throw new RequestError('NOT_FOUND', 'Version not found', 404)
      return { data: rows[0] }
    })

    // Restore a version — copies snapshot back to the live object
    .post('/api/v1/objects/:id/versions/:versionId/restore', async (ctx: any) => {
      const { params, query, db, redis, workspaceId, schema, permissions, apiKeyId, memberId, eventBus } = ctx
      const { id, versionId } = params
      const typeName = query.type as string

      if (!typeName) throw new RequestError('VALIDATION_ERROR', 'type query param is required')
      assertObjectPermission(permissions, 'write', typeName)
      // Locale-scoped roles cannot publish/restore/bulk-write — base rights required
      {
        const project = (ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)
        if (!canWriteLocale(ctx, null, projectLocalization(project)?.defaultLocale)) {
          throw new RequestError('FORBIDDEN', 'Your role can only edit specific languages - this action needs base-language rights', 403)
        }
      }


      const typeDef = schema.types.find((t: any) => t.name === typeName)
      if (!typeDef || typeDef.disabled) throw new RequestError('NOT_FOUND', `Type "${typeName}" not found`, 404)

      const table = (contentTables as Record<string, any>)[typeName]
      if (!table) throw new RequestError('NOT_FOUND', `Table for type "${typeName}" not generated`, 404)

      // Load the revision
      const revRows = await db
        .select()
        .from(revisions)
        .where(and(
          eq(revisions.id, versionId),
          eq(revisions.objectId, id),
          eq(revisions.workspaceId, workspaceId),
        ))
        .limit(1)

      if (!revRows.length) throw new RequestError('NOT_FOUND', 'Version not found', 404)
      const maxVersions: number = (typeDef?.admin as any)?.versioning?.maxVersions ?? 10

      const snap = revRows[0].snapshot as {
        title?: string | null
        slug?: string | null
        values?: Record<string, unknown>
        extensionData?: Record<string, Record<string, unknown>>
      }
      const fieldValues = snap.values ?? {}
      const knownFields = new Set(typeDef.fields.map((f: any) => f.name))
      const multiselectFields = new Set(
        typeDef.fields.filter((f: any) => f.fieldType === 'multiselect').map((f: any) => f.name)
      )
      // JSONB-backed columns by field type: a richtext body can be a bare string,
      // which must still be written as jsonb (not a plain param). See update.ts.
      const jsonbFields = new Set(
        typeDef.fields.filter((f: any) => ['richtext', 'component', 'repeater', 'json'].includes(f.fieldType)).map((f: any) => f.name)
      )

      // Build SET pairs from snapshot — only known schema fields
      const setClauses: ReturnType<typeof sql>[] = [
        sql`updated_at = NOW()`,
      ]
      if (snap.title != null) setClauses.push(sql`title = ${snap.title}`)
      if (snap.slug != null) setClauses.push(sql`slug = ${snap.slug}`)

      for (const [k, v] of Object.entries(fieldValues)) {
        if (!knownFields.has(k)) continue
        if (!isSafeIdent(k)) continue
        const col = sql.raw(`"${k}"`)
        if (Array.isArray(v)) {
          const isTextArray = multiselectFields.has(k)
          const isPrimitive = !isTextArray && (v as unknown[]).length > 0 && (v as unknown[]).every(x => x === null || typeof x !== 'object')
          if (isTextArray || isPrimitive) {
            setClauses.push(sql`${col} = ${textArrayParam(v as unknown[])}`)
          } else {
            setClauses.push(sql`${col} = ${jsonbParam(v)}`)
          }
        } else if (jsonbFields.has(k) || (v !== null && typeof v === 'object')) {
          const jsonVal = v === '' || v === undefined ? null : v
          setClauses.push(sql`${col} = ${jsonbParam(jsonVal)}`)
        } else {
          setClauses.push(sql`${col} = ${v}`)
        }
      }

      const result = await db.execute(
        sql`UPDATE ${table} SET ${sql.join(setClauses, sql.raw(', '))} WHERE id = ${id} AND workspace_id = ${workspaceId} RETURNING *`
      )
      const rows = (Array.isArray(result) ? result : (result as any).rows ?? []) as Record<string, unknown>[]
      if (!rows.length) throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)

      // Restore extension data from the snapshot (e.g. SEO metadata) for extensions that opted in
      if (snap.extensionData) {
        const extDataStore = createExtensionDataStore(db, workspaceId, redis)
        for (const [extId, data] of Object.entries(snap.extensionData)) {
          await extDataStore.set(extId, id, data)
        }
      }

      // Create a revision for the restore action itself, carrying the same extension data
      await createRevision(db, {
        objectId: id, workspaceId, typeId: typeDef.id ?? typeName, typeName,
        row: rows[0], createdBy: memberId ?? apiKeyId ?? null, maxVersions,
        extDataSnapshot: snap.extensionData,
      })

      eventBus.emit({
        id: crypto.randomUUID(),
        type: 'object.updated',
        workspaceId,
        timestamp: new Date().toISOString(),
        payload: { objectId: id, typeId: typeDef.id ?? typeName, typeSlug: typeName, slug: (rows[0] as Record<string, unknown>).slug ?? null, changedFields: ['*'], updatedBy: memberId ?? apiKeyId ?? null },
      })

      return { data: { ...rows[0], type: typeName } }
    })
