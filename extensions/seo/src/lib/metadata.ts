/**
 * File Name: metadata.ts
 * Purpose: The stored SEO payload and its precedence (closure plan Phase 9A,
 *          Units 2 and 11). Everything here is pure: no database, no ctx, no
 *          clock - so precedence can be argued about in a unit test rather
 *          than inferred from a running server.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `extension_data` has one row per object with no locale
 *          column and (finding 9A-3) no working published snapshot, so this
 *          module carries BOTH dimensions inside the extension's own payload
 *          and is explicit about doing so.
 */
import type { JsonLdNode, SeoLocalizedMetadata, SeoMetadata, SeoScoped, SeoStored, SeoRobots, SeoSocial } from '../contract'
import { SEO_SCHEMA_VERSION } from '../contract'

/** Locale codes we will store: BCP-47-ish, and nothing that could be a path. */
const LOCALE_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Trimmed text, or undefined - an empty override is an absence, not a value. */
function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}

function robots(v: unknown): SeoRobots | undefined {
  if (!isRecord(v)) return undefined
  if (typeof v.index !== 'boolean' || typeof v.follow !== 'boolean') return undefined
  return { index: v.index, follow: v.follow }
}

function social(v: unknown): SeoSocial | undefined {
  if (!isRecord(v)) return undefined
  const out: SeoSocial = {}
  const t = text(v.title); if (t) out.title = t
  const d = text(v.description); if (d) out.description = d
  const i = text(v.imageId); if (i) out.imageId = i
  const ty = text(v.type); if (ty) out.type = ty
  const alt = text(v.imageAlt); if (alt) out.imageAlt = alt
  return Object.keys(out).length ? out : undefined
}

function jsonLd(v: unknown): JsonLdNode[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((n): n is JsonLdNode => isRecord(n) && typeof n['@type'] === 'string' && n['@type'].trim() !== '')
  return out.length ? out : undefined
}

/** FAQ pairs: both sides required and trimmed, bounded, blanks dropped. */
const MAX_FAQS = 30
function faqs(v: unknown): { question: string; answer: string }[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: { question: string; answer: string }[] = []
  for (const item of v) {
    if (!isRecord(item)) continue
    const q = text(item.question)
    const a = text(item.answer)
    if (q && a) out.push({ question: q, answer: a })
    if (out.length >= MAX_FAQS) break
  }
  return out.length ? out : undefined
}

/** The localized half of a write, cleaned. */
function cleanLocalized(v: unknown): SeoLocalizedMetadata {
  if (!isRecord(v)) return {}
  const out: SeoLocalizedMetadata = {}
  const t = text(v.title); if (t) out.title = t
  const d = text(v.description); if (d) out.description = d
  const c = text(v.canonicalOverride); if (c) out.canonicalOverride = c
  const s = social(v.social); if (s) out.social = s
  return out
}

/** A full metadata write, cleaned: unknown keys are dropped, not stored. */
function cleanMetadata(v: unknown): SeoMetadata {
  if (!isRecord(v)) return {}
  const out: SeoMetadata = cleanLocalized(v)
  const r = robots(v.robots); if (r) out.robots = r
  if (v.sitemapExclude === true) out.sitemapExclude = true
  const sd = jsonLd(v.structuredData); if (sd) out.structuredData = sd
  const fk = text(v.focusKeyword); if (fk) out.focusKeyword = fk
  const fq = faqs(v.faqs); if (fq) out.faqs = fq
  const as = text(v.answerSummary); if (as) out.answerSummary = as
  return out
}

function cleanScoped(v: unknown): SeoScoped {
  const src = isRecord(v) ? v : {}
  const scoped: SeoScoped = { base: cleanMetadata(src.base) }
  if (isRecord(src.locales)) {
    const locales: Record<string, SeoLocalizedMetadata> = {}
    for (const [code, value] of Object.entries(src.locales)) {
      if (!LOCALE_PATTERN.test(code)) continue
      const cleaned = cleanLocalized(value)
      if (Object.keys(cleaned).length) locales[code] = cleaned
    }
    if (Object.keys(locales).length) scoped.locales = locales
  }
  return scoped
}

