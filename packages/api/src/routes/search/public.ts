/**
 * File Name: public.ts
 * Purpose: Elysia route plugin for POST /api/v1/search, performing full-text search and
 *          hydrating results from Postgres to return full object payloads in ranked order.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires SearchService and @tangen/db contentTables; results are grouped by type
 *                     for efficient batch hydration. Requires search:read permission or admin access.
 */
import { Elysia } from 'elysia'
import { eq, and, inArray } from 'drizzle-orm'
import { contentTables } from '@tangen/db/content-tables'
import { RequestError } from '../../lib/errors'
import { asRequestError } from '../../services/search-governor'
import { extensionWiringDeps } from '../../services/extension-server'
import { extensionSearchProvidersFor, runSearchProviders } from '../../services/search-providers'
import type { SearchEngine } from '../../services/search-engine'
import { resolveSearchAnalytics } from '../../services/search-config'
import { expandQuery, loadSynonymGroups } from '../../services/search-synonyms'
import { applyCuration, matchRule, loadCurationRules } from '../../services/search-curation'
import { searchLogJob } from '../../services/search-log'
import { enqueueTask } from '../../services/task-queue'

export const publicSearchRoute = (app: Elysia) =>
  app.post('/api/v1/search', async (ctx: any) => {
    const { body, db, workspaceId, permissions, searchEngineRef, workspaceProjects } = ctx

    if (!permissions?.search?.actions?.includes('read') &&
        !('admin' in permissions && permissions.admin)) {
      throw new RequestError('FORBIDDEN', 'Missing permission: search:read', 403)
    }

    const { q, limit = 20, type: typeFilter } = body as {
      q: string
      limit?: number
      type?: string
    }

    if (!q || typeof q !== 'string' || !q.trim()) {
      throw new RequestError('VALIDATION_ERROR', 'q (query string) is required', 422)
    }

    // Synonym-expand the query for the full-text content search.
    const expandedTerm = expandQuery(q.trim(), await loadSynonymGroups(db, workspaceId).catch(() => []))
    const engine = (searchEngineRef?.current as SearchEngine | null) ?? null

    // Content goes through the ENGINE when one is resolved. Calling the service
    // here was the last place a route named a datastore - and it also bypassed
    // the governor, so public search had no concurrency cap, no statement
    // timeout and no clamped limit, which is precisely the traffic those exist
    // to bound.
    let hits: Array<{ document: Record<string, unknown> }> = []
    if (engine) {
      try {
        const res = await engine.search({
          workspaceId, query: expandedTerm, audience: 'public',
          limit: Math.min(limit, 50), source: 'content',
          ...(typeFilter ? { typeSlug: String(typeFilter) } : {}),
        })
        hits = res.hits.map((h) => ({ document: { id: h.objectId, typeName: h.typeSlug, title: h.title, status: h.status } }))
      } catch (err) {
        const refusal = asRequestError(err)
        if (!refusal) throw err
        throw new RequestError(refusal.code as never, refusal.message, refusal.status)
      }
    }

    const ids = hits.map(h => h.document.id as string)

    // Content: fetch full objects from Postgres, grouped by type (published only).
    let contentData: (Record<string, unknown> | undefined)[] = []
    if (ids.length > 0) {
      const grouped = new Map<string, string[]>()
      for (const h of hits) {
        const tn = h.document.typeName as string
        if (!grouped.has(tn)) grouped.set(tn, [])
        grouped.get(tn)!.push(h.document.id as string)
      }

      const objectMap = new Map<string, Record<string, unknown>>()
      for (const [typeName, typeIds] of grouped.entries()) {
        const table = (contentTables as Record<string, any>)[typeName]
        if (!table) continue
        const rows: Record<string, unknown>[] = await db
          .select()
          .from(table)
          .where(and(inArray(table.id, typeIds), eq(table.workspaceId, workspaceId)))
        for (const row of rows) objectMap.set(row.id as string, { ...row, type: typeName })
      }
      // Ranked order from the engine, skipping any IDs not found in Postgres.
      contentData = ids.map(id => objectMap.get(id)).filter(Boolean)
    }

    // Site Search (P2-1): public-declared extension providers. Internal-only
    // providers (users/forms, admin-only extensions) are filtered by audience.
    let extData: Record<string, unknown>[] = []
    const deps = extensionWiringDeps()
    if (deps) {
      const extProviders = await extensionSearchProvidersFor(workspaceId, deps)
      const groups = await runSearchProviders(extProviders, q.trim(), {
        workspaceId, audience: 'public', limit: Math.min(limit, 50), engine: (searchEngineRef?.current as never) ?? undefined, db,
      })
      extData = groups.flatMap(g => g.hits.map(h => ({ id: h.id, title: h.title, url: h.url, status: h.status, type: h.kind })))
    }

    let data = [...contentData, ...extData]

    // Curation: pin/hide per the marketing rules for this query.
    const curation = matchRule(await loadCurationRules(db, workspaceId).catch(() => []), q.trim(), 'public')
    data = applyCuration(data as any[], curation)

    // Analytics: log the Site Search query as a background task (fire-and-forget).
    const project = (workspaceProjects as any[])?.find((p) => p.workspaceId === workspaceId)
    const analytics = resolveSearchAnalytics(project)
    const logJob = searchLogJob({ enabled: analytics.enabled, workspaceId, audience: 'public', term: q.trim(), resultCount: data.length })
    if (logJob) void enqueueTask(logJob).catch(() => {})

    return { data, meta: { total: data.length, query: q } }
  })
