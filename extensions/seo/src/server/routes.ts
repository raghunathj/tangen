/**
 * File Name: routes.ts
 * Purpose: The SEO extension's HTTP surface (closure plan Phase 9A, Units 12
 *          and 15): what a website reads, and what the Admin manages. Two
 *          mounts with two different audiences and no overlap between them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Public routes serve the PUBLISHED snapshot only - there
 *          is no path from a draft edit to a public answer, and a route that
 *          could serve one would make every other guarantee here decorative.
 *          Member routes carry the extension's own capability. Every route
 *          404s while the extension is not active in the resolved scope,
 *          which the platform enforces for us (Phase 4, Unit 10).
 */
import { RouteError, type ExtensionAdminRoute, type ExtensionServerCtx } from '@tangen/cms'
import {
  ARTIFACT_TTL, artifactKey, artifactVersion, bumpArtifactVersion,
  helpersOf, resolvedSeoFor, robotsTxt, roleOf, sitemapIndex, sitemapPageXml, buildLlmsManifest,
} from './artifacts'
import { deleteRedirect, findRedirect, listRedirects, saveRedirect, REDIRECT_PAGE_SIZE } from './redirect-store'
import { applyQuery, normalizeSource, sourceQuery, type SeoRedirect } from '../lib/redirects'
import { validateCanonical } from '../lib/canonical'
import { normalizeSettings, mergeSettingsGroups, SEO_SETTINGS_KEY } from '../lib/settings'
import { normalizeSchemaMap, SEO_SCHEMA_MAP_KEY } from '../lib/schema-map'
import { readStored, pickMetadata } from '../lib/metadata'
import { altTextPrompt, cleanAltText, generateStatus, visionStatus } from '../lib/alt-text'
import { buildHealthReport, healthWidget } from './health'
import { searchConsoleConnection } from './search-console'
import { syncOnDemand } from './analytics-sync'
import { readAnalytics } from './analytics-read'
import { clearNotFound, ignoreNotFound, listNotFound, recordNotFound } from './not-found-store'
import { readTitles, writeTitle } from './titles'
import { optimizeObject } from './optimize'
import { parseRedirectCsv, toRedirectCsv } from '../lib/redirects-csv'
import { objectUrl, urlFieldName, urlFieldValue } from '../lib/object-url'

const XML = { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
const TEXT = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown, fallback: number): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback }

/**
 * A key route's own gate: the manifest's `apiKeyScope` action, checked with the
 * platform's `req.keyCan`. Without it a key minted for another extension could
 * read everything this one serves.
 */
async function keyedRead<T>(req: { keyCan?: (action: string) => boolean }, run: () => Promise<T>): Promise<T> {
  if (req.keyCan && !req.keyCan('read')) {
    throw new RouteError(403, 'This API key does not grant SEO read. Tick "Read SEO and redirects" on the key under Settings > API keys.', { code: 'SEO_KEY_SCOPE' })
  }
  return run()
}

/** Reads through the platform cache, keyed by version and locale. */
async function cached<T>(ctx: ExtensionServerCtx, name: string, locale: string | null, fn: () => Promise<T>): Promise<T> {
  const version = await artifactVersion(ctx)
  const key = artifactKey(name, version, locale)
  const client = ctx.tangen
  if (!client) return fn()
  return client.cache({ key, ttl: ARTIFACT_TTL }, fn)
}

