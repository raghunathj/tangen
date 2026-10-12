/**
 * File Name: runs.ts
 * Purpose: Porter runs API (M-T3) - create + enqueue a background run,
 *   list/inspect runs, cancel, and download the results ledger as JSONL or
 *   CSV. Gated like every sync operation (schema:migrate until porter:*
 *   capabilities land in P-T2) with workspace env scoping.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: ctx.porterEnqueue / ctx.porterStorage are seams -
 *   tests decorate them; production leaves them undefined and the defaults
 *   (jobs-system enqueue, workspace porter storage) apply. The field-level
 *   schema guard runs at CREATE time so a run never starts doomed.
 */
import { porterProviderScope } from '../../services/extension-server'
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { randomBytes } from 'node:crypto'
import { tarGzBundle, importBundleFromTarGz, openBundleReader } from '@tangen/porter'
import { validateBundleAgainstEnv } from '../../services/porter-import'
import { eq, and } from 'drizzle-orm'
import { mediaAssets } from '@tangen/db'
import {
  createRun, getRun, listRuns, requestCancel, readRunResults, recordCompletedRun,
} from '../../services/migration-runs'
import { enqueuePorterRun, resolvePorterStorage } from '../../services/migration-run-worker'
import { resolvePorterLimits, computeMediaInventory, checkLimits } from '../../services/porter-limits'
import { resolveWorkspaceProviders, getWorkspaceProvider, sortProvidersByDependency } from '../../services/porter-providers'
import { porterActivePredicate } from '../../services/extension-server'
import { selectObjectsForMigration, type MigrationSelectFilter } from '../../services/porter-select'
import { contentTables } from '@tangen/db/content-tables'

const RUN_KINDS = new Set(['export', 'import', 'remote_send'])

const CSV_COLUMNS = ['objectId', 'outcome', 'title', 'slug', 'error', 'replacedObjectId'] as const

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Porter's own rights: reads need porter:read, writes porter:write
// (write implies read via the extension manifest; owners/admins pass via
// the platform role fast path).
function gateRead(ctx: any): void {
  if (!ctx.memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)
  requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'porter:read')
}
function gateWrite(ctx: any): void {
  if (!ctx.memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)
  requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'porter:write')
}

