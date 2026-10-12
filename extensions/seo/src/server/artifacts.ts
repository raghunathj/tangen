/**
 * File Name: artifacts.ts
 * Purpose: The SEO artifacts a website reads - resolved metadata, robots.txt,
 *          the sitemap - and the version that makes their cache entries
 *          unreachable the moment anything they depend on changes (closure
 *          plan Phase 9A, Units 18 and 19).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Invalidation is a VERSION, not a sweep. Every artifact
 *          key carries it, so one write retires every stale entry at once -
 *          the technique Phase 6B used for the schema fingerprint. The
 *          alternative, enumerating keys to delete, cannot be done correctly
 *          for a paged sitemap and would be a TTL in disguise.
 */
import { resolveSeo } from '../lib/resolve'
import { readStored, pickMetadata } from '../lib/metadata'
import { normalizeSettings, SEO_SETTINGS_KEY } from '../lib/settings'
import { buildSiteSchema, buildTypeSchema } from '../lib/schemas'
import { normalizeSchemaMap, SEO_SCHEMA_MAP_KEY } from '../lib/schema-map'
import { buildLlmsTxt, type LlmsGroup, type LlmsItem } from '../lib/llms'
import { robotsTxtFor, serializeRobotsTxt } from '../lib/robots'
import { buildSitemap, SITEMAP_PAGE_SIZE, type SitemapObject } from './sitemap-source'
import { objectUrl, urlFieldValue } from '../lib/object-url'
import { partitionEntries, sitemapIndexXml, sitemapXml } from '../lib/sitemap'
import type { ResolvedSeo, SeoHelpers } from '../contract'
import type { ExtensionServerCtx } from '@tangen/cms'

/**
 * The key the artifact version lives under. Exported because the content
 * hooks write it too: a hook has no server ctx, and `extensionData` and
 * `ctx.store` are the same row addressed two ways.
 */
export const ARTIFACT_VERSION_KEY = 'artifact-version'

/** Seconds. Short: the version is what actually invalidates, this is a floor. */
export const ARTIFACT_TTL = 300

/** The version a stored row represents, defaulting to 1 for a scope with none. */
export function versionOf(row: unknown): number {
  const v = Number((row as { v?: unknown } | undefined | null)?.v)
  return Number.isFinite(v) && v > 0 ? v : 1
}

/** The next version after whatever is stored. */
export function nextVersion(row: unknown): number {
  return versionOf(row) + 1
}

/** The current artifact version for this workspace x environment. */
export async function artifactVersion(ctx: ExtensionServerCtx): Promise<number> {
  return versionOf(await ctx.store.get(ARTIFACT_VERSION_KEY))
}

/**
 * Retires every cached artifact in this scope. Called when content publishes
 * or unpublishes, when SEO metadata changes and when a redirect changes -
 * the four things an artifact is derived from.
 */
export async function bumpArtifactVersion(ctx: ExtensionServerCtx): Promise<number> {
  const next = (await artifactVersion(ctx)) + 1
  await ctx.store.put(ARTIFACT_VERSION_KEY, { v: next })
  return next
}

/**
 * A cache key carrying every identity the answer depends on. Phase 8A and 8B
 * both found real leaks from a key that carried one dimension too few; the
 * platform's own key already prefixes workspace and environment, and this
 * adds the locale and the version.
 */
export const artifactKey = (name: string, version: number, locale?: string | null): string =>
  `seo:${name}:v${version}:${locale ?? '-'}`

export const helpersOf = (ctx: ExtensionServerCtx): SeoHelpers => (ctx.options ?? {}) as SeoHelpers

/** The environment's role, or null - never inferred from the slug (Phase 5A). */
export async function roleOf(ctx: ExtensionServerCtx): Promise<'development' | 'staging' | 'production' | null> {
  try { return (ctx.deploymentRole?.()) ?? null } catch { return null }
}

// ── robots.txt ───────────────────────────────────────────────────────────────

export async function robotsTxt(ctx: ExtensionServerCtx): Promise<string> {
  const helpers = helpersOf(ctx)
  const role = await roleOf(ctx)
  const doc = robotsTxtFor(role, helpers)
  // A production site's sitemap is worth naming, and only production's.
  if (role === 'production' && helpers.siteUrl && !doc.sitemaps?.length) {
    return serializeRobotsTxt({ ...doc, sitemaps: [`${helpers.siteUrl.replace(/\/+$/, '')}/sitemap.xml`] })
  }
  return serializeRobotsTxt(doc)
}

