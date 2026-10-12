/**
 * File Name: server.ts
 * Purpose: The Studio server entry - section presets in the extension store
 *          (preset:* keys, per workspace; no tables, no migrations,
 *          Porter-portable through the store like flows definitions; the
 *          Builder Kit starter gallery seeds itself on first read) plus
 *          POST generate: a brief becomes a whole draft page (or ONE section
 *          with single:true) composed from the type's component vocabulary
 *          via the platform's ctx.ai structured generation, seasoned with
 *          workspace knowledge facts where RAG is configured. GET tokens
 *          serves the effective design tokens - slot lists, values and
 *          fonts: the config's `studio.tokens` seed under the workspace
 *          theme stored in this store (`theme:*`, T-T1) - what the style
 *          panel and the stylesheet both read. Per-page raw CSS (X-T2) lives under `page:<id>`
 *          and rides the page artifact. GET collections serves the Data
 *          panel: every enabled type with its live published count. The
 *          palette and the Studio pages talk to adminRoutes under
 *          /api/v1/admin/ext/studio/.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Saving/listing/generate require studio:edit; class,
 *          tag, token, theme and stylesheet WRITES require studio:design
 *          (split off studio:edit, 2026-08-25 - the reads the canvas renders
 *          from stay on studio:edit, or a marketer would be shown a page that
 *          is not the page); rename/delete require studio:manage
 *          (capability-gated by route declaration, enforced by the platform
 *          before the handler runs); saving a shared surface requires
 *          studio:globals.
 *          Generation NEVER writes - the admin applies the returned blocks
 *          through the object editor's own draft save path, so publish stays
 *          the normal gated flow. `objectId` is accepted for forward
 *          compatibility (page-aware context) but unused today.
 */
import { defineExtensionServer } from '@tangen/cms'
import type { ExtensionServerCtx } from '@tangen/types'
import { mergeTheme, themeKey, themeFontKey, themeValueError, readThemeFont, THEME_PREFIX } from './lib/theme'
import { resolveStyleMode } from './lib/governance'
import { CREATIVE_STYLE_FIELDS } from './lib/creative-style'
import { readCustomCss, RAW_CSS_OVERRIDE } from './lib/custom-css'
import { findBlocksField } from './lib/model'
import { normalizeClassName } from './lib/classes'
import { TAG_PREFIX, tagByName } from './lib/tag-defaults'
import { normalizeValue, propertyById, styleHash, type StoredValue } from '@tangen/studio'
import { publishArtifact, composeCss, compileStyles, type Refusal, type RuleTarget, type PublishedInstances } from '@tangen/studio-compiler'
import { protectionsFor, classTarget } from './lib/protections'
import { usageAcrossPages, mergeReferences, type PageBlocks } from './lib/class-usage'
import { pageRegions } from './lib/regions'
import {
  discoverInstanceType, readPlacement, instanceTitle, referencedInstanceIds,
  instanceUsageAcrossPages, instanceDeleteRefusal, type UsageDocument,
} from './lib/instances'
import { normalizeInteraction, normalizeTier2Interaction } from '@tangen/studio-schema'
import { deliveryFor } from './lib/store-delivery'
import {
  discoverGlobalSurfaces, surfaceBlocks, SURFACES_ROUTE,
  approvedSurface, readSurfaceWrite, surfaceSaveBody,
  type GlobalCandidate, type LoadedSurface, type SkippedGlobal,
} from './lib/global-surfaces'
import {
  STYLES_ROUTE as DELIVERY_STYLES_ROUTE, pageRoute, readPagePublishBody, interactionsFromClasses,
} from './lib/page-artifact'
import { mintBlockKey } from './lib/presets'
import { pageStyles, SECTION_CSS_OVERRIDE } from './lib/section-css'
import { staleWrite, newRev } from './lib/style-history'
import { kitTemplates } from './lib/templates'
import {
  MAX_GENERATED_BLOCKS,
  buildBlocksJsonSchema,
  sanitizeGeneratedBlocks,
  buildGenerateSystemPrompt,
  buildGenerateUserPrompt,
  type GenComponentDef,
} from './lib/generate'

/**
 * The override names an audit may echo back - never an unknown one.
 *
 * The retired Creative controls, plus raw CSS. W-3 retired Creative Mode INTO
 * raw CSS per class, and the audit had to follow it there: the trail exists
 * because that is the place Studio's token-only promise is relaxed, so
 * dropping it along with the panel would have retired the governance too.
 * X-T1's per-section raw CSS is the same relaxation on a block, and reports
 * under its own name.
 */
const CONTROL_NAMES = new Set([...CREATIVE_STYLE_FIELDS.map((f) => f.name), RAW_CSS_OVERRIDE, SECTION_CSS_OVERRIDE])

/** Field types a loop item template cannot bind to - containers, not content. */
const LOOP_UNBINDABLE_TYPES = new Set(['component', 'repeater', 'group', 'object'])

export const PRESET_PREFIX = 'preset:'

/** Marker key (outside preset:*) - present once the gallery has been seeded. */
export const TEMPLATES_SEEDED_KEY = 'seeded:kit-templates'

const newId = () => `ps_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`

/**
 * B-T7: seed the starter template gallery into the store, once per
 * workspace. Lazy (first presets read) rather than onInstall - the
 * install hook carries no store, and config-resolved extensions never fire
 * it. Marker-first so a concurrent first read skips instead of
 * double-seeding; after seeding the templates are ordinary presets the
 * marketer renames, edits, or deletes (a deleted template STAYS deleted -
 * the marker, not the rows, records that seeding happened).
 */
async function ensureTemplatesSeeded(ctx: ExtensionServerCtx): Promise<void> {
  if (await ctx.store.get(TEMPLATES_SEEDED_KEY)) return
  const now = new Date().toISOString()
  await ctx.store.put(TEMPLATES_SEEDED_KEY, { seededAt: now })
  for (const t of kitTemplates()) {
    await ctx.store.put(`${PRESET_PREFIX}${newId()}`, { name: t.name, block: t.block, createdAt: now, updatedAt: now })
  }
}

/** Validate + normalize an incoming preset body. Throws on junk. */
/** Style classes live beside presets in the same per-workspace store. */
export const CLASS_PREFIX = 'class:'

/**
 * Per-page raw CSS (X-T2) lives here, keyed by object id, beside `class:`
 * and `tag:`. The object's own values are the type's fields and the platform
 * refuses an unknown key, so the page's Studio settings are the extension's
 * store - the same store that makes them Porter-portable once WF-S10 lands.
 */
export const PAGE_CSS_PREFIX = 'page:'

/**
 * The workspace theme (T-T1): `theme:<var>` rows hold token values,
 * `theme:font:<name>` rows hold fonts - see lib/theme.ts. Listed by
 * `THEME_PREFIX` wherever tokens are read, so the stylesheet, the canvas and
 * the panel all see one merge.
 */
export { THEME_PREFIX }

/**
 * The delivery route the workspace stylesheet publishes under.
 *
 * Re-exported rather than declared here: the page-route rules have to REFUSE
 * this route, and they live beside it in page-artifact so the reservation and
 * the check can never drift apart.
 */
export { STYLES_ROUTE } from './lib/page-artifact'

/**
 * The version the caller believes it is editing, if it said.
 *
 * Opt-in on purpose: a client that sends nothing is not blocked, so this
 * could ship without breaking callers that predate it.
 */
function expectedVersion(body: unknown): string | undefined {
  const v = (body as { expectedVersion?: unknown } | null)?.expectedVersion
  return typeof v === 'string' && v ? v : undefined
}

/**
 * Announces a class or tag write on the platform bus, so an editor holding
 * the same class on screen hears "changed elsewhere" BEFORE the stale-write
 * guard refuses their next save. The bridge fans `studio.class.changed` and
 * `studio.tag.changed` to `studio:<objectId>` when the write names a page and
 * to `studio:classes` always.
 *
 * The page context is `?objectId=` on the request: the routes are page-
 * agnostic (a class is workspace-wide), and a library edit from the
 * housekeeping list genuinely has no page. `rev` is the row's version TOKEN -
 * the string the guard compares - so a consumer can tell that the rev it
 * holds is older without a second fetch. The emit is optional (a runtime
 * without `emitPlatform` writes exactly as before) and runs after the store
 * write, so a refused write announces nothing.
 */
type DesignWriteReq = { query?: Record<string, string>; body?: unknown; memberId?: string }

function pageContext(req: DesignWriteReq): string | undefined {
  const fromQuery = req.query?.objectId
  if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim()
  const fromBody = (req.body as { objectId?: unknown } | null)?.objectId
  return typeof fromBody === 'string' && fromBody.trim() ? fromBody.trim() : undefined
}

function announceDesignChange(
  ctx: ExtensionServerCtx,
  type: 'studio.class.changed' | 'studio.tag.changed',
  req: DesignWriteReq,
  row: { name: string; rev: unknown },
): void {
  if (!ctx.emitPlatform) return
  const objectId = pageContext(req)
  ctx.emitPlatform(
    type,
    { ...(objectId ? { objectId } : {}), name: row.name, rev: typeof row.rev === 'string' ? row.rev : '', actorId: req.memberId ?? '' },
    { actorId: req.memberId ?? null, actorType: req.memberId ? 'member' : null },
  )
}

/**
 * Announces a theme write (one token value or one font) the same way, as
 * `studio.theme.changed`. A theme names no page, so the bridge fans it to
 * `studio:classes` only; `name` is the entry as GET tokens lists it
 * (`bg-brand`, `font:Display`) and `rev` is empty when the row was removed
 * (a reset to the config value). Runs after the store write, so a refused
 * write announces nothing.
 */
function announceThemeChange(ctx: ExtensionServerCtx, req: DesignWriteReq, row: { name: string; rev: string | undefined }): void {
  if (!ctx.emitPlatform) return
  ctx.emitPlatform(
    'studio.theme.changed',
    { name: row.name, rev: row.rev ?? '', actorId: req.memberId ?? '' },
    { actorId: req.memberId ?? null, actorType: req.memberId ? 'member' : null },
  )
}

