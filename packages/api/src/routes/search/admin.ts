/**
 * File Name: admin.ts
 * Purpose: GET /api/v1/admin/search — Admin Search. Runs the internal search
 *          provider registry (content + users + forms, each audience/feature
 *          gated) and returns the merged hits, each tagged with its provider
 *          group. Member-session only; accepts q, limit, and (content) type.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: search providers in ../../services/search-providers; users
 *                     and forms are gated on their features being enabled.
 */
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'
import { asRequestError } from '../../services/search-governor'
import { requireMemberSession } from '../../lib/member-access'
import { resolveIsAuthEnabled } from '../dashboard/stats'
import { resolveSearchAnalytics } from '../../services/search-config'
import { expandQuery, loadSynonymGroups } from '../../services/search-synonyms'
import { applyCuration, matchRule, loadCurationRules } from '../../services/search-curation'
import { searchLogJob } from '../../services/search-log'
import { enqueueTask } from '../../services/task-queue'
import { extensionWiringDeps } from '../../services/extension-server'
import {
  runSearchProviders,
  extensionSearchProvidersFor,
  contentProvider,
  type SearchProvider,
} from '../../services/search-providers'

const INTERNAL_PROVIDERS: SearchProvider[] = [contentProvider]

/**
 * Elysia plugin providing GET /api/v1/admin/search for member-only Admin Search.
 * @returns Elysia plugin function
 */
export const adminSearchRoute = (app: Elysia) =>
  app.get('/api/v1/admin/search', async (ctx: any) => {
    const { query, workspaceId, permissions, searchEngineRef, db, workspaceProjects } = ctx

    requireMemberSession({ permissions, memberId: ctx.memberId })

    const q = (query.q as string | undefined)?.trim()
    if (!q) {
      throw new RequestError('VALIDATION_ERROR', 'q (query string) is required', 422)
    }
    const limit = Math.min(Number(query.limit ?? 20), 50)
    const typeFilter = query.type as string | undefined

    const project = (workspaceProjects as any[])?.find((p) => p.workspaceId === workspaceId)
    const features: Record<string, boolean> = {}

    // Live providers contributed by installed extensions (S5b).
    const deps = extensionWiringDeps()
    const extProviders = deps ? await extensionSearchProvidersFor(workspaceId, deps) : []

    const expandedTerm = expandQuery(q, await loadSynonymGroups(db, workspaceId).catch(() => []))

    const groups = await runSearchProviders([...INTERNAL_PROVIDERS, ...extProviders], q, {
      workspaceId,
      audience: 'internal',
      limit,
      engine: (searchEngineRef?.current as never) ?? undefined,
      db,
      features,
      expandedTerm,
    })

    // Flatten, tagging each hit with its provider group for the palette.
    let data = groups.flatMap((g) => g.hits.map((h) => ({ ...h, group: g.label })))
    if (typeFilter) data = data.filter((h) => h.typeName === typeFilter)

    // Curation: pin/hide per the marketing rules for this query.
    const curation = matchRule(await loadCurationRules(db, workspaceId).catch(() => []), q, 'internal')
    data = applyCuration(data, curation)

    // Analytics: log the query as a background task (fire-and-forget, off the hot path).
    const analytics = resolveSearchAnalytics(project)
    const logJob = searchLogJob({ enabled: analytics.enabled, workspaceId, audience: 'internal', term: q, resultCount: data.length })
    if (logJob) void enqueueTask(logJob).catch(() => {})

    return { data, meta: { total: data.length, query: q } }
  })