// ── Resolved metadata ────────────────────────────────────────────────────────

export interface ResolveArgs {
  type: string
  id: string
  locale?: string | null
  /** Draft reads are for a member preview; a website always reads published. */
  preview?: boolean
}

/**
 * The resolved SEO for one object. A public caller sees the PUBLISHED
 * snapshot; there is no path from a draft edit to a public answer.
 */
export async function resolvedSeoFor(ctx: ExtensionServerCtx, args: ResolveArgs): Promise<ResolvedSeo | null> {
  const client = ctx.tangen
  if (!client) return null

  let object: Record<string, unknown>
  try {
    const res = await client.objects(args.type as never).status('any').find(args.id)
    object = res.data as Record<string, unknown>
  } catch { return null }
  if (!object) return null

  const published = String(object.status ?? '') === 'published'
  if (!published && !args.preview) return null

  const stored = readStored(await ctx.store.get(args.id))
  const scoped = args.preview ? stored.draft : (stored.published ?? { base: {} })

  const helpers = helpersOf(ctx)
  const settings = normalizeSettings(await ctx.store.get(SEO_SETTINGS_KEY))
  // The share image is the object's own, then the workspace default from settings.
  const imageId = pickMetadata(scoped, args.locale).social?.imageId ?? settings.social.defaultImageId ?? null
  const socialImageUrl = await resolveMediaUrl(ctx, imageId)
  // The site-level entity graph (Organization + WebSite) from settings, carried
  // on every page. The app owns the origin (helpers.siteUrl) and the logo URL.
  const logoUrl = await resolveMediaUrl(ctx, settings.organization.logoId ?? null)
  const siteSchema = buildSiteSchema(settings, { siteUrl: helpers.siteUrl, logoUrl: logoUrl ?? undefined })

  // The generated per-content-type node (Article, Product, ...) from the map.
  const slug = (object.slug as string | null) ?? null
  const schemaMap = normalizeSchemaMap(await ctx.store.get(SEO_SCHEMA_MAP_KEY))
  const typeConfig = schemaMap[args.type]
  // One answer, used by the canonical, the type schema and anything else here:
  // the site's resolver first, then the field it declared for this type.
  const resolvedPageUrl = await objectUrl({
    helpers, workspaceId: ctx.workspaceId, type: args.type, id: args.id, locale: args.locale, slug,
    fieldValue: urlFieldValue(helpers, args.type, object),
  })
  const pageUrl = resolvedPageUrl ?? undefined
  const typeSchema = typeConfig
    ? buildTypeSchema(typeConfig, {
        object,
        title: (object.title as string | null) ?? undefined,
        url: pageUrl,
        organizationName: settings.organization.name,
      })
    : null

  return resolveSeo({
    workspaceId: ctx.workspaceId,
    type: args.type,
    id: args.id,
    locale: args.locale,
    slug,
    scoped,
    published,
    content: { title: (object.title as string | null) ?? null },
    pageUrl: resolvedPageUrl,
    helpers,
    socialImageUrl,
    robotsDefault: { index: settings.robots.defaultIndex, follow: settings.robots.defaultFollow },
    siteSchema,
    typeSchema,
  })
}

/**
 * An absolute media URL, from the application's resolver. Without one the
 * image is omitted: an internal storage path is not a social image URL, and
 * Tangen does not know the site's CDN.
 */
async function resolveMediaUrl(ctx: ExtensionServerCtx, mediaId: string | null): Promise<string | null> {
  if (!mediaId) return null
  const resolver = helpersOf(ctx).resolveMediaUrl
  if (!resolver) return null
  try { return (await resolver({ workspaceId: ctx.workspaceId, mediaId })) ?? null } catch { return null }
}

// ── Sitemap ──────────────────────────────────────────────────────────────────

/** Published objects, one bounded page at a time. */
export async function* publishedObjects(ctx: ExtensionServerCtx, types: string[]): AsyncGenerator<SitemapObject[]> {
  const client = ctx.tangen
  if (!client) return
  for (const type of types) {
    let offset = 0
    for (;;) {
      let rows: Record<string, unknown>[] = []
      try {
        const res = await client.objects(type as never).status('published')
          .sort('id', 'asc').limit(SITEMAP_PAGE_SIZE).offset(offset).get()
        rows = (res.data ?? []) as Record<string, unknown>[]
      } catch { break }
      if (rows.length === 0) break
      yield rows.map((r) => ({
        id: String(r.id),
        type,
        slug: (r.slug as string | null) ?? null,
        title: (r.title as string | null) ?? null,
        urlFieldValue: urlFieldValue(helpersOf(ctx), type, r),
        updatedAt: (r.updated_at ?? r.updatedAt) as string | null,
        publishedAt: (r.published_at ?? r.publishedAt) as string | null,
      }))
      if (rows.length < SITEMAP_PAGE_SIZE) break
      offset += SITEMAP_PAGE_SIZE
    }
  }
}