/**
 * Reads whatever is in `extension_data` into the current shape. A payload
 * from before this contract is a bare `SeoMetadata` and becomes the draft
 * base - no migration, and nothing an editor typed is lost.
 */
export function readStored(raw: unknown): SeoStored {
  if (!isRecord(raw)) return { schemaVersion: SEO_SCHEMA_VERSION, draft: { base: {} } }
  if (isRecord(raw.draft)) {
    // A row this module has written since v1. (When SEO_SCHEMA_VERSION next
    // moves, branch on raw.schemaVersion here to migrate older shapes.)
    const out: SeoStored = { schemaVersion: SEO_SCHEMA_VERSION, draft: cleanScoped(raw.draft) }
    if (isRecord(raw.published)) out.published = cleanScoped(raw.published)
    return out
  }
  // Legacy (pre-versioning): the whole payload WAS the metadata.
  // `seoTitle`/`metaDescription` were the old panel's own key names.
  const legacy = { ...raw } as Record<string, unknown>
  if (legacy.title === undefined && legacy.seoTitle !== undefined) legacy.title = legacy.seoTitle
  if (legacy.description === undefined && legacy.metaDescription !== undefined) legacy.description = legacy.metaDescription
  return { schemaVersion: SEO_SCHEMA_VERSION, draft: cleanScoped({ base: legacy }) }
}

/**
 * Applies an editor's write to the DRAFT only. A client that sends a
 * `published` key is ignored rather than trusted: publishing is a transition,
 * not something a form can assert.
 */
export function writeDraft(current: SeoStored, incoming: unknown): SeoStored {
  const out: SeoStored = { schemaVersion: SEO_SCHEMA_VERSION, draft: cleanScoped(incoming) }
  if (current.published) out.published = current.published
  return out
}

/** Publish: the draft becomes what the website sees, copied by value. */
export function promoteToPublished(current: SeoStored): SeoStored {
  return { schemaVersion: SEO_SCHEMA_VERSION, draft: current.draft, published: structuredClone(current.draft) }
}

/** Unpublish: the website sees nothing; the editor keeps their draft. */
export function clearPublished(current: SeoStored): SeoStored {
  return { schemaVersion: SEO_SCHEMA_VERSION, draft: current.draft }
}

/**
 * The sidebar panel's flat fields. It predates the scoped contract and speaks
 * `seoTitle`/`metaDescription`/`focusKeyword`; the store speaks
 * `{ base: { title, description, focusKeyword } }`. The two functions below are
 * the ONLY bridge, so nothing an editor types is dropped at the boundary.
 */
export interface SeoPanelFields {
  focusKeyword?: string
  seoTitle?: string
  metaDescription?: string
  /** FAQ pairs (base-only, shared across locales). */
  faqs?: { question: string; answer: string }[]
  /** The GEO answer summary (base-only). */
  answerSummary?: string
  /** The share image's alt text, og:image:alt (base-only; S3). */
  imageAlt?: string
}

/** The per-locale slice the panel edits: only the localized text fields. */
export interface SeoPanelLocaleFields {
  seoTitle?: string
  metaDescription?: string
}

/** The draft scoped shape from any payload the panel may be handed. */
function draftScopedOf(raw: unknown): SeoScoped {
  // The panel's own bare `{ base, locales }` emit vs the stored `{ draft, ... }`.
  if (isRecord(raw) && isRecord(raw.base) && !isRecord(raw.draft)) return cleanScoped(raw)
  return readStored(raw).draft
}

/** Flat panel fields -> the scoped write shape `writeDraft`/`cleanScoped` expect. */
export function panelToScoped(fields: SeoPanelFields): SeoScoped {
  const base: Record<string, unknown> = {}
  const t = text(fields.seoTitle); if (t) base.title = t
  const d = text(fields.metaDescription); if (d) base.description = d
  const fk = text(fields.focusKeyword); if (fk) base.focusKeyword = fk
  if (fields.faqs?.length) base.faqs = fields.faqs
  const asum = text(fields.answerSummary); if (asum) base.answerSummary = asum
  const alt = text(fields.imageAlt); if (alt) base.social = { imageAlt: alt }
  return { base: cleanMetadata(base) }
}

