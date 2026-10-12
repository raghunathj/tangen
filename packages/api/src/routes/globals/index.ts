/**
 * File Name: index.ts
 * Purpose: CRUD routes for named global data stores — flat key-value blobs
 *   shared across a workspace environment, consumed by the SDK's globals() API.
 *   Supports listing definitions, reading, full-replace (PUT), and merge (PATCH).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, drizzle-orm, @tangen/db, Node.js crypto,
 *   services/globals-media (media expands on read and folds on write at every
 *   position the global's definition declares, like an object read does).
 */
import { Elysia } from 'elysia'
import { eq, and } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { globals } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { assertGlobalsPermission } from '../../lib/permissions'
import { canWriteLocale } from '../../lib/field-access'
import { resolveLocaleParam, projectLocalization, localizeGlobalData, mergeGlobalLocaleData } from '../../services/i18n'
import { expandGlobalMedia, collapseGlobalMedia, globalDefinitionsOf, componentRegistryOf } from '../../services/globals-media'

/**
 * Registers GET /api/v1/globals, GET /api/v1/globals/:name,
 * PUT /api/v1/globals/:name, and PATCH /api/v1/globals/:name.
 * Access is admin session OR an API key with the matching globals scope
 * (`read` for GET, `write` for PUT/PATCH) — see assertGlobalsPermission.
 * PUT performs a full data replace; PATCH shallow-merges the incoming object
 * onto the existing data. Both upsert the row when it does not yet exist.
 * @param app - Elysia application instance
 * @returns The mutated Elysia app with all global-store routes registered
 */
export const globalsRoutes = (app: Elysia) =>
  app
    // GET /api/v1/globals — list all defined globals (definitions only, no data)
    .get('/api/v1/globals', async (ctx: any) => {
      const { workspaceId, workspaceProjects } = ctx
      assertGlobalsPermission(ctx.permissions, 'read')
      const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
      const defs = project?.config?.globals ?? project?.globals ?? []
      return { data: defs }
    })

    // GET /api/v1/globals/:name
    .get('/api/v1/globals/:name', async (ctx: any) => {
      const { params, query, db, workspaceId, workspaceProjects } = ctx
      const name = params.name as string
      assertGlobalsPermission(ctx.permissions, 'read', name)

      const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
      const def = globalDefinitionsOf(project).find((g: any) => g.name === name)
      if (!def) throw new RequestError('NOT_FOUND', `Global "${name}" is not defined in the workspace config`, 404)

      const rows = await db
        .select({ data: globals.data })
        .from(globals)
        .where(and(eq(globals.workspaceId, workspaceId), eq(globals.name, name)))
        .limit(1)

      const stored = (rows[0]?.data ?? {}) as Record<string, unknown>
      const locale = resolveLocaleParam(query?.locale, projectLocalization(project), true)
      // Media expands exactly like an object read: at the top level and inside
      // the blocks a surface holds, in one asset query, after the locale overlay
      // so the translated value is what expands. locale=all hands the whole blob
      // over with every __i18n section expanded beside the defaults.
      const registry = componentRegistryOf(project)
      const localized = locale === 'all' ? stored : localizeGlobalData(stored, locale)
      const data = await expandGlobalMedia(localized, def, registry, db, workspaceId, locale === 'all' ? null : locale)
      return { data, definition: def }
    })

    // PUT /api/v1/globals/:name — full replace (SDK set())
    .put('/api/v1/globals/:name', async (ctx: any) => {
      const { params, body, db, workspaceId, workspaceProjects } = ctx
      const name = params.name as string
      assertGlobalsPermission(ctx.permissions, 'write', name)

      const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
      const def = globalDefinitionsOf(project).find((g: any) => g.name === name)
      if (!def) throw new RequestError('NOT_FOUND', `Global "${name}" is not defined in the workspace config`, 404)
      if (!canWriteLocale(ctx, null, projectLocalization(project)?.defaultLocale)) {
        throw new RequestError('FORBIDDEN', 'Your role can only edit specific languages - base content is locked', 403)
      }

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new RequestError('VALIDATION_ERROR', 'Request body must be an object', 422)
      }
      if (ctx.query?.locale) {
        throw new RequestError('VALIDATION_ERROR', 'PUT replaces the whole store - use PATCH with ?locale= for translations', 422)
      }

      // An echoed expanded read folds back to ids: the blob stores asset ids, never a snapshot.
      const data = collapseGlobalMedia(body as Record<string, unknown>, def, componentRegistryOf(project))
      const existing = await db
        .select({ id: globals.id })
        .from(globals)
        .where(and(eq(globals.workspaceId, workspaceId), eq(globals.name, name)))
        .limit(1)

      if (existing[0]) {
        await db
          .update(globals)
          .set({ data, updatedAt: new Date() })
          .where(eq(globals.id, existing[0].id))
      } else {
        await db.insert(globals).values({
          id: randomBytes(12).toString('hex'),
          name,
          workspaceId,
          data,
          updatedAt: new Date(),
        })
      }

      return { data }
    })

    // PATCH /api/v1/globals/:name
    .patch('/api/v1/globals/:name', async (ctx: any) => {
      const { params, body, db, workspaceId, workspaceProjects } = ctx
      const name = params.name as string
      assertGlobalsPermission(ctx.permissions, 'write', name)

      const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
      const def = globalDefinitionsOf(project).find((g: any) => g.name === name)
      if (!def) throw new RequestError('NOT_FOUND', `Global "${name}" is not defined in the workspace config`, 404)

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new RequestError('VALIDATION_ERROR', 'Request body must be an object', 422)
      }
      // A locale patch mirrors the top-level keys, so the same field list folds it.
      const patch = collapseGlobalMedia(body as Record<string, unknown>, def, componentRegistryOf(project))

      const existing = await db
        .select({ id: globals.id, data: globals.data })
        .from(globals)
        .where(and(eq(globals.workspaceId, workspaceId), eq(globals.name, name)))
        .limit(1)

      const current = (existing[0]?.data as Record<string, unknown>) ?? {}
      const patchLocale = resolveLocaleParam(ctx.query?.locale, projectLocalization(project), true)
      if (patchLocale === 'all') {
        throw new RequestError('VALIDATION_ERROR', 'locale=all is read-only - write one locale at a time', 422)
      }
      if (!canWriteLocale(ctx, patchLocale ?? null, projectLocalization(project)?.defaultLocale)) {
        throw new RequestError('FORBIDDEN',
          patchLocale ? `Your role cannot edit ${patchLocale} content` : 'Your role can only edit specific languages - base content is locked', 403)
      }
      const merged = patchLocale
        ? mergeGlobalLocaleData(current, patchLocale, patch)
        : { ...current, ...patch }

      if (existing[0]) {
        await db
          .update(globals)
          .set({ data: merged, updatedAt: new Date() })
          .where(eq(globals.id, existing[0].id))
      } else {
        await db.insert(globals).values({
          id: randomBytes(12).toString('hex'),
          name,
          workspaceId,
          data: merged,
          updatedAt: new Date(),
        })
      }

      return { data: merged }
    })