/**
 * The llms.txt / llms-full.txt manifest, or null when the GEO toggle is off (so
 * the route 404s rather than serving an empty file). Enumerates published
 * objects per eligible type, resolves each page url via the app's resolver, and
 * groups by type. The -full variant adds each object's own summary field.
 */
export async function buildLlmsManifest(ctx: ExtensionServerCtx, opts: { full?: boolean }): Promise<string | null> {
  const settings = normalizeSettings(await ctx.store.get(SEO_SETTINGS_KEY))
  if (!settings.geo.llmsTxtEnabled) return null

  const helpers = helpersOf(ctx)
  const client = ctx.tangen
  const typeLabels = new Map<string, string>()
  try { for (const t of ctx.types?.() ?? []) typeLabels.set(t.name, (t as { label?: string }).label ?? t.name) } catch { /* names only */ }

  const groups: LlmsGroup[] = []
  if (client && helpers.resolveUrl) {
    for (const type of sitemapTypes(ctx)) {
      const items: LlmsItem[] = []
      let offset = 0
      for (;;) {
        let rows: Record<string, unknown>[] = []
        try {
          const res = await client.objects(type as never).status('published').sort('id', 'asc').limit(SITEMAP_PAGE_SIZE).offset(offset).get()
          rows = (res.data ?? []) as Record<string, unknown>[]
        } catch { break }
        if (rows.length === 0) break
        for (const row of rows) {
          const id = String(row.id)
          let url: string | null = null
          try {
            url = await objectUrl({
              helpers, workspaceId: ctx.workspaceId, type, id, locale: null,
              slug: (row.slug as string | null) ?? null, fieldValue: urlFieldValue(helpers, type, row),
            })
          } catch { /* app owns urls */ }
          if (!url) continue
          const item: LlmsItem = { title: (row.title as string) || id, url }
          if (opts.full) {
            const summary = (row.excerpt ?? row.summary ?? row.description ?? row.metaDescription)
            if (typeof summary === 'string' && summary.trim()) item.summary = summary.trim()
          }
          items.push(item)
        }
        if (rows.length < SITEMAP_PAGE_SIZE) break
        offset += SITEMAP_PAGE_SIZE
      }
      if (items.length) groups.push({ label: typeLabels.get(type) ?? type, items })
    }
  }

  return buildLlmsTxt({ siteName: settings.general.siteName, groups }, opts)
}

/** The types a sitemap considers: the site's list, or every type it has. */
export function sitemapTypes(ctx: ExtensionServerCtx): string[] {
  const declared = helpersOf(ctx).sitemapTypes
  if (declared?.length) return declared
  try { return (ctx.types?.() ?? []).map((t) => t.name) } catch { return [] }
}

export async function sitemapBuild(ctx: ExtensionServerCtx, locale?: string | null) {
  return buildSitemap({
    workspaceId: ctx.workspaceId,
    locale,
    helpers: helpersOf(ctx),
    store: ctx.store,
    objects: publishedObjects(ctx, sitemapTypes(ctx)),
    resolveUrl: helpersOf(ctx).resolveUrl,
  })
}

/** One sitemap page as XML, plus how many pages there are in total. */
export async function sitemapPageXml(ctx: ExtensionServerCtx, page: number, locale?: string | null) {
  const build = await sitemapBuild(ctx, locale)
  const pages = partitionEntries(build.entries)
  const index = Math.max(1, Math.floor(page))
  return { xml: sitemapXml(pages[index - 1] ?? []), pageCount: pages.length, build }
}

/** The index over the pages, using the site's own origin for each reference. */
export async function sitemapIndex(ctx: ExtensionServerCtx, locale?: string | null) {
  const build = await sitemapBuild(ctx, locale)
  const pages = partitionEntries(build.entries)
  const base = (helpersOf(ctx).siteUrl ?? '').replace(/\/+$/, '')
  const refs = pages.map((_, i) => ({ loc: `${base}/sitemap.xml?page=${i + 1}` }))
  return { xml: sitemapIndexXml(refs), pageCount: pages.length, build }
}