/**
 * A stored payload -> the panel's flat fields for (re)hydration. Tolerant of
 * every shape the panel might be handed: the stored `{ draft: { base } }`, a
 * legacy flat row, and the panel's own bare `{ base }` emit (a remount before
 * the next save).
 */
export function scopedToPanel(raw: unknown): SeoPanelFields {
  const base = draftScopedOf(raw).base
  return { seoTitle: base.title ?? undefined, metaDescription: base.description ?? undefined, focusKeyword: base.focusKeyword ?? undefined, faqs: base.faqs ?? undefined, answerSummary: base.answerSummary ?? undefined, imageAlt: base.social?.imageAlt ?? undefined }
}

/**
 * The locale-aware write: base fields plus a per-locale slice (title/description
 * only). Because `writeDraft` REPLACES the whole draft, the panel must emit
 * EVERY locale it holds - this assembles the complete `{ base, locales }` so no
 * locale is silently wiped. An empty locale slice is dropped, not stored.
 */
export function panelToScopedFull(base: SeoPanelFields, locales: Record<string, SeoPanelLocaleFields>): SeoScoped {
  const baseScoped = panelToScoped(base)
  const outLocales: Record<string, unknown> = {}
  for (const [code, fields] of Object.entries(locales)) {
    const loc: Record<string, unknown> = {}
    const t = text(fields.seoTitle); if (t) loc.title = t
    const d = text(fields.metaDescription); if (d) loc.description = d
    if (Object.keys(loc).length) outLocales[code] = loc
  }
  return Object.keys(outLocales).length ? { base: baseScoped.base, locales: outLocales as never } : baseScoped
}

/** A stored payload -> the panel's base fields AND every locale slice. */
export function scopedToPanelFull(raw: unknown): { base: SeoPanelFields; locales: Record<string, SeoPanelLocaleFields> } {
  const scoped = draftScopedOf(raw)
  const base: SeoPanelFields = {
    seoTitle: scoped.base.title ?? undefined,
    metaDescription: scoped.base.description ?? undefined,
    focusKeyword: scoped.base.focusKeyword ?? undefined,
    faqs: scoped.base.faqs ?? undefined,
    answerSummary: scoped.base.answerSummary ?? undefined,
    imageAlt: scoped.base.social?.imageAlt ?? undefined,
  }
  const locales: Record<string, SeoPanelLocaleFields> = {}
  for (const [code, loc] of Object.entries(scoped.locales ?? {})) {
    locales[code] = { seoTitle: loc.title ?? undefined, metaDescription: loc.description ?? undefined }
  }
  return { base, locales }
}

/**
 * One locale's metadata. Localized fields fall back to the base; SHARED
 * fields (robots, sitemap exclusion, structured data) come from the base and
 * only the base, whatever a locale payload claims.
 */
export function pickMetadata(scoped: SeoScoped, locale?: string | null): SeoMetadata {
  const override = locale ? scoped.locales?.[locale] : undefined
  const localized = override ? cleanLocalized(override) : {}
  return {
    ...scoped.base,
    ...localized,
    robots: scoped.base.robots,
    sitemapExclude: scoped.base.sitemapExclude,
    structuredData: scoped.base.structuredData,
    focusKeyword: scoped.base.focusKeyword,
    faqs: scoped.base.faqs,
    answerSummary: scoped.base.answerSummary,
  }
}

/**
 * The precedence, in one place: an editor's override, then the content's own
 * field, then whatever the site offered, then nothing. "Nothing" is an
 * omission - never an empty string, which would render as a blank tag.
 */
export function resolveText(input: { override?: string | null; content?: string | null; fallback?: string | null }): string | undefined {
  return text(input.override) ?? text(input.content) ?? text(input.fallback)
}