/**
 * The interaction a class body carries, settled through the schema's
 * normaliser so only the vocabulary is stored. Three outcomes: a usable
 * interaction, `null` meaning "remove it", or `undefined` meaning the body
 * did not mention it and the stored one stands.
 */
function readInteraction(body: unknown, className: string): Record<string, unknown> | null | undefined {
  const b = (body ?? {}) as Record<string, unknown>
  if (!('interaction' in b)) return undefined
  if (b.interaction === null) return null
  const raw = b.interaction
  const tier1 = normalizeInteraction(raw)
  if (tier1) return tier1 as unknown as Record<string, unknown>
  // Tier 2 addresses elements by selector, so the declaration carries the
  // class name - injected from the row here, never trusted from the body, so
  // a rename can never leave a stale selector behind.
  const tier2 = raw && typeof raw === 'object'
    ? normalizeTier2Interaction({ ...(raw as Record<string, unknown>), className })
    : null
  if (tier2) return tier2 as unknown as Record<string, unknown>
  throw new Error('That interaction is not one Studio knows - pick an event and an action from the list')
}

/**
 * The Block part a class body aims the class at, or undefined for none.
 *
 * Read through the same reader the compiler uses (`classTarget`), so a
 * target that would compile as untargeted is refused at the door rather
 * than stored: a designer who aimed a class at the button and got an
 * ordinary root class would see their styling land in the wrong place and
 * have no way to tell why.
 */
function readTarget(body: unknown): RuleTarget | undefined {
  const b = (body ?? {}) as Record<string, unknown>
  if (b.target === undefined || b.target === null) return undefined
  const target = classTarget(b)
  if (!target) throw new Error('That target is not one Studio knows - it needs a blockType, a kind, and for a part its name')
  return target
}

function readClassBody(body: unknown): { name: string; props: Record<string, StoredValue> } {
  const b = (body ?? {}) as Record<string, unknown>
  const name = normalizeClassName(typeof b.name === 'string' ? b.name : '')
  if (!name) throw new Error('A class name is required - use letters, numbers and hyphens')

  // Only registry properties are stored. An unknown id would be dead weight
  // that the emitter drops anyway, so it is refused at the door instead.
  const raw = (b.props ?? {}) as Record<string, unknown>
  const props: Record<string, StoredValue> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!propertyById(id)) continue
    // A value is a plain string OR the per-breakpoint/per-state object; both
    // are accepted, and anything that normalises to nothing is dropped rather
    // than stored as an empty shell the emitter would skip anyway.
    if (typeof value === 'string') {
      if (value.trim() !== '') props[id] = value.trim()
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    // Stored only when it carries at least one real value: an object of
    // blanks normalises to undefined rather than becoming an empty shell the
    // emitter would skip anyway.
    const normalized = normalizeValue(value as StoredValue)
    if (normalized !== undefined) props[id] = normalized
  }
  return { name, props }
}

/**
 * The raw CSS this write should store, or undefined for none.
 *
 * Gated INSIDE the handler rather than on the route, because the route has to
 * stay open to `studio:edit` - everyone designing pages edits classes, and
 * only some may write raw CSS. Retiring Creative Mode did not fold its
 * capability into `studio:edit`; raw CSS is a wider hole than the freeform
 * bag ever was, so it kept its own.
 *
 * A request that does not MENTION custom leaves the stored value alone, so a
 * colleague nudging the padding never strips styling they cannot see. One
 * that does mention it must hold the capability, including to clear it.
 */
function readCustom(
  body: unknown,
  existing: string | undefined,
  can: ((capability: string) => boolean) | undefined,
): string | undefined {
  const b = (body ?? {}) as Record<string, unknown>
  if (!('custom' in b)) return existing
  const asked = typeof b.custom === 'string' && b.custom.trim() !== '' ? b.custom.trim() : undefined
  if (asked === existing) return existing
  // The capability is checked BEFORE the CSS is validated: a member who may
  // not write raw CSS at all should be told that, not handed a critique of
  // the CSS they were never allowed to write. No `can` at all means no
  // evidence of the grant - fail closed, because a missing check must never
  // read as permission.
  if (!can?.('studio:creative')) {
    throw new Error('Raw CSS needs the "Use Creative (freeform) styling" capability')
  }
  return readCustomCss(b.custom)
}

/**
 * The design gate, for the two routes a capability declaration cannot state.
 *
 * Deleting and merging a class are BOTH design work and the class actions
 * that unstyle pages the actor cannot see, so they keep `studio:manage` on
 * the route AND ask for `studio:design` here. Before the split, `studio:edit`
 * came with `studio:manage` and carried style editing with it; leaving the
 * manage gate alone would have left a preset manager able to delete the whole
 * design system without ever holding a design grant.
 *
 * No `can` at all is no evidence of the grant, so it fails closed - a missing
 * check must never read as permission.
 */
function requireDesign(can: ((capability: string) => boolean) | undefined): void {
  if (can?.('studio:design')) return
  throw new Error('Class housekeeping needs the design capability (studio:design)')
}

/** The raw CSS a stored class row already carries. */
function storedCustom(row: unknown): string | undefined {
  const v = (row as { custom?: unknown } | null)?.custom
  return typeof v === 'string' && v.trim() !== '' ? v : undefined
}

/**
 * The raw CSS a NEW class should carry - the same gate, plus the one case
 * that is not authorship.
 *
 * "Make unique" forks a shared class so people stop forking pre-emptively out
 * of fear, and a fork that dropped the raw CSS would silently unstyle the
 * element for someone who cannot even see what went. Copying styling the
 * workspace already holds introduces nothing, so it needs no new grant - but
 * the copy is VERIFIED against the named source, or `copyOf` would just be a
 * way to write raw CSS with an extra field attached.
 */
async function readCustomForCreate(
  body: unknown,
  can: ((capability: string) => boolean) | undefined,
  ctx: ExtensionServerCtx,
): Promise<string | undefined> {
  const b = (body ?? {}) as Record<string, unknown>
  if (!('custom' in b)) return undefined
  const asked = typeof b.custom === 'string' && b.custom.trim() !== '' ? b.custom.trim() : undefined
  if (asked === undefined) return undefined
  if (can?.('studio:creative')) return readCustomCss(b.custom)

  const copyOf = typeof b.copyOf === 'string' ? b.copyOf : null
  if (copyOf) {
    const source = await ctx.store.get(`${CLASS_PREFIX}${copyOf}`)
    if (storedCustom(source) === asked) return asked
  }
  throw new Error('Raw CSS needs the "Use Creative (freeform) styling" capability')
}

/** The published stylesheet - ONE key, so publishing is a single atomic write. */
export const LIVE_STYLES_KEY = 'styles:live'

/**
 * Serves the published stylesheet. Shared by the key-authenticated and public
 * routes: the ONLY difference between them is how the workspace was
 * identified, which the mount has already resolved by the time this runs.
 */
async function serveStylesheet(
  req: { headers?: Record<string, string> },
  ctx: { store: { get: (k: string) => Promise<Record<string, unknown> | undefined> } },
): Promise<Response> {
        const row = (await ctx.store.get(LIVE_STYLES_KEY)) as { css?: string; hash?: string } | undefined
        const css = typeof row?.css === 'string' ? row.css : ''
        const hash = typeof row?.hash === 'string' ? row.hash : styleHash(css)
        const etag = `"${hash}"`

        // A matching ETag means the browser already has this exact stylesheet.
        if (req.headers?.['if-none-match'] === etag) {
          return new Response(null, { status: 304, headers: { ETag: etag } })
        }
        return new Response(css, {
          headers: {
            'Content-Type': 'text/css; charset=utf-8',
            ETag: etag,
            // Revalidate every time, but transfer nothing when unchanged.
            // A long max-age would strand a published change behind a cache
            // for a day, which is exactly the "no rebuild" promise broken.
            'Cache-Control': 'public, max-age=0, must-revalidate',
          },
        })
}

/**
 * The day the deprecated extension stylesheet routes stop answering.
 *
 * One release of notice. A deprecation with no date is a suggestion; a date
 * is a commitment a proxy, a monitor or a person can plan around. Sent as
 * the `Sunset` header (RFC 8594) and named in the log. Deleting the routes
 * on that day is a separate, deliberate change - this is the notice that
 * precedes it. Documented in docs/studio.md.
 */
export const STYLES_ROUTE_SUNSET = '2026-11-30'

/** The successor every notice points at. */
const STYLES_SUCCESSOR = '/api/v1/delivery/tangen/routes/_styles.json'

/** Origins already told, per workspace, so a busy site writes one line and not one per request. */
const sunsetNoticed = new Set<string>()

/** Test helper - forgets which origins were told. */
export function resetSunsetNotices(): void {
  sunsetNoticed.clear()
}

/**
 * Logs that a deprecated route was called, once per origin and workspace.
 *
 * The header reaches the code that called; the log reaches the operator who
 * never reads response headers. Origin first, then Referer (a server-side
 * fetch often sends neither, and is still a caller worth counting).
 */
function noticeSunsetCaller(
  req: { headers?: Record<string, string> },
  ctx: { workspaceId?: string; log: (message: string) => void },
  path: string,
): void {
  const origin = req.headers?.origin || req.headers?.referer || 'unknown origin'
  const key = `${ctx.workspaceId ?? ''}|${origin}`
  if (sunsetNoticed.has(key)) return
  sunsetNoticed.add(key)
  ctx.log(
    `WARN deprecated route GET /api/v1/ext/studio/${path} called from ${origin}; `
    + `it stops answering on ${STYLES_ROUTE_SUNSET} - move to ${STYLES_SUCCESSOR} (see docs/studio.md)`,
  )
}