export const syncRunsRoutes = (app: Elysia) =>
  app
    .post('/api/v1/sync/runs', async (ctx: any) => {
      const { db, workspaceId, body, set } = ctx
      gateWrite(ctx)

      const kind = (body?.kind as string | undefined)?.trim()
      const typeName = (body?.typeName as string | undefined)?.trim()
      const objectIds = body?.objectIds

      if (!kind || !RUN_KINDS.has(kind)) {
        throw new RequestError('VALIDATION_ERROR', `kind must be one of: ${[...RUN_KINDS].join(', ')}`, 422)
      }

      // ── import: apply an uploaded bundle to the target env ──────────────
      if (kind === 'import') {
        const bundleId = (body?.bundleId as string | undefined)?.trim()
        if (!bundleId) throw new RequestError('VALIDATION_ERROR', 'bundleId is required', 422)

        const importProject = ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === workspaceId)
        const importStorage = ctx.porterStorage ?? resolvePorterStorage(importProject)
        const reader = await openBundleReader(importStorage, bundleId)
        const validation = await validateBundleAgainstEnv(db, reader.manifest)
        if (!validation.ok) {
          throw new RequestError('VALIDATION_ERROR', `Bundle schema is out of sync with the target: ${validation.blockers.map((b) => b.typeName).join(', ')}`, 422)
        }
        const totalItems = Object.entries(reader.manifest.counts)
          .filter(([k]) => k.startsWith('objects/'))
          .reduce((n, [, c]) => n + (c as number), 0)

        // Provider sections must be applicable on THIS instance too.
        const importActive = await porterActivePredicate(workspaceId)
        const importProviderMisses = Object.keys(reader.manifest.sections ?? {})
          .filter((s2: string) => s2.startsWith('providers/'))
          .map((s2: string) => s2.slice('providers/'.length))
          .filter((key: string) => !getWorkspaceProvider(importProject, key, importActive))
        if (importProviderMisses.length > 0) {
          throw new RequestError('VALIDATION_ERROR',
            `This instance has no provider for: ${importProviderMisses.join(', ')} - install the extension or define the table (with porter.matchBy) first`, 422)
        }

        const importLimits = resolvePorterLimits()
        if (totalItems > importLimits.maxItems) {
          throw new RequestError('VALIDATION_ERROR',
            `Transfer exceeds limits: ${totalItems.toLocaleString()} items exceeds the limit of ${importLimits.maxItems.toLocaleString()} per run`, 422)
        }

        const run = await createRun(db, {
          workspaceId,
          kind: 'import',
          scope: { bundleId, options: body?.options ?? { identityMode: 'match', statusMode: 'preserve' } },
          totalItems,
          createdBy: ctx.memberId,
        })
        const importEnqueue = ctx.porterEnqueue ?? undefined
        await enqueuePorterRun(
          { workspaceId, runId: run.id },
          ...(importEnqueue ? [importEnqueue] : []),
        )
        set.status = 201
        return { data: run }
      }

      // ── remote send: stream a bundle to another instance (Arc R) ────────
      if (kind === 'remote_send') {
        const bundleId = (body?.bundleId as string | undefined)?.trim()
        const receiverUrl = (body?.receiverUrl as string | undefined)?.trim()?.replace(/\/+$/, '')
        const code = (body?.code as string | undefined)?.trim()
        if (!bundleId || !receiverUrl || !code) {
          throw new RequestError('VALIDATION_ERROR', 'bundleId, receiverUrl and code are required', 422)
        }
        if (!/^https?:\/\//.test(receiverUrl)) {
          throw new RequestError('VALIDATION_ERROR', 'receiverUrl must be an http(s) URL', 422)
        }

        const sendProject = ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === workspaceId)
        const sendStorage = ctx.porterStorage ?? resolvePorterStorage(sendProject)
        const manifestBytes = await sendStorage.read(`porter/bundles/${bundleId}/manifest.json`)
        if (!manifestBytes) {
          throw new RequestError('VALIDATION_ERROR', `Bundle ${bundleId} not found - export first`, 422)
        }

        // Redeem NOW, while the human who dictated the code is present -
        // a wrong code fails here, not minutes later inside a worker.
        let token: string
        try {
          const res = await fetch(`${receiverUrl}/api/v1/porter/receive/redeem`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code, senderLabel: `tangen:${workspaceId}` }),
          })
          const payload = await res.json().catch(() => ({}))
          if (!res.ok) {
            throw new Error((payload as any)?.error?.message ?? (payload as any)?.message ?? `HTTP ${res.status}`)
          }
          token = (payload as any).data.token
        } catch (err: any) {
          throw new RequestError('VALIDATION_ERROR', `The receiver rejected the code: ${String(err?.message ?? err)}`, 422)
        }

        const run = await createRun(db, {
          workspaceId,
          kind: 'remote_send',
          scope: {
            bundleId,
            receiverUrl,
            token,
            senderLabel: `tangen:${workspaceId}`,
            ...(body?.options ? { options: body.options } : {}),
          },
          totalItems: 0,
          createdBy: ctx.memberId,
        })
        const sendEnqueue = ctx.porterEnqueue ?? undefined
        await enqueuePorterRun(
          { workspaceId, runId: run.id },
          ...(sendEnqueue ? [sendEnqueue] : []),
        )
        set.status = 201
        return { data: run }
      }

      // ── export: scoped bundle of the source env, no target ──────────────
      if (kind === 'export') {
        const scope = (body?.scope ?? {}) as Record<string, unknown>
        const run = await createRun(db, {
          workspaceId,
          kind: 'export',
          scope: { ...scope, bundleId: `bnd_${randomBytes(8).toString('hex')}` },
          totalItems: 0,
          createdBy: ctx.memberId,
        })
        const exportEnqueue = ctx.porterEnqueue ?? undefined
        await enqueuePorterRun(
          { workspaceId, runId: run.id },
          ...(exportEnqueue ? [exportEnqueue] : []),
        )
        set.status = 201
        return { data: run }
      }


      throw new RequestError('VALIDATION_ERROR', `kind must be one of: ${[...RUN_KINDS].join(', ')}`, 422)
    })

    .get('/api/v1/sync/runs', async (ctx: any) => {
      gateRead(ctx)
      return { data: await listRuns(ctx.db, ctx.workspaceId) }
    })

    // ── syncProvider surface: extension data moves like content ───────────
    .get('/api/v1/sync/providers', async (ctx: any) => {
      gateRead(ctx)
      const { db, workspaceId, query } = ctx
      const providerProject = ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === workspaceId)
      const allProviders = resolveWorkspaceProviders(providerProject, await porterActivePredicate(workspaceId))
      const byKey = new Map(allProviders.map((p) => [p.key, p]))
      const ordered = sortProvidersByDependency(allProviders.map((p) => p.key), (k) => byKey.get(k)?.dependsOn ?? [])
      const data = []
      for (const p of ordered.map((k) => byKey.get(k)!)) {
        data.push({
          key: p.key,
          label: p.label,
          extensionId: p.extensionId ?? null,
          count: await (({ db: pdb, store }) => p.count(pdb, workspaceId, { store }))(porterProviderScope(p, db, workspaceId)),
        })
      }
      return { data }
    })

    .get('/api/v1/sync/runs/:id', async (ctx: any) => {
      gateRead(ctx)
      const run = await getRun(ctx.db, ctx.workspaceId, ctx.params.id)
      if (!run) throw new RequestError('NOT_FOUND', 'Run not found', 404)
      return { data: run }
    })

    .post('/api/v1/sync/runs/:id/cancel', async (ctx: any) => {
      gateWrite(ctx)
      const run = await getRun(ctx.db, ctx.workspaceId, ctx.params.id)
      if (!run) throw new RequestError('NOT_FOUND', 'Run not found', 404)
      await requestCancel(ctx.db, ctx.workspaceId, ctx.params.id)
      return { data: { cancelRequested: true } }
    })

    .get('/api/v1/sync/runs/:id/results', async (ctx: any) => {
      gateRead(ctx)
      const run = await getRun(ctx.db, ctx.workspaceId, ctx.params.id)
      if (!run) throw new RequestError('NOT_FOUND', 'Run not found', 404)

      const project = ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === ctx.workspaceId)
      const storage = ctx.porterStorage ?? resolvePorterStorage(project)
      const failedOnly = ctx.query?.failed === '1' || ctx.query?.failed === 'true'
      const format = ctx.query?.format === 'csv' ? 'csv' : 'jsonl'

      const entries: Record<string, unknown>[] = []
      for await (const entry of readRunResults(storage, run.id, run.resultsParts)) {
        if (failedOnly && entry.outcome !== 'failed') continue
        entries.push(entry)
      }

      if (format === 'csv') {
        const lines = [CSV_COLUMNS.join(',')]
        for (const e of entries) lines.push(CSV_COLUMNS.map((c) => csvCell(e[c])).join(','))
        return new Response(lines.join('\n') + '\n', {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="${run.id}-results.csv"`,
          },
        })
      }
      return new Response(entries.map((e) => JSON.stringify(e)).join('\n') + '\n', {
        headers: {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'content-disposition': `attachment; filename="${run.id}-results.jsonl"`,
        },
      })
    })

    .get('/api/v1/sync/runs/:id/bundle', async (ctx: any) => {
      gateRead(ctx)
      const run = await getRun(ctx.db, ctx.workspaceId, ctx.params.id)
      if (!run) throw new RequestError('NOT_FOUND', 'Run not found', 404)
      const bundleId = (run.scope as { bundleId?: string }).bundleId
      if (run.kind !== 'export' || !bundleId) {
        throw new RequestError('VALIDATION_ERROR', 'Only export runs have a bundle', 422)
      }
      if (run.status !== 'completed') {
        throw new RequestError('CONFLICT', 'The bundle is available once the export completes', 409)
      }
      const project = ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === ctx.workspaceId)
      const storage = ctx.porterStorage ?? resolvePorterStorage(project)
      const bytes = await tarGzBundle(storage, bundleId)
      return new Response(bytes, {
        headers: {
          'content-type': 'application/gzip',
          'content-disposition': `attachment; filename="${bundleId}.tangen-export.tar.gz"`,
        },
      })
    })

    .post('/api/v1/sync/bundles', async (ctx: any) => {
      gateWrite(ctx)

      const bytes = new Uint8Array(await ctx.request.arrayBuffer())
      if (bytes.byteLength === 0) throw new RequestError('VALIDATION_ERROR', 'Empty upload', 422)

      const project = ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === ctx.workspaceId)
      const storage = ctx.porterStorage ?? resolvePorterStorage(project)
      const bundleId = `bnd_${randomBytes(8).toString('hex')}`
      try {
        await importBundleFromTarGz(storage, bundleId, bytes)
      } catch (err: any) {
        throw new RequestError('VALIDATION_ERROR', `Not a valid Tangen export: ${String(err?.message ?? err)}`, 422)
      }
      const reader = await openBundleReader(storage, bundleId)
      const validation = await validateBundleAgainstEnv(ctx.db, reader.manifest)

      ctx.set.status = 201
      return {
        data: {
          bundleId,
          manifest: {
            workspaceId: reader.manifest.workspaceId,
            createdAt: reader.manifest.createdAt,
            counts: reader.manifest.counts,
          },
          validation,
        },
      }
    })

    .post('/api/v1/sync/select', async (ctx: any) => {
      gateRead(ctx)
      const { db, workspaceId, body } = ctx
      const typeName = (body?.typeName as string | undefined)?.trim()
      if (!typeName) throw new RequestError('VALIDATION_ERROR', 'typeName is required', 422)
      const table = (contentTables as Record<string, any>)[typeName]
      if (!table) throw new RequestError('VALIDATION_ERROR', `Unknown type: ${typeName}`, 422)

      const raw = (body?.filter ?? {}) as MigrationSelectFilter
      const filter: MigrationSelectFilter = {
        ids: Array.isArray(raw.ids) ? raw.ids.filter(Boolean).slice(0, 10_000) : undefined,
        slugs: Array.isArray(raw.slugs) ? raw.slugs.filter(Boolean).slice(0, 10_000) : undefined,
        status: Array.isArray(raw.status)
          ? raw.status.filter((s): s is string => typeof s === 'string')
          : typeof raw.status === 'string' && raw.status ? raw.status : undefined,
        fields: Array.isArray(raw.fields)
          ? raw.fields
              .filter((f): f is NonNullable<MigrationSelectFilter['fields']>[number] =>
                !!f && typeof f.name === 'string' && typeof f.contains === 'string')
              .slice(0, 20)
          : undefined,
        labels: raw.labels && Array.isArray(raw.labels.values) && typeof raw.labels.op === 'string'
          ? {
              values: raw.labels.values.filter((v): v is string => typeof v === 'string').slice(0, 50),
              op: (['all', 'any', 'none', 'contains', 'starts', 'ends'] as const).includes(raw.labels.op as never)
                ? raw.labels.op
                : 'all',
            }
          : undefined,
        updatedFrom: typeof raw.updatedFrom === 'string' && raw.updatedFrom ? raw.updatedFrom : undefined,
        updatedTo: typeof raw.updatedTo === 'string' && raw.updatedTo ? raw.updatedTo : undefined,
        match: raw.match === 'any' ? 'any' : 'all',
        search: typeof (raw as any).search === 'string' ? (raw as any).search : undefined,
      }
      const selection = await selectObjectsForMigration(db, workspaceId, table, filter, {
        page: Number(body?.page) || 1,
        pageSize: Number(body?.pageSize) || 50,
        withIds: body?.withIds === true,
        entityType: `content:${typeName}`,
      })
      return { data: selection }
    })
