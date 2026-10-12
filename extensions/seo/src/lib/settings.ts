/**
 * File Name: settings.ts
 * Purpose: The DB-backed, workspace-level SEO settings (plan-seo-next Phase 1,
 *          the hybrid-config half). Functions and site routing stay in code
 *          (`SeoHelpers`); everything an editor can change - title template,
 *          social/organization defaults, verification, robots defaults, GEO
 *          toggles - lives here, stored under one `ctx.store` key. This module
 *          is the ONE validated read/write path, pure and React/server-free, so
 *          the Settings page, the routes, and the resolve layer all agree on a
 *          single trusted shape (the same discipline as `metadata.ts`).
 *
 * Author: Raghunath J
 * License: MIT
 */

/** The `ctx.store` key the settings row occupies (per workspace x env). */
export const SEO_SETTINGS_KEY = 'settings'

/** Bump ONLY alongside a migration branch in `normalizeSettings`. */
export const SEO_SETTINGS_SCHEMA_VERSION = 1

export type TwitterCard = 'summary' | 'summary_large_image'

/** What the Settings page edits. Absent optional fields mean "fall back". */
export interface SeoSettings {
  schemaVersion: number
  general: {
    siteName?: string
    /** e.g. "%title% | %site%" - applied when an object has no title override. */
    titleTemplate?: string
    /** The separator used by title templates; defaults applied by the UI. */
    titleSeparator?: string
  }
  social: {
    /** Media IDENTITY for a default OG image (resolved to a URL at read time). */
    defaultImageId?: string
    twitterCard?: TwitterCard
    twitterHandle?: string
  }
  organization: {
    name?: string
    logoId?: string
    /** Canonical profile URLs for the entity graph (Organization.sameAs). */
    sameAs: string[]
  }
  verification: {
    google?: string
    bing?: string
  }
  robots: {
    defaultIndex: boolean
    defaultFollow: boolean
  }
  geo: {
    /** Publish llms.txt / llms-full.txt for AI crawlers (Phase 4). */
    llmsTxtEnabled: boolean
  }
}

export const DEFAULT_SEO_SETTINGS: SeoSettings = {
  schemaVersion: SEO_SETTINGS_SCHEMA_VERSION,
  general: {},
  social: {},
  organization: { sameAs: [] },
  verification: {},
  robots: { defaultIndex: true, defaultFollow: true },
  geo: { llmsTxtEnabled: false },
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Trimmed text, or undefined - an empty setting is an absence, not a value. */
function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) { const t = text(item); if (t) out.push(t) }
  return out
}

/**
 * Split a free-text field (the Settings form's sameAs textarea) into a clean
 * list of URLs. Newlines or commas separate; blanks are dropped. Pure, so the
 * form and the codec agree on how a pasted list becomes an array.
 */
export function parseSameAs(textarea: string): string[] {
  return stringList(String(textarea ?? '').split(/[\n,]/))
}

/**
 * The one validated read path: whatever is in the store becomes a fully
 * defaulted, junk-free `SeoSettings`. Unknown keys are dropped, not stored;
 * empty strings collapse to absence; the enum is clamped. (When
 * SEO_SETTINGS_SCHEMA_VERSION next moves, branch on `raw.schemaVersion` here.)
 */
export function normalizeSettings(raw: unknown): SeoSettings {
  const src = isRecord(raw) ? raw : {}
  const general = isRecord(src.general) ? src.general : {}
  const social = isRecord(src.social) ? src.social : {}
  const organization = isRecord(src.organization) ? src.organization : {}
  const verification = isRecord(src.verification) ? src.verification : {}
  const robots = isRecord(src.robots) ? src.robots : {}
  const geo = isRecord(src.geo) ? src.geo : {}

  const twitterCard = social.twitterCard === 'summary' || social.twitterCard === 'summary_large_image'
    ? social.twitterCard
    : undefined

  const out: SeoSettings = {
    schemaVersion: SEO_SETTINGS_SCHEMA_VERSION,
    general: {},
    social: {},
    organization: { sameAs: stringList(organization.sameAs) },
    verification: {},
    robots: { defaultIndex: bool(robots.defaultIndex, true), defaultFollow: bool(robots.defaultFollow, true) },
    geo: { llmsTxtEnabled: bool(geo.llmsTxtEnabled, false) },
  }

  const siteName = text(general.siteName); if (siteName) out.general.siteName = siteName
  const titleTemplate = text(general.titleTemplate); if (titleTemplate) out.general.titleTemplate = titleTemplate
  const titleSeparator = text(general.titleSeparator); if (titleSeparator) out.general.titleSeparator = titleSeparator

  const defaultImageId = text(social.defaultImageId); if (defaultImageId) out.social.defaultImageId = defaultImageId
  if (twitterCard) out.social.twitterCard = twitterCard
  const twitterHandle = text(social.twitterHandle); if (twitterHandle) out.social.twitterHandle = twitterHandle

  const orgName = text(organization.name); if (orgName) out.organization.name = orgName
  const logoId = text(organization.logoId); if (logoId) out.organization.logoId = logoId

  const google = text(verification.google); if (google) out.verification.google = google
  const bing = text(verification.bing); if (bing) out.verification.bing = bing

  return out
}

/** The groups a settings save may name. One save, one group. */
export const SEO_SETTINGS_GROUPS = ['general', 'social', 'organization', 'verification', 'robots', 'geo'] as const
export type SeoSettingsGroup = (typeof SEO_SETTINGS_GROUPS)[number]

/**
 * A PARTIAL save merged over what is stored: the Settings tab saves the group
 * it edited rather than posting the whole page back (the user, 2026-09-20).
 *
 * The rule that makes it safe: only a group the patch actually NAMES is
 * touched, and a named group is replaced whole - so clearing a field inside a
 * group works (an absent key is an absent value), while a group nobody
 * mentioned keeps every value it had. Anything that is not one of the known
 * groups is ignored, exactly as the codec ignores it.
 */
export function mergeSettingsGroups(stored: SeoSettings, patch: unknown): Record<string, unknown> {
  const src = isRecord(patch) ? patch : {}
  const out: Record<string, unknown> = { ...(stored as unknown as Record<string, unknown>) }
  for (const group of SEO_SETTINGS_GROUPS) {
    if (!(group in src)) continue
    out[group] = isRecord(src[group]) ? src[group] : {}
  }
  return out
}