/**
 * Marks a response as coming from a deprecated route.
 *
 * A comment in the source only reaches whoever reads the source. The header
 * reaches whoever is actually still CALLING it, which is the person who has
 * to move - and it is a standard field, so a proxy or a log pipeline can
 * count the callers rather than anyone guessing. `Sunset` says WHEN, which
 * is what turns a warning into a plan.
 *
 * A 304 carries no body and must keep its header set minimal, so it is left
 * alone: the caller already saw the notice on the response that had one.
 */
function deprecated(res: Response): Response {
  if (res.status === 304) return res
  const headers = new Headers(res.headers)
  headers.set('Deprecation', 'true')
  headers.set('Sunset', new Date(STYLES_ROUTE_SUNSET).toUTCString())
  headers.set('Link', `<${STYLES_SUCCESSOR}>; rel="successor-version"`)
  return new Response(res.body, { status: res.status, headers })
}

/** What rendering the draft classes produced: the sheet, and what was left out. */
interface RenderedStyles {
  css: string
  /** Declarations the Block protection refused, with the reason each time. */
  refused: Refusal[]
}

/**
 * Reads every draft class and renders the stylesheet they describe - the
 * classes, tag defaults, tokens and fonts, and NOTHING else.
 *
 * Rendering goes through `compileStyles`, with the protection every component
 * def in this environment declares. That is what makes a Block's boundary
 * real at the edge the visitor reads: a class aimed at a part its author
 * never exposed is refused HERE, whatever the panel let through, and the
 * refusal is returned rather than dropped so publish can say what it left
 * out. An untargeted class is untouched - it is an ordinary workspace class,
 * and that is what the whole conformance matrix is made of.
 *
 * Interaction CSS is deliberately not composed in here. It used to be, and
 * publish then composed it a SECOND time on the way into the artifact: every
 * published stylesheet carried the shared keyframes and each interaction
 * rule twice, so the canvas and the visitor were reading different bytes. The
 * composition now happens exactly once, at each edge - see composedStyles.
 */
async function renderFromStore(ctx: {
  store: { list: (p?: string) => Promise<Array<{ key: string; data: Record<string, unknown> }>> }
  workspaceConfig?: () => Record<string, unknown> | undefined
  types?: () => Array<{ fields?: unknown }>
}): Promise<RenderedStyles> {
  const rows = await ctx.store.list(CLASS_PREFIX)
  const classes = rows.map(({ data }) => ({
    name: String((data as { name?: unknown }).name ?? ''),
    props: ((data as { props?: unknown }).props ?? {}) as Record<string, StoredValue>,
    custom: typeof (data as { custom?: unknown }).custom === 'string'
      ? (data as { custom: string }).custom
      : undefined,
    target: classTarget(data),
  }))
  const tagRows = await ctx.store.list(TAG_PREFIX)
  const tagDefaults = tagRows.flatMap(({ key, data }) => {
    // The stored KEY names the tag; an unrecognised one is skipped rather
    // than written into a selector.
    const tag = tagByName(key.slice(TAG_PREFIX.length))
    if (!tag) return []
    return [{ tag: tag.tag, props: ((data as { props?: unknown }).props ?? {}) as Record<string, StoredValue> }]
  })

  const config = ctx.workspaceConfig?.()
  // The workspace theme: the config seed under the stored overrides. ONE
  // merge, read here for the stylesheet and in GET tokens for the panel,
  // so what the panel shows as the value is what `:root` declares - on the
  // canvas and in the published artifact alike.
  const theme = mergeTheme({ config, rows: await ctx.store.list(THEME_PREFIX) })
  // Loud by design: a malformed declaration throws here with the component
  // and the key, so the draft and the publish both fail rather than render
  // a Block nobody decided to leave Open.
  const protections = protectionsFor(ctx.types?.())
  return compileStyles({
    classes, tagDefaults, tokens: theme.values, fonts: theme.fonts, protections,
  })
}

/**
 * The stylesheet as anyone actually READS it: the classes plus their compiled
 * motion.
 *
 * One function, so the canvas and the published artifact cannot drift. The
 * canvas has to preview an interaction the same way publish compiles it -
 * without that, a designer adds one, sees nothing move, and concludes it does
 * not work.
 */
function composedStyles(base: string, interactions: Array<{ className: string; interaction: unknown }>): string {
  return composeCss({ route: '', blocks: [], css: base, interactions })
}

/** What one styling publish produced. */
interface PublishedStyles {
  /** The stylesheet as served - classes plus compiled motion. */
  css: string
  /**
   * The same stylesheet BEFORE its motion is composed in.
   *
   * Carried separately because `publishArtifact` composes the interactions
   * itself. Handing it the already-composed sheet published every keyframe
   * and every interaction rule twice, and made the artifact differ from the
   * canvas - so a page artifact is built from this, never from `css`.
   */
  base: string
  hash: string
  publishedAt: string
  /** The versioned artifact the stylesheet route now points at. */
  artifact: string
  /** The interactions that stylesheet was published with. */
  interactions: Array<{ className: string; interaction: unknown }>
  /**
   * What the Block protection kept OUT of the published sheet. Returned to
   * the caller and logged, never swallowed: a declaration that vanished
   * without a word is the silent failure the ownership model exists to end.
   */
  refused: Refusal[]
}

/**
 * Publishes the workspace stylesheet - the live row AND the versioned
 * artifact.
 *
 * Shared by the styling publish and the page publish, because a page artifact
 * has to carry the same CSS the stylesheet route serves. Two copies of this
 * would eventually publish two different stylesheets and nobody would be able
 * to tell which one a visitor got.
 *
 * The versioned artifact is what visitors read, so its write is REQUIRED
 * rather than best-effort. `publishArtifact` is atomic: it writes and verifies
 * every immutable artifact before moving the route pointer, so a failure here
 * leaves the previously published version live and untouched.
 *
 * The live row is written first and kept as the compatibility path for sites
 * still fetching the extension stylesheet route. It is deprecated, and goes
 * once they have migrated.
 */
async function publishStyles(ctx: ExtensionServerCtx, memberId?: string | null): Promise<PublishedStyles> {
  const { css: base, refused } = await renderFromStore(ctx)
  if (refused.length > 0) {
    ctx.log(`Publish refused ${refused.length} declaration${refused.length === 1 ? '' : 's'} by Block protection: ${
      refused.map((r) => `.${r.rule} ${r.property} (${r.reason})`).join('; ')}`)
  }
  const interactions = interactionsFromClasses(await ctx.store.list(CLASS_PREFIX))
  const css = composedStyles(base, interactions)
  const row = {
    css,
    hash: styleHash(css),
    publishedAt: new Date().toISOString(),
    publishedBy: memberId ?? null,
    // Recorded with the stylesheet so a later page publish uses the
    // interactions that were PUBLISHED, not whatever the drafts hold now.
    interactions,
  }
  await ctx.store.put(LIVE_STYLES_KEY, row)

  // The BASE sheet: publishArtifact composes the motion itself, so handing it
  // `css` would emit every keyframe and every interaction rule twice.
  const published = await publishArtifact(deliveryFor(ctx), {
    route: DELIVERY_STYLES_ROUTE, blocks: [], css: base, interactions,
  })
  return { css, base, hash: row.hash, publishedAt: row.publishedAt, artifact: published.version, interactions, refused }
}

/**
 * Why a page publish failed, as a code a client may see.
 *
 * The `publish.failed` event reaches every subscriber of the object, so it
 * carries one of these and never the thrown message. Each stage of the
 * publish throws with its own code; anything uncoded is `publish_failed`.
 */
export type PublishFailureCode =
  | 'object_not_published'
  | 'type_unavailable'
  | 'no_region'
  | 'route_invalid'
  | 'artifact_write_failed'
  | 'publish_failed'

/** An error that knows its code. The message is still for the log and the caller. */
class PublishFailure extends Error {
  constructor(readonly code: PublishFailureCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PublishFailure'
  }
}

/** The code for a publish error - coded stages name theirs, anything else is generic. */
export function publishFailureCode(err: unknown): PublishFailureCode {
  return err instanceof PublishFailure ? err.code : 'publish_failed'
}

/** Runs one stage of a publish, so whatever it throws is attributed to that stage. */
async function stage<T>(code: PublishFailureCode, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof PublishFailure) throw err
    throw new PublishFailure(code, err instanceof Error ? err.message : String(err), { cause: err })
  }
}

/**
 * Publishes one page: the workspace stylesheet, then the page artifact under
 * the page's own route.
 *
 * The PUBLISHED snapshot is read server-side. Blocks sent by the browser are
 * not trusted here: workspace id and environment are public routing
 * identifiers, and they must never be able to put a draft on a public
 * route. A page that is not published 404s, which is right - there is
 * nothing to deliver.
 *
 * Styling publishes in the same call. Classes are workspace-global and there
 * is no separate per-page style draft, so a designer who styles a page and
 * clicks Publish means both - and a page artifact built against an empty
 * published stylesheet would render the site unstyled.
 */