export const seoRoutes: ExtensionAdminRoute[] = [
  // ── What a website reads ───────────────────────────────────────────────────
  {
    method: 'GET', path: 'meta', auth: 'public',
    handler: async (req, ctx) => {
      const type = str(req.query?.type)
      const id = str(req.query?.id)
      const locale = str(req.query?.locale) || null
      if (!type || !id) return { error: { code: 'SEO_BAD_REQUEST', message: 'type and id are required' } }
      // Published only. `preview` is not a query parameter on purpose: a
      // public caller must not be able to ask for a draft.
      const resolved = await cached(ctx, `meta:${type}:${id}`, locale, () => resolvedSeoFor(ctx, { type, id, locale }))
      if (!resolved) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No published SEO for this object' } }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      })
      return { data: resolved }
    },
  },
  {
    // The SDK's resolver: identical published SEO to `meta`, but authenticated
    // by API key so the workspace comes from the key (client.seo() needs no
    // X-Tangen-Workspace header). Published only, like its public twin.
    //
    // Gated by the same `seo: read` scope as redirects.json (2026-09-19): the
    // route predates the manifest's apiKeyScope, so until now ANY key for the
    // workspace could read it - including one minted for another extension.
    // A key with full access is unaffected; a scoped one needs the box ticked.
    method: 'GET', path: 'resolve', auth: 'key',
    handler: async (req, ctx) => keyedRead(req, async () => {
      const type = str(req.query?.type)
      const id = str(req.query?.id)
      const locale = str(req.query?.locale) || null
      if (!type || !id) return { error: { code: 'SEO_BAD_REQUEST', message: 'type and id are required' } }
      const resolved = await cached(ctx, `meta:${type}:${id}`, locale, () => resolvedSeoFor(ctx, { type, id, locale }))
      if (!resolved) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No published SEO for this object' } }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      })
      return { data: resolved }
    }),
  },
  {
    method: 'GET', path: 'robots.txt', auth: 'public',
    handler: async (_req, ctx) => new Response(await cached(ctx, 'robots', null, () => robotsTxt(ctx)), { headers: TEXT }),
  },
  {
    // The GEO manifest for AI crawlers. 404 when the toggle is off, so a
    // disabled site serves no empty file. Cached by artifact version.
    method: 'GET', path: 'llms.txt', auth: 'public',
    handler: async (_req, ctx) => {
      const body = await cached(ctx, 'llms', null, () => buildLlmsManifest(ctx, { full: false }))
      if (body == null) return new Response('Not found', { status: 404, headers: TEXT })
      return new Response(body, { headers: TEXT })
    },
  },
  {
    method: 'GET', path: 'llms-full.txt', auth: 'public',
    handler: async (_req, ctx) => {
      const body = await cached(ctx, 'llms-full', null, () => buildLlmsManifest(ctx, { full: true }))
      if (body == null) return new Response('Not found', { status: 404, headers: TEXT })
      return new Response(body, { headers: TEXT })
    },
  },
  {
    method: 'GET', path: 'sitemap.xml', auth: 'public',
    handler: async (req, ctx) => {
      const locale = str(req.query?.locale) || null
      const page = num(req.query?.page, 1)
      const { xml } = await cached(ctx, `sitemap:${page}`, locale, () => sitemapPageXml(ctx, page, locale))
      return new Response(xml, { headers: XML })
    },
  },
  {
    method: 'GET', path: 'sitemap-index.xml', auth: 'public',
    handler: async (req, ctx) => {
      const locale = str(req.query?.locale) || null
      const { xml } = await cached(ctx, 'sitemap-index', locale, () => sitemapIndex(ctx, locale))
      return new Response(xml, { headers: XML })
    },
  },
  {
    // The request-path lookup: ONE indexed row read, whatever the site's size.
    method: 'GET', path: 'redirect', auth: 'public',
    handler: async (req, ctx) => {
      const path = str(req.query?.path)
      if (!path) return { error: { code: 'SEO_BAD_REQUEST', message: 'path is required' } }
      const redirect = await findRedirect(ctx.store, path)
      if (!redirect) {
        // V5: the site is telling us a path did not resolve. Count it (paths only),
        // never at the cost of its own answer.
        await recordNotFound(ctx.store, path).catch(() => null)
        return new Response(JSON.stringify({ data: null }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      }
      const resolved = await resolveDestination(ctx, redirect)
      // The query the visitor arrived with rides along unless this redirect says not to.
      const destination = resolved ? applyQuery(resolved, sourceQuery(path), redirect.keepQuery) : resolved
      // An internal target whose URL the application cannot place is NOT a
      // redirect anyone can follow, so it is reported as unresolved rather
      // than served as a broken one.
      if (!destination) return new Response(JSON.stringify({ data: null, reason: 'UNRESOLVED_DESTINATION' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      return { data: { source: redirect.source, destination, status: redirect.status } }
    },
  },

  // ── What the Admin manages ─────────────────────────────────────────────────
  {
    method: 'GET', path: 'redirects', auth: 'member', capability: 'seo:read',
    handler: async (req, ctx) => {
      const limit = Math.min(num(req.query?.limit, REDIRECT_PAGE_SIZE), 200)
      const offset = num(req.query?.offset, 0) - (req.query?.offset ? 0 : 0)
      const sort = str(req.query?.sort) === 'updatedAt' ? 'updatedAt' as const : 'source' as const
      const { rows, total } = await listRedirects(ctx.store, {
        limit, offset: Number(req.query?.offset ?? 0) || 0, sort, desc: str(req.query?.dir) === 'desc',
      })
      const search = str(req.query?.search).trim().toLowerCase()
      const enabled = str(req.query?.enabled)
      const kind = str(req.query?.kind)
      const bySearch = search ? rows.filter((r) => r.source.includes(search) || JSON.stringify(r.destination).toLowerCase().includes(search)) : rows
      const byState = enabled === 'on' ? bySearch.filter((r) => r.enabled !== false)
        : enabled === 'off' ? bySearch.filter((r) => r.enabled === false)
        : bySearch
      // 'content' is the stored 'internal' kind, said the way the form says it.
      const wanted = kind === 'content' ? 'internal' : kind === 'url' ? 'external' : kind === 'path' ? 'path' : null
      const filtered = wanted ? byState.filter((r) => r.destination.kind === wanted) : byState
      // A content target is stored as an identity; the app resolves the URL. Show
      // it, so the editor sees where the redirect actually goes (null when the
      // app cannot place it yet, which is honest rather than a broken link).
      const withResolved = await Promise.all(filtered.map(async (r) => (
        r.destination.kind === 'internal' ? { ...r, resolved: await resolveDestination(ctx, r) } : r
      )))
      return { data: withResolved, meta: { total, limit, offset, filtered: Boolean(search) } }
    },
  },
  {
    method: 'POST', path: 'redirects', auth: 'member', capability: 'seo:write',
    handler: async (req, ctx) => writeRedirect(ctx, req.body as Record<string, unknown>, undefined),
  },
  {
    method: 'PATCH', path: 'redirects', auth: 'member', capability: 'seo:write',
    handler: async (req, ctx) => {
      const body = (req.body ?? {}) as Record<string, unknown>
      return writeRedirect(ctx, body, str(body.replacing) || undefined)
    },
  },
  {
    method: 'DELETE', path: 'redirects', auth: 'member', capability: 'seo:write',
    handler: async (req, ctx) => {
      const source = str(req.query?.source) || str((req.body as Record<string, unknown> | undefined)?.source)
      if (!source) throw new RouteError(422, 'source is required', { code: 'SEO_BAD_REQUEST' })
      await deleteRedirect(ctx.store, source)
      await bumpArtifactVersion(ctx)
      return { data: { source: normalizeSource(source), deleted: true } }
    },
  },
  {
    // The editor's own preview of a draft. Member-only, and it says so.
    method: 'GET', path: 'preview', auth: 'member', capability: 'seo:read',
    handler: async (req, ctx) => {
      const type = str(req.query?.type)
      const id = str(req.query?.id)
      if (!type || !id) return { error: { code: 'SEO_BAD_REQUEST', message: 'type and id are required' } }
      return { data: await resolvedSeoFor(ctx, { type, id, locale: str(req.query?.locale) || null, preview: true }) }
    },
  },
  {
    // What the sitemap would contain and, more usefully, what it would not.
    method: 'GET', path: 'sitemap-report', auth: 'member', capability: 'seo:read',
    handler: async (req, ctx) => {
      const { build, pageCount } = await sitemapIndex(ctx, str(req.query?.locale) || null)
      return { data: { entries: build.entries.length, pageCount, skipped: build.skipped, scanned: build.scanned, truncated: build.truncated } }
    },
  },
  {
    // S2: the GEO tab's preview of the manifest the public route serves. Member-only and gated by the same
    // switch: when llms.txt is off the answer says so, rather than the public route's 404.
    method: 'GET', path: 'llms-preview', auth: 'member', capability: 'seo:read',
    handler: async (req, ctx) => {
      const manifest = await buildLlmsManifest(ctx, { full: str(req.query?.full) === '1' })
      return { data: { enabled: manifest !== null, path: '/api/v1/ext/seo/llms.txt', manifest } }
    },
  },
  // ── V1: the Dashboard's health report ───────────────────────────────────────
  {
    // Cached under the artifact version (a publish retires it); POST rebuilds now.
    method: 'GET', path: 'health-report', auth: 'member', capability: 'seo:read',
    handler: async (_req, ctx) => ({ data: await cached(ctx, 'health-report', null, () => buildHealthReport(ctx)) }),
  },
  {
    // A rebuild writes the stored report, so it is a write like any other.
    method: 'POST', path: 'health-report', auth: 'member', capability: 'seo:write',
    handler: async (_req, ctx) => ({ data: await buildHealthReport(ctx) }),
  },
  // ── V3: Search Console ──────────────────────────────────────────────────────
  {
    // The connection's state and the properties it may read, so an operator can copy the exact property value into Settings.
    method: 'GET', path: 'search-console/sites', auth: 'member', capability: 'seo:read',
    handler: async (_req, ctx) => {
      const { status, reader } = await searchConsoleConnection(ctx)
      if (!status.connected || !reader) return { data: { ...status, sites: [] } }
      try { return { data: { ...status, sites: await reader.listSites() } } }
      catch (e) { return { data: { connected: false as const, reason: `The connection could not list properties: ${(e as Error).message}`, sites: [] } } }
    },
  },
  // ── V2: Titles & Meta, a workspace-wide table ───────────────────────────────
  {
    method: 'GET', path: 'titles', auth: 'member', capability: 'seo:read',
    handler: async (req, ctx) => {
      const sort = ['page', 'title', 'state'].includes(str(req.query?.sort)) ? str(req.query?.sort) as 'page' : undefined
      const view = await readTitles(ctx, {
        type: str(req.query?.type) || null, state: str(req.query?.state) || null, search: str(req.query?.search) || null,
        limit: num(req.query?.limit, 25), offset: Number(req.query?.offset ?? 0) || 0,
        ...(sort ? { sort } : {}),
        ...(str(req.query?.dir) ? { desc: str(req.query?.dir) === 'desc' } : {}),
      })
      return { data: view.rows, meta: { total: view.total, scanned: view.scanned, counts: view.counts, types: view.types } }
    },
  },
  {
    // Writes the DRAFT, never the live snapshot: Tangen's publishing semantics
    // decide when a visitor sees it, and the row says so.
    method: 'PATCH', path: 'titles', auth: 'member', capability: 'seo:write',
    handler: async (req, ctx) => {
      const body = (req.body ?? {}) as Record<string, unknown>
      const out = await writeTitle(ctx, {
        id: str(body.id), type: str(body.type),
        ...(body.title !== undefined ? { title: body.title as string | null } : {}),
        ...(body.description !== undefined ? { description: body.description as string | null } : {}),
        ...(body.locale ? { locale: str(body.locale) } : {}),
      })
      if (!out.ok) throw new RouteError(422, out.reason, { code: 'SEO_BAD_REQUEST' })
      await bumpArtifactVersion(ctx)
      return { data: out.row }
    },
  },
  // ── V7: Tools ───────────────────────────────────────────────────────────────
  {
    // What the public robots.txt currently says, and which deployment role shaped it.
    method: 'GET', path: 'robots-preview', auth: 'member', capability: 'seo:read',
    handler: async (_req, ctx) => ({ data: { body: await robotsTxt(ctx), role: await roleOf(ctx), path: '/api/v1/ext/seo/robots.txt' } }),
  },
  {
    // Retires every cached artifact (meta, sitemaps, llms.txt, the health report).
    method: 'POST', path: 'refresh-caches', auth: 'member', capability: 'seo:write',
    handler: async (_req, ctx) => ({ data: { version: await bumpArtifactVersion(ctx) } }),
  },
  {
    // Every redirect as a CSV file, for a spreadsheet or another CMS.
    method: 'GET', path: 'redirects/export', auth: 'member', capability: 'seo:read',
    handler: async (_req, ctx) => {
      const { rows } = await listRedirects(ctx.store, { limit: 10_000 })
      return new Response(toRedirectCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="redirects.csv"' } })
    },
  },
  {
    // A CSV file in. Every row that cannot be read is reported with its line
    // number; the rows that can be are written through the same saveRedirect
    // the form uses, so the same rules apply.
    method: 'POST', path: 'redirects/import', auth: 'member', capability: 'seo:write',
    handler: async (req, ctx) => {
      const body = (req.body ?? {}) as Record<string, unknown>
      const parsed = parseRedirectCsv(str(body.csv))
      const now = new Date().toISOString()
      const siteUrl = helpersOf(ctx).siteUrl
      let created = 0
      const refused: Array<{ source: string; reason: string }> = []
      for (const row of parsed.rows) {
        const saved = await saveRedirect(ctx.store, { source: row.source, destination: { kind: 'external', url: row.url }, status: row.status }, { now, ...(siteUrl ? { siteUrl } : {}) })
        if (saved.ok) created += 1
        else refused.push({ source: row.source, reason: saved.reason })
      }
      if (created) await bumpArtifactVersion(ctx)
      return { data: { read: parsed.rows.length, written: created, malformed: parsed.errors, refused } }
    },
  },
  // ── V6: what this installation's AI can do for SEO ──────────────────────────
  {
    method: 'GET', path: 'ai-status', auth: 'member', capability: 'seo:read',
    handler: async (_req, ctx) => ({ data: { generate: generateStatus(ctx), vision: visionStatus(ctx) } }),
  },
  // ── V6: the AI optimisation action, one object at a time ────────────────────
  {
    // Proposes SEO values for one page. Nothing is stored unless `apply` is
    // asked for, and then only the DRAFT: AI never changes what a visitor sees.
    // A later bulk run calls this same action per selected object.
    method: 'POST', path: 'optimize', auth: 'member', capability: 'seo:write',
    handler: async (req, ctx) => {
      const body = (req.body ?? {}) as Record<string, unknown>
      const out = await optimizeObject(ctx, { type: str(body.type), id: str(body.id), apply: body.apply === true, locale: str(body.locale) || null })
      if (!out.ok) throw new RouteError(422, out.reason, { code: 'SEO_OPTIMIZE_UNAVAILABLE' })
      if (out.applied) await bumpArtifactVersion(ctx)
      return { data: out }
    },
  },
  {
    // Every enabled redirect, resolved, for a site that wants to hold the map
    // itself (a Next.js `redirects()`, an edge middleware) instead of asking
    // per request. Key-authenticated like the SDK resolver, and cached under
    // the artifact version, so a write invalidates it.
    method: 'GET', path: 'redirects.json', auth: 'key',
    handler: async (req, ctx) => {
      // The key must carry SEO read (Settings > API keys). A key minted for
      // something else does not get the site's whole routing table.
      const built = await keyedRead(req, async () => cached(ctx, 'redirects-json', null, async () => {
        const { rows } = await listRedirects(ctx.store, { limit: 10_000 })
        const data: Array<{ from: string; to: string; status: 301 | 302 }> = []
        let off = 0
        let unresolved = 0
        for (const row of rows) {
          if (row.enabled === false) { off += 1; continue }
          const to = await resolveDestination(ctx, row)
          // A destination the app cannot place is not a redirect anyone can
          // follow, so it is left out rather than shipped as a rule nobody can
          // follow - and COUNTED, because a rule that silently vanished from
          // the map is how an operator loses an afternoon.
          if (to) data.push({ from: row.source, to, status: row.status })
          else unresolved += 1
        }
        return { data, counts: { total: rows.length, off, unresolved } }
      })) as { data: Array<{ from: string; to: string; status: 301 | 302 }>; counts: { total: number; off: number; unresolved: number } }
      return { data: built.data, meta: { ...built.counts, generatedAt: new Date().toISOString() } }
    },
  },
  // ── V5: the 404 Monitor ─────────────────────────────────────────────────────
  {
    // For a site that does not ask Tangen for a redirect on a miss: tell it the
    // path. Paths only - an absolute URL or a query string is reduced to its
    // path, and nothing about the visitor is read. Rate limited like any public write.
    method: 'POST', path: 'not-found', auth: 'public',
    handler: async (req, ctx) => {
      const limit = await ctx.tangen?.rateLimit?.('seo:not-found', 120, 60).catch(() => undefined)
      if (limit && limit.allowed === false) {
        return new Response(JSON.stringify({ data: null, reason: 'RATE_LIMITED' }), { status: 429, headers: { 'Content-Type': 'application/json' } })
      }
      const body = (req.body ?? {}) as Record<string, unknown>
      const recorded = await recordNotFound(ctx.store, body.path ?? str(req.query?.path)).catch(() => null)
      return { data: { recorded: recorded !== null } }
    },
  },
  {
    method: 'GET', path: 'not-found', auth: 'member', capability: 'seo:read',
    handler: async (req, ctx) => {
      const sort = ['hits', 'path', 'lastSeenAt', 'firstSeenAt'].includes(str(req.query?.sort)) ? str(req.query?.sort) as 'hits' : undefined
      const { rows, total, tracked, cap } = await listNotFound(ctx.store, {
        limit: num(req.query?.limit, 50),
        offset: Number(req.query?.offset ?? 0) || 0,
        includeIgnored: str(req.query?.includeIgnored) === '1',
        ...(sort ? { sort } : {}),
        ...(str(req.query?.dir) ? { desc: str(req.query?.dir) === 'desc' } : {}),
      })
      return { data: rows, meta: { total, tracked, cap } }
    },
  },
  {
    method: 'POST', path: 'not-found/ignore', auth: 'member', capability: 'seo:write',
    handler: async (req, ctx) => {
      const row = await ignoreNotFound(ctx.store, (req.body as Record<string, unknown> | undefined)?.path)
      if (!row) throw new RouteError(404, 'That path is not being tracked.', { code: 'SEO_NOT_FOUND_UNKNOWN' })
      return { data: row }
    },
  },
  {
    method: 'DELETE', path: 'not-found', auth: 'member', capability: 'seo:write',
    handler: async (req, ctx) => {
      const path = str(req.query?.path) || str((req.body as Record<string, unknown> | undefined)?.path)
      const cleared = await clearNotFound(ctx.store, path)
      if (!cleared) throw new RouteError(404, 'That path is not being tracked.', { code: 'SEO_NOT_FOUND_UNKNOWN' })
      return { data: { path, cleared: true } }
    },
  },
  // ── V4: Analytics, read from the store alone ────────────────────────────────
  {
    // A render never calls Google: the daily task and the Sync button write, this reads.
    method: 'GET', path: 'analytics', auth: 'member', capability: 'seo:read',
    handler: async (req, ctx) => ({ data: await readAnalytics(ctx, { days: num(req.query?.days, 28) }) }),
  },
  {
    method: 'POST', path: 'analytics/sync', auth: 'member', capability: 'seo:write',
    handler: async (_req, ctx) => {
      const out = await syncOnDemand(ctx)
      if (!out.ok) throw new RouteError(429, out.reason, { code: 'SEO_SYNC_REFUSED', ...(out.retryAfterSeconds ? { retryAfterSeconds: out.retryAfterSeconds } : {}) })
      return { data: out }
    },
  },
  {
    // V8: the workspace dashboard's tile. The LAST stored report, never a scan.
    method: 'GET', path: 'health-widget', auth: 'member', capability: 'seo:read',
    handler: async (_req, ctx) => ({ data: await healthWidget(ctx) }),
  },
  // ── S3: share-image alt text through a vision provider ─────────────────────
  {
    // Whether the panel's Describe button exists at all: both optional grants held and a provider that can see.
    method: 'GET', path: 'vision-status', auth: 'member', capability: 'seo:read',
    handler: async (_req, ctx) => ({ data: visionStatus(ctx) }),
  },
  {
    // Describes the object's share image (its own, else the workspace default) from its BYTES, so a
    // media file on a private host works and the provider fetches nothing. Every missing piece is a
    // named answer: the panel keeps the hand-written field either way.
    method: 'POST', path: 'alt-text', auth: 'member', capability: 'seo:write',
    handler: async (req, ctx) => {
      const body = (req.body ?? {}) as Record<string, unknown>
      const id = str(body.id)
      if (!id) throw new RouteError(422, 'id is required', { code: 'SEO_BAD_REQUEST' })
      const status = visionStatus(ctx)
      if (!status.available) throw new RouteError(422, status.reason, { code: 'SEO_VISION_UNAVAILABLE' })
      const stored = readStored(await ctx.store.get(id))
      const settings = normalizeSettings(await ctx.store.get(SEO_SETTINGS_KEY))
      const imageId = pickMetadata(stored.draft, str(body.locale) || null).social?.imageId ?? settings.social.defaultImageId ?? null
      if (!imageId) throw new RouteError(422, 'No share image to describe: this object has none and SEO Manager > Settings > Social has no default image.', { code: 'SEO_NO_IMAGE' })
      const asset = await ctx.media!.read(imageId)
      if (!asset) throw new RouteError(422, `The share image (${imageId}) could not be read from the media library.`, { code: 'SEO_NO_IMAGE' })
      if (!asset.mimeType.startsWith('image/')) throw new RouteError(422, `The share image is ${asset.mimeType}, not an image.`, { code: 'SEO_NO_IMAGE' })
      const r = await ctx.ai!.vision!.describe({
        image: { base64: Buffer.from(asset.bytes).toString('base64'), mimeType: asset.mimeType },
        prompt: altTextPrompt({ title: str(body.title) || undefined }),
        maxTokens: 120,
      })
      return { data: { alt: cleanAltText(r.text), imageId, provider: r.provider, model: r.model } }
    },
  },
  // ── Workspace-level settings (the Settings tab; hybrid config on ctx.store) ──
  //
  // `site-settings`, NOT `settings`: core serves `GET/POST <ext>/settings`
  // itself for any extension whose manifest declares typed settings, and SEO
  // declares four (the Search Console ones). So this route was SHADOWED - the
  // tab asked for its own settings and was handed the manifest form's payload,
  // which has no `general` (found in acme, 2026-09-20). The store key is
  // unchanged, so nothing has to be migrated.
  {
    // Always returns a fully-defaulted, junk-free shape - the codec is the one
    // read path, so an empty or legacy row still reads as valid settings.
    method: 'GET', path: 'site-settings', auth: 'member', capability: 'seo:read',
    handler: async (_req, ctx) => ({ data: normalizeSettings(await ctx.store.get(SEO_SETTINGS_KEY)) }),
  },
  {
    // A MERGE, one group at a time: the Settings tab saves the group you
    // edited rather than posting every group back (the user, 2026-09-20), so
    // two people editing different groups do not overwrite each other and a
    // failed save loses one section, not the page. A body carrying every
    // group still works, which is what a full save is.
    method: 'POST', path: 'site-settings', auth: 'member', capability: 'seo:write',
    handler: async (req, ctx) => {
      const stored = normalizeSettings(await ctx.store.get(SEO_SETTINGS_KEY))
      const next = normalizeSettings(mergeSettingsGroups(stored, req.body))
      await ctx.store.put(SEO_SETTINGS_KEY, next as unknown as Record<string, unknown>)
      await bumpArtifactVersion(ctx)  // settings change what /meta resolves - retire cached artifacts
      return { data: next }
    },
  },
  // ── Per-content-type JSON-LD schema mapping (the Schemas tab) ────────────────
  {
    // The map plus the content types (and their fields) to map, so the tab can
    // render kind + field-mapping pickers from one call.
    method: 'GET', path: 'schemas', auth: 'member', capability: 'seo:read',
    handler: async (_req, ctx) => {
      const map = normalizeSchemaMap(await ctx.store.get(SEO_SCHEMA_MAP_KEY))
      const types = (ctx.types?.() ?? []).map((t) => ({
        name: t.name,
        label: (t as { label?: string }).label ?? t.name,
        fields: ((t as { fields?: { name: string; label?: string }[] }).fields ?? []).map((f) => ({ name: f.name, label: f.label ?? f.name })),
      }))
      return { data: { map, types } }
    },
  },
  {
    // A full replace, normalized before storage (unknown kinds and 'none' drop).
    method: 'POST', path: 'schemas', auth: 'member', capability: 'seo:write',
    handler: async (req, ctx) => {
      const next = normalizeSchemaMap(req.body)
      await ctx.store.put(SEO_SCHEMA_MAP_KEY, next as unknown as Record<string, unknown>)
      await bumpArtifactVersion(ctx)
      return { data: next }
    },
  },
]

/** A redirect's destination as an absolute URL, or null when it cannot be placed. */
async function resolveDestination(ctx: ExtensionServerCtx, redirect: SeoRedirect): Promise<string | null> {
  if (redirect.destination.kind === 'external') {
    const checked = validateCanonical(redirect.destination.url)
    return checked.ok ? checked.url : null
  }
  // A path on this site stays a path: a relative Location is valid, and the
  // application knows its own origin better than Tangen does.
  if (redirect.destination.kind === 'path') return redirect.destination.path
  const helpers = helpersOf(ctx)
  const { type, id } = redirect.destination
  // Read the ONE field the site declared for this type, and only when it did:
  // a redirect map of 10,000 rules must not become 10,000 object reads.
  let fieldValue: string | null = null
  if (urlFieldName(helpers, type) && ctx.tangen) {
    try {
      const res = await ctx.tangen.objects(type as never).status('any').find(id)
      fieldValue = urlFieldValue(helpers, type, (res.data ?? null) as Record<string, unknown> | null)
    } catch { /* an object that cannot be read has no URL, which is the answer below */ }
  }
  try {
    const url = await objectUrl({ helpers, workspaceId: ctx.workspaceId, type, id, locale: null, fieldValue })
    if (!url) return null
    const checked = validateCanonical(url)
    return checked.ok ? checked.url : null
  } catch { return null }
}

async function writeRedirect(ctx: ExtensionServerCtx, body: Record<string, unknown>, replacing?: string) {
  const result = await saveRedirect(ctx.store, {
    source: str(body.source),
    destination: body.destination as SeoRedirect['destination'],
    status: Number(body.status ?? 301) as SeoRedirect['status'],
    enabled: body.enabled !== false,
    ...(body.keepQuery === false ? { keepQuery: false } : {}),
    createdAt: str(body.createdAt) || undefined,
    note: str(body.note) || undefined,
  }, { replacing, siteUrl: helpersOf(ctx).siteUrl, now: new Date().toISOString() })

  if (!result.ok) {
    // A refusal must be an HTTP refusal: an error envelope served with 200 let
    // a client report success and lose the write (found in acme, 2026-09-18).
    throw new RouteError(422, redirectMessage(result.reason), { code: result.reason, ...(result.detail ? { details: result.detail } : {}) })
  }
  await bumpArtifactVersion(ctx)
  return { data: result.redirect }
}

/** Editor-facing wording. The code is for machines; this is for people. */
function redirectMessage(reason: string): string {
  switch (reason) {
    case 'SOURCE_EMPTY': return 'Enter the path this redirect starts from.'
    case 'SOURCE_NOT_A_PATH': return 'The source is a path on your site, like /old-page, not a full URL.'
    case 'DESTINATION_EMPTY': return 'Choose where this redirect should go.'
    case 'DESTINATION_SCHEME': return 'A destination must be an http or https address.'
    case 'DESTINATION_NOT_ABSOLUTE': return 'An external destination needs its full address, including https://.'
    case 'DESTINATION_IDENTITY': return 'Choose the content this redirect should point at.'
    case 'SELF_REDIRECT': return 'This redirect points at itself, which would loop forever.'
    case 'DUPLICATE_SOURCE': return 'A redirect from this path already exists. Edit that one instead.'
    case 'REDIRECT_LOOP': return 'This would complete a loop with redirects you already have.'
    case 'STATUS': return 'A redirect is either permanent (301) or temporary (302).'
    default: return 'This redirect could not be saved.'
  }
}