async function publishPage(
  c: ExtensionServerCtx,
  page: { type: string; id: string; region?: string },
  memberId?: string | null,
) {
  const { type, id, region } = page
  const tangen = c.tangen
  if (!tangen) throw new Error('Publishing a page artifact needs the content client, which this runtime does not provide')
  const values = await stage('object_not_published', async () => {
    const { data } = await tangen.objects(type).status('published').find(id)
    return (data ?? {}) as unknown as Record<string, unknown>
  })

  const typeDef = (c.types?.() ?? []).find((t) => t.name === type)
  if (!typeDef) throw new PublishFailure('type_unavailable', `Type "${type}" is not available in this environment`)
  const field = findBlocksField(typeDef.fields, region)
  if (!field) {
    throw new PublishFailure('no_region', region
      ? `Type "${type}" has no "${region}" region for Studio to publish`
      : `Type "${type}" has no blocks (component) field for Studio to publish`)
  }

  const route = pageRoute(values.slug)
  if (!route) {
    throw new PublishFailure('route_invalid', 'This page needs a slug that can be a URL before it can be delivered')
  }

  const styles = await stage('artifact_write_failed', () => publishStyles(c, memberId))

  // Media inside these blocks is already the asset object with its url: the
  // content client expands media at every depth (media-loader's
  // expandMediaDeep), and the artifact keeps what it was handed. The
  // visitor's site renders page.json as delivered, with no expansion step,
  // so an id here would be an <img src="med_..."> on the live site.
  const blocks = Array.isArray(values[field.name]) ? values[field.name] as Array<Record<string, unknown>> : []
  // The page's OWN CSS - the page-level raw CSS (X-T2) scoped to its
  // top-level blocks, then its sections' raw CSS (X-T1) - compiled from the
  // published snapshot through the same function the canvas previews with,
  // and judged by the same protections the workspace stylesheet is. Refused
  // declarations are logged like the stylesheet's, never swallowed.
  const pageRow = await c.store.get(`${PAGE_CSS_PREFIX}${id}`) as { css?: unknown } | undefined
  const own = pageStyles({
    blocks, protections: protectionsFor(c.types?.()),
    page: typeof pageRow?.css === 'string' ? pageRow.css : undefined,
  })
  if (own.refused.length > 0) {
    c.log(`Publish refused ${own.refused.length} raw CSS declaration${own.refused.length === 1 ? '' : 's'} by Block protection: ${
      own.refused.map((r) => `.${r.rule} ${r.property} (${r.reason})`).join('; ')}`)
  }
  // `base`, not `css`: publishArtifact composes the motion, and the composed
  // sheet would carry it twice - see PublishedStyles.
  const published = await stage('artifact_write_failed', () => publishArtifact(deliveryFor(c), {
    route, blocks, css: styles.base, interactions: styles.interactions, pageCss: own.css,
  }))
  // The shared surfaces publish with every page, as the stylesheet does: a
  // header edited in Settings > Globals (outside Studio, no Save button of
  // ours involved) reaches the delivery layer at the next page publish, so
  // the site and the artifact cannot disagree about what the header says.
  const surfaces = await stage('artifact_write_failed', () => publishSurfaces(c))
  return { route, published, styles, surfaces, refused: own.refused }
}

/** The globals the workspace declares, as the surface discovery reads them. */
function declaredGlobals(ctx: ExtensionServerCtx): GlobalCandidate[] {
  const raw = ctx.workspaceConfig?.()?.globals
  return Array.isArray(raw) ? (raw as GlobalCandidate[]) : []
}

/**
 * Every surface the workspace declares, with the blocks it holds now. Read
 * through the content client's globals accessor, and ONLY the surface field
 * of each: a global also carries a site name, a logo, an analytics id, none
 * of which a member designing pages needs to see.
 */
async function readSurfaces(ctx: ExtensionServerCtx): Promise<{ surfaces: LoadedSurface[]; skipped: SkippedGlobal[] }> {
  const { surfaces, skipped } = discoverGlobalSurfaces(declaredGlobals(ctx))
  if (surfaces.length === 0) return { surfaces: [], skipped }
  if (!ctx.tangen) throw new Error('Reading shared surfaces needs the content client, which this runtime does not provide')
  const loaded: LoadedSurface[] = []
  for (const surface of surfaces) {
    const stored = await ctx.tangen.globals(surface.global as never).get() as Record<string, unknown>
    loaded.push({ surface, blocks: surfaceBlocks(stored, surface) })
  }
  return { surfaces: loaded, skipped }
}

/**
 * Every PUBLISHED instance of this environment, by id, or the reason there
 * are none to read.
 *
 * Published snapshots only, exactly like the page publish: a workspace id
 * and an environment are public routing identifiers, so a draft instance
 * must never become reachable through the delivery layer - and an instance
 * is reachable from every page that references it, which multiplies that
 * mistake by the usage count.
 *
 * `null` for the map means "this environment has no instances to publish",
 * which is different from "it has none": the first must leave the artifact
 * key absent, so an environment that never had instances keeps the artifact
 * id it already published, and the second publishes an empty map so a runtime
 * can tell "none published" from "never published".
 */
async function readPublishedInstances(
  ctx: ExtensionServerCtx,
): Promise<{ instances: PublishedInstances | null; skipped: string | null }> {
  const { type } = discoverInstanceType(ctx.types?.() as never)
  if (!type) return { instances: null, skipped: null }
  if (!ctx.tangen) throw new Error('Publishing the shared instances needs the content client, which this runtime does not provide')
  let rows: Array<Record<string, unknown>>
  try {
    const res = await ctx.tangen.objects(type.type as never).status('published').limit(INSTANCE_PAGE_SIZE).get()
    rows = ((res as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>
  } catch (err) {
    if (!isTableMissing(err)) throw err
    // The type's problem, not the publish's: a page publish must not fail
    // because a type declared in code was never pushed to this environment.
    return { instances: null, skipped: `The "${type.label}" table is not generated in this environment yet - run tangen push.` }
  }
  const instances: PublishedInstances = {}
  for (const row of rows) {
    const id = String(row.id ?? '')
    if (id === '') continue
    const blocks = row[type.blocksField]
    instances[id] = Array.isArray(blocks) ? blocks as Array<Record<string, unknown>> : []
  }
  return { instances, skipped: null }
}

/**
 * Publishes everything a page SHARES with every other page, under
 * `/_surfaces`: the header and footer, the instances a page's references
 * name, and the stylesheet's base CSS beside them so a runtime can style a
 * shared tree whose classes were made after the page it sits on was
 * published.
 *
 * One artifact for both, deliberately (plan slice I3). A surface and an
 * instance are the same kind of thing under this model - I5 makes that
 * literal - so a second reserved route would exist only to be merged back a
 * slice later, and would cost a second pointer read on every request.
 *
 * Published with the STORED content, never with blocks from the browser -
 * the same trust rule the page publish keeps.
 */
async function publishSurfaces(ctx: ExtensionServerCtx) {
  const { surfaces } = await readSurfaces(ctx)
  const { instances, skipped } = await readPublishedInstances(ctx)
  const { css } = await renderFromStore(ctx)
  const interactions = interactionsFromClasses(await ctx.store.list(CLASS_PREFIX))
  const published = await publishArtifact(deliveryFor(ctx), {
    route: SURFACES_ROUTE, blocks: [], css, interactions,
    surfaces: surfaces.map(({ surface, blocks }) => ({ name: surface.global, position: surface.position, blocks })),
    // Absent, not empty, when there is no instance type here: the key is part
    // of the content address, so adding it would move the artifact id of
    // every environment that has never heard of instances.
    ...(instances ? { instances } : {}),
  })
  return {
    route: SURFACES_ROUTE,
    version: published.version,
    surfaces: surfaces.map((s) => s.surface.global),
    instances: Object.keys(instances ?? {}),
    skipped,
  }
}

type StoreCtx = { store: { list: (prefix?: string) => Promise<Array<{ key: string; data: Record<string, unknown> }>> } }

async function classByName(ctx: StoreCtx, name: string, exceptId?: string) {
  const rows = await ctx.store.list(CLASS_PREFIX)
  return rows.find(({ key, data }) => (data as { name?: string }).name === name
    && key.slice(CLASS_PREFIX.length) !== exceptId)
}

function readPresetBody(body: unknown): { name: string; block: Record<string, unknown> } {
  const b = (body ?? {}) as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) throw new Error('A preset name is required')
  if (name.length > 120) throw new Error('Preset name is too long (120 characters max)')
  const block = b.block as Record<string, unknown> | undefined
  if (!block || typeof block !== 'object' || Array.isArray(block) || typeof block._type !== 'string') {
    throw new Error('A preset needs a block with a _type')
  }
  return { name, block }
}

async function mustGet(ctx: ExtensionServerCtx, id: string): Promise<Record<string, unknown>> {
  const data = await ctx.store.get(`${PRESET_PREFIX}${id}`)
  if (!data) throw new Error('Preset not found')
  return data
}

/** One page as the housekeeping scan reads it. */
interface ScannedPage extends PageBlocks {
  type: string
  /** The component-field regions of the type, by name. */
  regionFields: string[]
  values: Record<string, unknown>
}

/** Rows per read while scanning - the scan is an explicit action, not a hot path. */
const SCAN_PAGE_SIZE = 200

/**
 * Instances read for the panel. One page, not a full scan: the panel is a
 * picker with a search box, and a workspace with more shared trees than this
 * has a naming problem the panel cannot fix.
 */
const INSTANCE_PAGE_SIZE = 200

/**
 * Every page of every Studio type in this environment, with its block
 * regions. Reads through the platform's own content client so the scan sees
 * exactly what the editor sees, and refuses without one rather than
 * reporting zero usage - zero is the one answer that leads to a delete.
 */
/** A type the scan could not read, and why - reported, never fatal. */
interface SkippedType { type: string; reason: string }

/**
 * Whether the content client refused a type because its table does not exist
 * yet. A type declared in code but not pushed to this environment answers
 * TYPE_NOT_FOUND ("not yet generated - run tangen push"); that is the type's
 * problem, not the housekeeping's, and must not blank the whole check.
 */
function isTableMissing(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null
  return e?.code === 'TYPE_NOT_FOUND' || /not yet generated/i.test(String(e?.message ?? ''))
}

async function scanPages(ctx: ExtensionServerCtx, skipped: SkippedType[] = []): Promise<ScannedPage[]> {
  if (!ctx.tangen) throw new Error('Class housekeeping needs the content client, which this runtime does not provide')
  const out: ScannedPage[] = []
  for (const typeDef of ctx.types?.() ?? []) {
    if (typeDef.disabled === true) continue
    const regionFields = pageRegions(typeDef.fields).map((r) => r.name)
    if (regionFields.length === 0) continue
    let offset = 0
    for (;;) {
      let res: { data?: unknown; meta?: { total?: unknown } }
      try {
        res = await ctx.tangen.objects(typeDef.name).limit(SCAN_PAGE_SIZE).offset(offset).get()
      } catch (err) {
        if (!isTableMissing(err)) throw err
        skipped.push({ type: typeDef.name, reason: 'table not generated - run tangen push' })
        break
      }
      const rows = (res.data ?? []) as Array<Record<string, unknown>>
      for (const row of rows) {
        out.push({
          id: String(row.id ?? ''), type: typeDef.name, regionFields, values: row,
          regions: regionFields.map((name) => row[name]),
        })
      }
      offset += rows.length
      const total = typeof res.meta?.total === 'number' ? res.meta.total : null
      if (rows.length === 0 || (total !== null && offset >= total)) break
    }
  }
  return out
}

/**
 * The scanned pages as the instance usage model reads them.
 *
 * An INSTANCE is scanned like a page, because an instance may hold a
 * reference to another one and that is a usage like any other - but it is
 * marked, so a refusal can say "the Newsletter CTA instance" rather than
 * calling it a page.
 */
function usageDocuments(pages: ScannedPage[], instanceType: string): UsageDocument[] {
  return pages.map((page) => ({
    id: page.id,
    type: page.type,
    title: instanceTitle({ title: typeof page.values.title === 'string' ? page.values.title : '' }),
    isInstance: page.type === instanceType,
    regions: page.regions,
  }))
}

/** Validate a merge body: one class to keep, at least one other to fold into it. */
function readMergeBody(body: unknown): { keep: string; remove: string[] } {
  const b = (body ?? {}) as Record<string, unknown>
  const keep = typeof b.keep === 'string' ? b.keep.trim() : ''
  if (!keep) throw new Error('Say which class to keep')
  const remove = Array.isArray(b.remove)
    ? [...new Set(b.remove.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))]
    : []
  if (remove.length === 0) throw new Error('Say which classes to merge into it')
  if (remove.includes(keep)) throw new Error('The class to keep cannot also be removed')
  return { keep, remove }
}

/** Requests per member per minute - generation is expensive and interactive. */
const GENERATE_RATE_MAX = 10
const GENERATE_RATE_WINDOW_SEC = 60
const MAX_BRIEF_CHARS = 4000

/** Validate + normalize an incoming generate body. Throws on junk. */
function readGenerateBody(body: unknown): { typeName: string; brief: string; single: boolean; field: string | null } {
  const b = (body ?? {}) as Record<string, unknown>
  const typeName = typeof b.typeName === 'string' ? b.typeName.trim() : ''
  // Which REGION to generate into. Absent means the first component field,
  // so an older client keeps working; naming it matters once a type has more
  // than one, or the AI is offered the wrong region's components.
  const field = typeof b.field === 'string' && b.field.trim() !== '' ? b.field.trim() : null
  const brief = typeof b.brief === 'string' ? b.brief.trim() : ''
  if (!typeName) throw new Error('typeName is required')
  if (!brief) throw new Error('A brief is required - describe the page you want')
  if (brief.length > MAX_BRIEF_CHARS) throw new Error(`The brief is too long (${MAX_BRIEF_CHARS} characters max)`)
  return { typeName, brief, single: b.single === true, field }
}

export default defineExtensionServer({
  adminRoutes: [
    {
      method: 'GET', path: 'tokens', capability: 'studio:edit',
      handler: async (_req, ctx) => {
        // The effective design tokens for this workspace: the contract
        // defaults extended by the config's `studio.tokens` seed, under the
        // theme stored here (T-T1). The style panel reads THIS - it never
        // hardcodes slot lists. `styleMode` rides along (one fetch, not
        // two) so the panel knows whether the Advanced tab may exist at all.
        const config = ctx.workspaceConfig?.()
        const theme = mergeTheme({ config, rows: await ctx.store.list(THEME_PREFIX) })
        return {
          data: {
            ...theme.tokens,
            // The VALUES, so the Variables panel can stop guessing.
            values: theme.values,
            fonts: theme.fonts,
            // Which entries the store holds, and their version tokens, so
            // the Theme panel can mark an override and guard its save.
            overridden: theme.overridden,
            revs: theme.revs,
            styleMode: resolveStyleMode(config),
          },
        }
      },
    },
    {
      // T-T1: one token value of the workspace theme. `value: null` resets
      // the token to its config (or runtime) value by removing the row -
      // the config stays the seed, the store holds only what a designer
      // changed. The stale-write guard is the class guard; rows are per
      // token, so two designers editing different tokens never collide.
      method: 'PATCH', path: 'theme/:name', capability: 'studio:design',
      handler: async (req, ctx) => {
        const name = req.params.name
        const b = (req.body ?? {}) as Record<string, unknown>
        const key = themeKey(name)
        const existing = await ctx.store.get(key)
        if (existing && staleWrite(existing as { rev?: unknown; updatedAt?: unknown }, expectedVersion(b))) {
          throw new Error(`Someone else changed the ${name} token - reload before saving again`)
        }
        if (b.value === null || b.value === undefined || (typeof b.value === 'string' && b.value.trim() === '')) {
          if (!themeValueError(name, '#0')) {
            if (existing) {
              await ctx.store.remove(key)
              announceThemeChange(ctx, req, { name, rev: undefined })
            }
            return { data: { name, value: null, rev: undefined } }
          }
        }
        const error = themeValueError(name, b.value)
        if (error) throw new Error(error)
        const value = (b.value as string).trim()
        const rev = newRev()
        await ctx.store.put(key, { value, updatedAt: new Date().toISOString(), updatedBy: req.memberId ?? null, rev })
        announceThemeChange(ctx, req, { name, rev })
        return { data: { name, value, rev } }
      },
    },
    {
      // T-T1: one font of the workspace theme, from exactly one of the three
      // sources the stylesheet loads (Google, uploaded files, system stack).
      // `font: null` resets it to the config font of that name, or removes
      // a font the theme added.
      method: 'PATCH', path: 'theme/fonts/:name', capability: 'studio:design',
      handler: async (req, ctx) => {
        const name = req.params.name
        const b = (req.body ?? {}) as Record<string, unknown>
        const key = themeFontKey(name)
        const existing = await ctx.store.get(key)
        if (existing && staleWrite(existing as { rev?: unknown; updatedAt?: unknown }, expectedVersion(b))) {
          throw new Error(`Someone else changed the ${name} font - reload before saving again`)
        }
        if (b.font === null || b.font === undefined) {
          if (existing) {
            await ctx.store.remove(key)
            announceThemeChange(ctx, req, { name: `font:${name}`, rev: undefined })
          }
          return { data: { name, font: null, rev: undefined } }
        }
        const font = readThemeFont(name, b.font)
        const rev = newRev()
        await ctx.store.put(key, { font, updatedAt: new Date().toISOString(), updatedBy: req.memberId ?? null, rev })
        announceThemeChange(ctx, req, { name: `font:${name}`, rev })
        return { data: { name, font, rev } }
      },
    },
    {
      // G-T5: Creative Mode is the one place Studio's token-only promise is
      // knowingly relaxed, so it must never happen silently. The admin calls
      // this when a block's freeform overrides change; the trail rides
      // ctx.emit (the designed extension seam - flows and webhooks can
      // subscribe), because there is no activity-write seam on the extension
      // ctx and coupling a browser-safe extension to @tangen/db to get one
      // would be the worse trade.
      method: 'POST', path: 'creative-audit', capability: 'studio:creative',
      handler: async (req, ctx) => {
        const b = (req.body ?? {}) as Record<string, unknown>
        const blockType = typeof b.blockType === 'string' ? b.blockType : ''
        const blockKey = typeof b.blockKey === 'string' ? b.blockKey : ''
        if (!blockType || !blockKey) throw new Error('blockType and blockKey are required')
        // Override NAMES only - never their values. The audit answers "who
        // stepped outside the tokens, on what", not what the CSS said.
        const overrides = (Array.isArray(b.overrides) ? b.overrides : [])
          .filter((o): o is string => typeof o === 'string' && CONTROL_NAMES.has(o))
        if (!ctx.emit) return { data: { recorded: false } }
        ctx.emit('creative-style-changed', {
          blockType,
          blockKey,
          objectType: typeof b.objectType === 'string' ? b.objectType : null,
          objectId: typeof b.objectId === 'string' ? b.objectId : null,
          overrides,
          memberId: req.memberId ?? null,
        })
        return { data: { recorded: true } }
      },
    },
    {
      method: 'POST', path: 'generate', capability: 'studio:edit',
      handler: async (req, ctx) => {
        const { typeName, brief, single, field } = readGenerateBody(req.body)
        if (!ctx.ai) throw new Error('AI generation is not available on this runtime - configure an AI provider in Settings > AI')

        if (ctx.tangen && req.memberId) {
          const rl = await ctx.tangen.rateLimit(`studio-generate:${req.memberId}`, GENERATE_RATE_MAX, GENERATE_RATE_WINDOW_SEC)
          if (!rl.allowed) throw new Error('Too many generation requests - wait a minute and try again')
        }

        const typeDef = (ctx.types?.() ?? []).find((t) => t.name === typeName && t.disabled !== true)
        if (!typeDef) throw new Error(`Type "${typeName}" was not found`)
        const blocksField = findBlocksField(typeDef.fields, field)
        if (!blocksField) {
          throw new Error(field
            ? `Type "${typeName}" has no component field called "${field}"`
            : `Type "${typeName}" has no blocks (component) field for Studio to fill`)
        }
        const defs = (((blocksField.config as Record<string, unknown> | undefined)?.components ?? []) as unknown[])
          .filter((c): c is GenComponentDef => !!c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string')
        if (defs.length === 0) throw new Error(`The blocks field on "${typeName}" allows no components - nothing to compose from`)

        const maxBlocks = single ? 1 : MAX_GENERATED_BLOCKS
        const jsonSchema = buildBlocksJsonSchema(defs, maxBlocks, ctx.ai)
        // Workspace facts season the copy where RAG is configured; retrieval
        // is best-effort by contract and never blocks the generation.
        const facts = await ctx.ai.retrieve(brief, { k: 6 }).catch(() => [])
        // Collections a generated kit.loop may query - only when the field
        // actually allows a loop, so the prompt never grows for pages that
        // cannot contain one.
        const collections = defs.some((d) => d.name === 'kit.loop')
          ? (ctx.types?.() ?? [])
              .filter((t) => t.disabled !== true)
              .map((t) => ({
                name: t.name,
                label: t.label,
                fields: (t.fields ?? [])
                  .filter((f) => !LOOP_UNBINDABLE_TYPES.has(f.fieldType))
                  .map((f) => f.name),
              }))
          : []
        const system = buildGenerateSystemPrompt({
          typeLabel: typeDef.label || typeDef.name, single, vocabulary: defs, collections,
        })
        const prompt = buildGenerateUserPrompt({ brief, facts })

        const res = await ctx.ai.generateJSON({ system, prompt, jsonSchema, maxTokens: 8000 })
        const blocks = sanitizeGeneratedBlocks(res.value, defs, { maxBlocks, mintKey: mintBlockKey }, ctx.ai)
        if (blocks.length === 0) throw new Error('The model returned no usable sections - try rephrasing the brief')
        return { data: { blocks, provider: res.provider, model: res.model, usage: res.usage } }
      },
    },
    {
      // The DRAFT stylesheet, for the canvas. Member-authenticated like every
      // other admin route; the canvas pushes it into the preview over
      // postMessage rather than the preview fetching it, so no token has to
      // ride on a <link>.
      method: 'GET', path: 'styles/draft', capability: 'studio:edit',
      handler: async (_req, ctx) => {
        const { css, refused } = await renderFromStore(ctx as ExtensionServerCtx)
        return {
          data: {
            css: composedStyles(css, interactionsFromClasses(await ctx.store.list(CLASS_PREFIX))),
            // What protection kept out of the canvas, so the editor can say so
            // rather than leaving a designer to wonder why nothing moved.
            refused,
          },
        }
      },
    },
    {
      // Publishing is a single write of the RENDERED css: the public route
      // then does no work beyond a read, and published styling is frozen
      // against later registry changes rather than silently shifting.
      method: 'POST', path: 'styles/publish', capability: 'studio:design',
      handler: async (req, ctx) => {
        const s = await publishStyles(ctx as ExtensionServerCtx, req.memberId)
        return {
          data: { hash: s.hash, bytes: s.css.length, publishedAt: s.publishedAt, artifact: s.artifact, refused: s.refused },
        }
      },
    },
    {
      // The PAGE artifact - blocks, stylesheet and runtime manifest under the
      // page's own delivery route. The editor calls this after the platform's
      // object publish has succeeded, because page publishing is platform-
      // owned: Studio authors, the platform publishes, and this is what
      // carries the result into the delivery layer.
      //
      // Without it a visitor could get published CSS from the platform route
      // but still had to ask the authoring API what was ON the page, which
      // leaves the authoring API in the visitor path - the dependency Phase 3
      // exists to remove.
      method: 'GET', path: 'surfaces', capability: 'studio:edit',
      handler: async (_req, ctx) => {
        // The header and footer every page shares, for the canvas. Under
        // studio:edit rather than the platform's globals:read because the
        // response is the surface FIELDS alone - a member who may design a
        // page may see the header it sits under, without the rest of the
        // global. Writes do not come through here: the editor saves through
        // PATCH /globals/:name, the platform's own gate.
        const { surfaces, skipped } = await readSurfaces(ctx as ExtensionServerCtx)
        // `LoadedSurface` as declared: `{ surface, blocks }`, the shape the
        // editor stores and reads `surface.position` from. Flattening it here
        // once cost the canvas a crash that neither side's tests could see,
        // so the wire body is the shared type itself, nothing adjacent.
        return { data: { surfaces, skipped } }
      },
    },
    {
      // Decision 1 (2026-08-25): saving the shared header or footer without
      // the platform's `globals` scope.
      //
      // The platform route (`PATCH /api/v1/globals/:name`) is arbitrary write
      // access to EVERY global of the workspace, which is why the built-in
      // editor role has no globals scope and why granting one to get a header
      // saved hands over the API ids and site settings beside it. This route
      // is the narrow door: `studio:globals`, and two bounds that make the
      // grant mean what its label says.
      //
      // 1. The global must be one `discoverGlobalSurfaces` classifies as a
      //    surface - "approved" means a developer declared it as a header or
      //    a footer IN CODE, not that an editor typed its name.
      // 2. The body may hold that surface's own field and nothing else.
      //
      // The platform route is untouched, so a member who really does hold
      // `globals:write` keeps saving exactly as before (the editor picks the
      // route from the member's own bundle - see `canEditSurfaces`).
      method: 'PATCH', path: 'surfaces/:global', capability: 'studio:globals',
      handler: async (req, ctx) => {
        const c = ctx as ExtensionServerCtx
        const wanted = req.params.global
        const { surfaces } = discoverGlobalSurfaces(declaredGlobals(c))
        const surface = approvedSurface(surfaces, wanted)
        if (!surface) {
          throw new Error(`"${wanted}" is not a Studio surface - only a global declared as a header or a footer can be saved here`)
        }
        // A shared surface has no locale of its own: it is base content, and
        // its translations live in the global's own locale map, which
        // Settings > Globals edits. A translate-only role is refused here
        // exactly as the platform's globals route refuses it.
        if (req.canWriteLocale && !req.canWriteLocale(null)) {
          throw new Error('Your role can only edit specific languages - a shared surface is base content')
        }
        const blocks = readSurfaceWrite(surface, req.body)
        if (!c.tangen) throw new Error('Saving a shared surface needs the content client, which this runtime does not provide')
        // PATCH, so every other field of the global survives; the accessor
        // folds expanded media back to asset ids like the platform route does.
        await c.tangen.globals(surface.global as never).patch(surfaceSaveBody(surface, blocks))
        return { data: { global: surface.global, field: surface.field.name, blocks } }
      },
    },
    {
      method: 'POST', path: 'surfaces/publish', capability: 'studio:edit',
      handler: async (_req, ctx) => {
        // The shared artifact under /_surfaces, from the STORED globals. The
        // editor calls this after its PATCH to a global has landed, so the
        // delivery layer says what the API says; a page publish writes the
        // same artifact, so the two never drift apart for long.
        return { data: await publishSurfaces(ctx as ExtensionServerCtx) }
      },
    },
    {
      method: 'POST', path: 'pages/publish', capability: 'studio:edit',
      handler: async (req, ctx) => {
        const { type, id, region } = readPagePublishBody(req.body)
        const c = ctx as ExtensionServerCtx

        // The lifecycle is announced on the platform bus, under the platform
        // type the realtime bridge fans to `object:<id>` and `studio:<id>`.
        // Started goes out BEFORE any artifact is written, so an editor open
        // on this object sees the publish begin; the outcome follows. A
        // failure carries a CODE and never the thrown message - the bridge
        // reaches every subscriber of the object, and the message can name
        // a slug, a type or a storage path. The log keeps the text.
        const actor = { actorId: req.memberId ?? null, actorType: req.memberId ? 'member' as const : null }
        c.emitPlatform?.('publish.started', { objectId: id, typeSlug: type }, actor)
        try {
          const { route, published, styles, surfaces, refused } = await publishPage(c, { type, id, region }, req.memberId)
          c.emitPlatform?.('publish.completed', { objectId: id, typeSlug: type, version: published.version, route }, actor)
          return {
            data: {
              route,
              version: published.version,
              dependencies: published.dependencies,
              runtime: published.runtime,
              styles: styles.artifact,
              // The shared surfaces artifact republished beside the page.
              surfaces: surfaces.version,
              // What Block protection kept out of the page's own raw CSS,
              // beside what it kept out of the stylesheet.
              refused: [...styles.refused, ...refused],
            },
          }
        } catch (err) {
          c.emitPlatform?.('publish.failed', { objectId: id, typeSlug: type, error: publishFailureCode(err) }, actor)
          throw err
        }
      },
    },
    {
      // KEY-authenticated twin of styles.css. The workspace and environment
      // come from the API KEY, so a site that already holds one configures
      // NOTHING extra - it is the same identity it uses for content.
      //
      // @deprecated COMPATIBILITY ONLY, sunset STYLES_ROUTE_SUNSET. Published
      // styling now comes from the platform delivery route as a versioned
      // immutable artifact:
      //   GET /api/v1/delivery/tangen/routes/_styles.json?workspace=
      //   GET /api/v1/delivery/tangen/builds/<version>/page.css?workspace=
      // This route is served by the EXTENSION, so it disappears the moment
      // Studio is disabled - which is exactly the failure the delivery route
      // exists to prevent, and the reason this one cannot be the recommended
      // path however convenient the key-based identification is.
      method: 'GET', path: 'styles', auth: 'key',
      handler: async (req, ctx) => {
        noticeSunsetCaller(req, ctx, 'styles')
        return deprecated(await serveStylesheet(req, ctx as never))
      },
    },
    {
      // PUBLIC: a browser <link> carries no key, no member and no custom
      // headers, so the workspace must be explicit in the query.
      //
      // @deprecated COMPATIBILITY ONLY - see the note on `styles` above. The
      // delivery route takes the same two query parameters and does not
      // vanish with the extension.
      method: 'GET', path: 'styles.css', auth: 'public',
      handler: async (req, ctx) => {
        noticeSunsetCaller(req, ctx, 'styles.css')
        return deprecated(await serveStylesheet(req, ctx as never))
      },
    },
    {
      // The page's own raw CSS (X-T2). Read by the editor on load; the canvas
      // compiles it client-side with the blocks in hand (lib/section-css.ts
      // `pageStyles`), publish compiles it from the store with the published
      // snapshot - one function, so the two cannot drift.
      method: 'GET', path: 'pages/:id/css', capability: 'studio:edit',
      handler: async (req, ctx) => {
        const row = await ctx.store.get(`${PAGE_CSS_PREFIX}${req.params.id}`) as { css?: unknown; rev?: unknown } | undefined
        return {
          data: {
            css: typeof row?.css === 'string' ? row.css : '',
            rev: typeof row?.rev === 'string' ? row.rev : undefined,
          },
        }
      },
    },
    {
      // Writes the page's raw CSS - `studio:design` since the split, because
      // a page's stylesheet is design and not content. The raw-CSS grant is
      // checked INSIDE on top of it, as it is for a class (`readCustom`):
      // raw CSS says strictly more than any control, so it keeps the
      // capability the class box has. The stale-write guard is the class
      // guard - two designers can hold the same page.
      method: 'PATCH', path: 'pages/:id/css', capability: 'studio:design',
      handler: async (req, ctx) => {
        const id = req.params.id
        if (!id) throw new Error('A page id is required')
        const key = `${PAGE_CSS_PREFIX}${id}`
        const existing = await ctx.store.get(key) as { css?: unknown; rev?: unknown; updatedAt?: unknown } | undefined
        if (existing && staleWrite(existing, expectedVersion(req.body))) {
          throw new Error('Someone else changed this page\'s custom CSS - reload before saving again')
        }
        const b = (req.body ?? {}) as Record<string, unknown>
        const stored = typeof existing?.css === 'string' && existing.css.trim() !== '' ? existing.css : undefined
        const asked = typeof b.css === 'string' && b.css.trim() !== '' ? b.css.trim() : undefined
        if (asked !== stored) {
          if (!req.can?.('studio:creative')) {
            throw new Error('Raw CSS needs the "Use Creative (freeform) styling" capability')
          }
        }
        const css = asked === stored ? stored : readCustomCss(b.css)
        if (!css) {
          if (existing) await ctx.store.remove(key)
          return { data: { css: '', rev: undefined } }
        }
        const rev = newRev()
        await ctx.store.put(key, { css, updatedAt: new Date().toISOString(), updatedBy: req.memberId ?? null, rev })
        return { data: { css, rev } }
      },
    },
    {
      method: 'GET', path: 'tags', capability: 'studio:edit',
      handler: async (_req, ctx) => {
        const rows = await ctx.store.list(TAG_PREFIX)
        const data = rows.flatMap(({ key, data: d }) => {
          const tag = tagByName(key.slice(TAG_PREFIX.length))
          const row = d as { props?: unknown; rev?: unknown }
          return tag ? [{ tag: tag.tag, props: row.props ?? {}, rev: typeof row.rev === 'string' ? row.rev : undefined }] : []
        })
        return { data }
      },
    },
    {
      method: 'PATCH', path: 'tags/:tag', capability: 'studio:design',
      handler: async (req, ctx) => {
        // The tag comes from the URL, so it is validated against the offered
        // list rather than trusted - it ends up inside a CSS selector.
        const tag = tagByName(req.params.tag)
        if (!tag) throw new Error(`Studio has no default for "${req.params.tag}"`)
        const existingTag = await ctx.store.get(`${TAG_PREFIX}${tag.tag}`)
        if (existingTag && staleWrite(existingTag as { updatedAt?: unknown }, expectedVersion(req.body))) {
          throw new Error(`Someone else changed the ${tag.tag} default - reload before saving again`)
        }
        const { props } = readClassBody({ name: tag.tag, ...(req.body ?? {}) as Record<string, unknown> })
        const rev = newRev()
        await ctx.store.put(`${TAG_PREFIX}${tag.tag}`, { props, updatedAt: new Date().toISOString(), rev })
        announceDesignChange(ctx as ExtensionServerCtx, 'studio.tag.changed', req, { name: tag.tag, rev })
        return { data: { tag: tag.tag, props, rev } }
      },
    },
    {
      method: 'GET', path: 'classes', capability: 'studio:edit',
      handler: async (_req, ctx) => {
        const rows = await ctx.store.list(CLASS_PREFIX)
        const data = rows
          .map(({ key, data: d }) => ({ id: key.slice(CLASS_PREFIX.length), ...d }))
          .sort((a, b) => String((a as { name?: string }).name ?? '').localeCompare(String((b as { name?: string }).name ?? '')))
        return { data }
      },
    },
    {
      method: 'POST', path: 'classes', capability: 'studio:design',
      handler: async (req, ctx) => {
        const { name, props } = readClassBody(req.body)
        const custom = await readCustomForCreate(req.body, req.can, ctx as ExtensionServerCtx)
        // A name is a SELECTOR: two classes sharing one would silently merge
        // in the stylesheet, so the collision is refused rather than resolved.
        if (await classByName(ctx as never, name)) {
          throw new Error(`A class called "${name}" already exists`)
        }
        const id = newId()
        const now = new Date().toISOString()
        const interaction = readInteraction(req.body, name)
        const target = readTarget(req.body)
        const row = {
          name, props, ...(custom ? { custom } : {}), ...(interaction ? { interaction } : {}),
          ...(target ? { target } : {}),
          createdBy: req.memberId, createdAt: now, updatedAt: now, rev: newRev(),
        }
        await ctx.store.put(`${CLASS_PREFIX}${id}`, row)
        announceDesignChange(ctx as ExtensionServerCtx, 'studio.class.changed', req, row)
        return { data: { id, ...row } }
      },
    },
    {
      method: 'PATCH', path: 'classes/:id', capability: 'studio:design',
      handler: async (req, ctx) => {
        const key = `${CLASS_PREFIX}${req.params.id}`
        const existing = await ctx.store.get(key)
        if (!existing) throw new Error('Class not found')
        // A class is shared, so two designers can hold the same row. The store
        // is an unconditional upsert, which would make that silent
        // last-write-wins - this turns it into something the second designer
        // is TOLD about instead of losing.
        if (staleWrite(existing as { updatedAt?: unknown }, expectedVersion(req.body))) {
          throw new Error('Someone else changed this class - reload before saving again')
        }
        const { name, props } = readClassBody({ ...existing, ...(req.body ?? {}) as Record<string, unknown> })
        const custom = readCustom(req.body, storedCustom(existing), req.can)
        if (await classByName(ctx as never, name, req.params.id)) {
          throw new Error(`A class called "${name}" already exists`)
        }
        const interaction = readInteraction(req.body, name)
        // The target is set once, at creation, and a PATCH may only repeat
        // it. A targeted class compiles under a scoped name keyed by its
        // target, so retargeting would move every wearing block's styling
        // from one element to another at a stroke - a new class is the
        // honest way to style a different part.
        const body = (req.body ?? {}) as Record<string, unknown>
        if ('target' in body) {
          const asked = readTarget(body)
          const stored = classTarget(existing as Record<string, unknown>)
          if (JSON.stringify(asked ?? null) !== JSON.stringify(stored ?? null)) {
            throw new Error('A class\'s target is set when it is created - make a new class to style a different part')
          }
        }
        const row = { ...existing, name, props, ...(custom ? { custom } : {}), updatedAt: new Date().toISOString(), rev: newRev() }
        // Absent keeps what is stored; null removes it; a value replaces it.
        if (interaction === null) delete (row as Record<string, unknown>).interaction
        else if (interaction) (row as Record<string, unknown>).interaction = interaction
        // A kept Tier 2 interaction follows a rename: the selector is the name.
        const kept = (row as { interaction?: Record<string, unknown> }).interaction
        if (kept && typeof kept.kind === 'string') kept.className = name
        if (!custom) delete (row as Record<string, unknown>).custom
        await ctx.store.put(key, row)
        announceDesignChange(ctx as ExtensionServerCtx, 'studio.class.changed', req, row)
        return { data: { id: req.params.id, ...row } }
      },
    },
    {
      // Deleting is studio:manage, like preset deletion: it is the one class
      // action that can unstyle pages the actor cannot see. Since the design
      // split it needs studio:design as well (see requireDesign).
      method: 'DELETE', path: 'classes/:id', capability: 'studio:manage',
      handler: async (req, ctx) => {
        requireDesign(req.can)
        const key = `${CLASS_PREFIX}${req.params.id}`
        const existing = await ctx.store.get(key) as { name?: unknown; rev?: unknown } | undefined
        await ctx.store.remove(key)
        // A row that was not there changed nothing, so nothing is announced.
        if (existing) {
          announceDesignChange(ctx as ExtensionServerCtx, 'studio.class.changed', req, { name: String(existing.name ?? ''), rev: existing.rev })
        }
        return { data: { ok: true } }
      },
    },
    {
      // Usage across EVERY page of the environment. The editor counts the
      // page it has open, which is the right blast radius for an edit and
      // the wrong one for a delete: a class worn by nothing here may style
      // forty elements on another page. Housekeeping reads this first.
      method: 'GET', path: 'classes/usage', capability: 'studio:edit',
      handler: async (_req, ctx) => {
        const skipped: SkippedType[] = []
        const pages = await scanPages(ctx as ExtensionServerCtx, skipped)
        return { data: { usage: usageAcrossPages(pages), pages: pages.length, skipped } }
      },
    },
    {
      // Merge duplicates: every reference to a removed class is rewritten to
      // the keeper on every page FIRST, and the rows go only once every
      // rewrite has landed. The other order would leave elements naming a
      // class the stylesheet no longer has. studio:manage, like delete.
      method: 'POST', path: 'classes/merge', capability: 'studio:manage',
      handler: async (req, ctx) => {
        requireDesign(req.can)
        const c = ctx as ExtensionServerCtx
        const { keep, remove } = readMergeBody(req.body)
        const keeperRow = await c.store.get(`${CLASS_PREFIX}${keep}`)
        if (!keeperRow) throw new Error('The class to keep was not found')
        const removedRows: Array<{ id: string; name: string; rev?: unknown }> = []
        for (const id of remove) {
          const row = await c.store.get(`${CLASS_PREFIX}${id}`)
          if (!row) throw new Error(`Class "${id}" was not found`)
          removedRows.push({ id, name: String((row as { name?: unknown }).name ?? ''), rev: (row as { rev?: unknown }).rev })
        }
        const keeperName = String((keeperRow as { name?: unknown }).name ?? '')
        const removedNames = removedRows.map((r) => r.name)

        let pagesUpdated = 0
        let elements = 0
        for (const page of await scanPages(c)) {
          const values: Record<string, unknown> = {}
          for (const region of page.regionFields) {
            const out = mergeReferences(page.values[region], removedNames, keeperName)
            if (!out.changed) continue
            values[region] = out.blocks
            elements += out.elements
          }
          if (Object.keys(values).length === 0) continue
          // A failed write throws out of the whole merge before any row is
          // deleted - see the ordering note above.
          await c.tangen!.objects(page.type).update(page.id, values)
          pagesUpdated += 1
        }
        for (const r of removedRows) await c.store.remove(`${CLASS_PREFIX}${r.id}`)
        // Announced once the rows are gone, one per removed class: an editor
        // wearing one of them reloads and finds the keeper's name in its place.
        for (const r of removedRows) announceDesignChange(c, 'studio.class.changed', req, { name: r.name, rev: r.rev })
        const removed = removedRows.map(({ id, name }) => ({ id, name }))
        return { data: { keeper: { id: keep, name: keeperName }, removed, pagesUpdated, elements } }
      },
    },
    {
      // The Data panel: every enabled collection with its LIVE published
      // count, through the content client the runtime already provides (one
      // status-filtered read per type, limit 1 - the total rides meta). A
      // type whose table is not pushed yet reports null and why, so the row
      // can say it; one such type must not blank the whole panel.
      method: 'GET', path: 'collections', capability: 'studio:edit',
      handler: async (_req, ctx) => {
        if (!ctx.tangen) throw new Error('The Data panel needs the content client, which this runtime does not provide')
        const rows: Array<{ type: string; label: string; published: number | null; note?: string }> = []
        for (const typeDef of ctx.types?.() ?? []) {
          if (typeDef.disabled === true) continue
          const label = typeDef.label || typeDef.name
          try {
            const res = await ctx.tangen.objects(typeDef.name).status('published').limit(1).get()
            const total = (res as { meta?: { total?: unknown } }).meta?.total
            rows.push({ type: typeDef.name, label, published: typeof total === 'number' ? total : null })
          } catch (err) {
            if (!isTableMissing(err)) throw err
            rows.push({ type: typeDef.name, label, published: null, note: 'table not generated - run tangen push' })
          }
        }
        rows.sort((a, b) => a.label.localeCompare(b.label))
        return { data: rows }
      },
    },
    {
      // The Instances panel: the shared trees this environment has, and an
      // honest reason when it has none to have.
      //
      // Read through the platform's own content client, so RBAC, drafts and
      // soft-disable behave exactly as they do everywhere else. A type
      // declared in code but not pushed to this environment answers
      // TYPE_NOT_FOUND, which is the type's problem and not the panel's: the
      // reason is reported and the panel says it, rather than showing an
      // empty list that reads as "you have no instances".
      method: 'GET', path: 'instances', capability: 'studio:edit',
      handler: async (_req, ctx) => {
        const c = ctx as ExtensionServerCtx
        const { type, reason } = discoverInstanceType(c.types?.() as never)
        if (!type) return { data: { type: null, reason, instances: [] } }
        if (!c.tangen) throw new Error('The Instances panel needs the content client, which this runtime does not provide')
        let rows: Array<Record<string, unknown>> = []
        try {
          const res = await c.tangen.objects(type.type as never).limit(INSTANCE_PAGE_SIZE).get()
          rows = ((res as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>
        } catch (err) {
          if (!isTableMissing(err)) throw err
          return {
            data: {
              type,
              reason: `The "${type.label}" table is not generated in this environment yet - run tangen push.`,
              instances: [],
            },
          }
        }
        const instances = rows.map((row) => {
          const description = type.descriptionField ? row[type.descriptionField] : undefined
          return {
            id: String(row.id ?? ''),
            title: typeof row.title === 'string' ? row.title : '',
            placement: readPlacement(type.placementField ? row[type.placementField] : undefined),
            description: typeof description === 'string' ? description : undefined,
            status: typeof row.status === 'string' ? row.status : undefined,
            // The instance -> instance edges, so the editor can refuse a
            // cycle BEFORE it writes one. Cheap: the blocks are already read.
            references: referencedInstanceIds(row[type.blocksField]),
          }
        }).filter((i) => i.id !== '')
        instances.sort((a, b) => instanceTitle(a).localeCompare(instanceTitle(b)))
        return { data: { type, reason: null, instances } }
      },
    },
    {
      // The published tree of every instance, for the CANVAS.
      //
      // The preview is laid out against what a visitor gets, so a reference
      // on a page is filled with the PUBLISHED instance and never with its
      // draft: the draft belongs to whoever is editing the instance, and a
      // canvas that quietly disagreed with the live site is the one failure
      // a visual editor cannot recover from. The instance being edited is
      // the exception, and the editor already holds that draft itself.
      //
      // The same map the delivery layer publishes, read the same way, so the
      // canvas and the site cannot drift apart.
      method: 'GET', path: 'instances/trees', capability: 'studio:edit',
      handler: async (_req, ctx) => {
        const { instances, skipped } = await readPublishedInstances(ctx as ExtensionServerCtx)
        return { data: { published: instances ?? {}, skipped } }
      },
    },
    {
      // Usage across EVERY page of the environment - the real count behind
      // "changes to X will update all N usages", and what a delete is judged
      // by. The editor knows the page it has open, which is the wrong blast
      // radius for a shared tree by definition.
      //
      // A scan, not an index, for the reason class usage is one: a stale
      // index answering zero is the single wrong answer that leads to a
      // delete. It also gets DETACH right for free, because a detached
      // placement holds ordinary blocks and no reference.
      method: 'GET', path: 'instances/usage', capability: 'studio:edit',
      handler: async (_req, ctx) => {
        const c = ctx as ExtensionServerCtx
        const { type, reason } = discoverInstanceType(c.types?.() as never)
        if (!type) return { data: { usage: {}, documents: 0, skipped: [], reason } }
        const skipped: SkippedType[] = []
        const pages = await scanPages(c, skipped)
        const usage = instanceUsageAcrossPages(usageDocuments(pages, type.type))
        return { data: { usage, documents: pages.length, skipped, reason: null } }
      },
    },
    {
      // Deleting a shared tree can empty a section on pages the actor is not
      // looking at, so it is studio:manage like a class delete - and it is
      // refused outright while anything still references it, with the list.
      //
      // The refusal is here rather than only in the panel because the panel
      // is not the only caller; and it is checked against a COMPLETE scan,
      // so a type that could not be read stops the delete instead of
      // silently lowering the count.
      method: 'DELETE', path: 'instances/:id', capability: 'studio:manage',
      handler: async (req, ctx) => {
        const c = ctx as ExtensionServerCtx
        const { type, reason } = discoverInstanceType(c.types?.() as never)
        if (!type) throw new Error(reason ?? 'This environment has no Instance type')
        if (!c.tangen) throw new Error('Deleting an instance needs the content client, which this runtime does not provide')
        const id = req.params.id
        const { data } = await c.tangen.objects(type.type as never).find(id) as { data?: Record<string, unknown> }
        const title = instanceTitle({ title: typeof data?.title === 'string' ? data.title : '' })
        const skipped: SkippedType[] = []
        const pages = await scanPages(c, skipped)
        if (skipped.length > 0) {
          // A count taken with a type missing is not a count.
          throw new Error(
            `Usage could not be checked completely: ${skipped.map((s) => `${s.type} (${s.reason})`).join(', ')}. `
            + `"${title}" was not deleted - run tangen push and try again.`,
          )
        }
        const usage = instanceUsageAcrossPages(usageDocuments(pages, type.type))[id]
        const refusal = instanceDeleteRefusal(title, usage)
        if (refusal) throw new Error(refusal)
        await c.tangen.objects(type.type as never).delete(id)
        return { data: { deleted: true, id } }
      },
    },
    {
      method: 'GET', path: 'presets', capability: 'studio:edit',
      handler: async (_req, ctx) => {
        await ensureTemplatesSeeded(ctx)
        const rows = await ctx.store.list(PRESET_PREFIX)
        const data = rows
          .map(({ key, data: d }) => ({ id: key.slice(PRESET_PREFIX.length), ...d }))
          .sort((a, b) => String((a as { name?: string }).name ?? '').localeCompare(String((b as { name?: string }).name ?? '')))
        return { data }
      },
    },
    {
      method: 'POST', path: 'presets', capability: 'studio:edit',
      handler: async (req, ctx) => {
        const { name, block } = readPresetBody(req.body)
        const id = newId()
        const now = new Date().toISOString()
        const preset = { name, block, createdBy: req.memberId, createdAt: now, updatedAt: now }
        await ctx.store.put(`${PRESET_PREFIX}${id}`, preset)
        return { data: { id, ...preset } }
      },
    },
    {
      method: 'PATCH', path: 'presets/:id', capability: 'studio:manage',
      handler: async (req, ctx) => {
        const existing = await mustGet(ctx, req.params.id)
        const b = (req.body ?? {}) as Record<string, unknown>
        const name = typeof b.name === 'string' ? b.name.trim() : ''
        if (!name) throw new Error('A preset name is required')
        if (name.length > 120) throw new Error('Preset name is too long (120 characters max)')
        const preset = { ...existing, name, updatedAt: new Date().toISOString() }
        await ctx.store.put(`${PRESET_PREFIX}${req.params.id}`, preset)
        return { data: { id: req.params.id, ...preset } }
      },
    },
    {
      method: 'DELETE', path: 'presets/:id', capability: 'studio:manage',
      handler: async (req, ctx) => {
        await ctx.store.remove(`${PRESET_PREFIX}${req.params.id}`)
        return { data: { deleted: true } }
      },
    },
  ],
})
