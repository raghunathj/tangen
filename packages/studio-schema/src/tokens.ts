/**
 * File Name: tokens.ts
 * Purpose: The Studio design-token contract - named slots over CSS custom
 *          properties. DEFAULT_TOKENS carries the contract's default slot
 *          list for every family (palette/space/type/radius/width); the
 *          runtime stylesheet defines a --tg-* variable for each default
 *          slot. mergeTokens EXTENDS those lists from the workspace
 *          config's `studio.tokens` key - sites may add slots (their
 *          stylesheet must define the extra vars), never replace the
 *          mechanism or shrink the defaults.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure module - no platform imports, safe in config,
 *          server, and admin bundles alike. The style panel never hardcodes
 *          these lists: it reads GET /admin/ext/studio/tokens, which is
 *          mergeTokens over the loaded workspace config.
 *
 *          Lives in the CONTRACT package rather than in the Studio extension
 *          because two sides need it and neither may depend on the other: the
 *          extension reads it to serve the panel, and the platform's Porter
 *          provider reads it to validate a `theme:` row before copying it
 *          between environments. `extensions/studio/src/tokens.ts` re-exports
 *          this file, so every existing import keeps working.
 */

/** The token families the contract fixes - families are closed, lists extend. */
export const TOKEN_FAMILIES = ['palette', 'space', 'type', 'radius', 'width'] as const

export type TokenFamily = (typeof TOKEN_FAMILIES)[number]

/** Effective slot lists, one per family. */
export type StudioTokens = Record<TokenFamily, string[]>

/**
 * The contract's default slot lists, verbatim. Slots resolve to CSS custom
 * properties the rendering runtime references and ships defaults for:
 * palette -> --tg-bg-<slot> / --tg-fg-<slot>, space -> --tg-space-<slot>,
 * type -> --tg-text-<slot>, radius -> --tg-radius-<slot>,
 * width -> --tg-width-<slot>.
 */
export const DEFAULT_TOKENS: Readonly<StudioTokens> = Object.freeze({
  palette: Object.freeze(['default', 'muted', 'brand', 'accent', 'inverse']),
  space: Object.freeze(['none', 'xs', 'sm', 'md', 'lg', 'xl']),
  type: Object.freeze(['sm', 'base', 'lg', 'xl', '2xl', '3xl']),
  radius: Object.freeze(['none', 'sm', 'md', 'full']),
  width: Object.freeze(['narrow', 'normal', 'wide', 'full']),
}) as Readonly<StudioTokens>

/** The `studio.tokens` slice of a workspace config - all lists are EXTRAS. */
export interface StudioTokensConfigLike {
  studio?: { tokens?: Partial<Record<TokenFamily, string[]>> | null } | null
}

/**
 * The effective slot lists for a workspace: the defaults EXTENDED by the
 * config's `studio.tokens` extras, per family. Extension semantics are the
 * contract's held line - defaults always lead (the runtime defines their
 * vars), extras append in declared order, duplicates and junk entries are
 * dropped. Junk-tolerant: any malformed config shape degrades to the
 * defaults rather than throwing mid-request. Always returns fresh arrays.
 */
export function mergeTokens(config?: StudioTokensConfigLike | Record<string, unknown> | null): StudioTokens {
  const tokens = ((config as StudioTokensConfigLike | undefined)?.studio?.tokens ?? {}) as Record<string, unknown>
  const out = {} as StudioTokens
  for (const family of TOKEN_FAMILIES) {
    const slots = [...DEFAULT_TOKENS[family]]
    const extras = tokens && typeof tokens === 'object' ? tokens[family] : undefined
    if (Array.isArray(extras)) {
      for (const raw of extras) {
        // Two accepted shapes: a bare NAME (the site's CSS supplies the
        // value, as it always has) or an object carrying the value too. Both
        // list the same way here - only tokenValues cares about the
        // difference.
        const slot = typeof raw === 'string'
          ? raw.trim()
          : slotName(raw)
        if (slot && !slots.includes(slot)) slots.push(slot)
      }
    }
    out[family] = slots
  }
  return out
}

/** The name of a slot entry in either accepted shape. */
function slotName(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  if (!raw || typeof raw !== 'object') return ''
  const name = (raw as { name?: unknown }).name
  return typeof name === 'string' ? name.trim() : ''
}

/** The CSS custom-property prefix each family is read under by the runtime. */
const VAR_PREFIX: Record<TokenFamily, string> = {
  palette: 'bg',
  space: 'space',
  type: 'text',
  radius: 'radius',
  width: 'width',
}

/**
 * Slots that declared a VALUE, as custom-property names the runtime already
 * reads. Slots without one are absent rather than blank: the site's own CSS
 * is still their source, which is how every token worked before.
 *
 * This is what lets the Variables panel show the real value instead of the
 * hardcoded preview it guessed with.
 */
export function tokenValues(
  config?: StudioTokensConfigLike | Record<string, unknown> | null,
): Record<string, string> {
  const tokens = ((config as StudioTokensConfigLike | undefined)?.studio?.tokens ?? {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const family of TOKEN_FAMILIES) {
    const extras = tokens?.[family]
    if (!Array.isArray(extras)) continue
    for (const raw of extras) {
      const name = slotName(raw)
      if (!name || typeof raw !== 'object' || raw === null) continue
      const value = (raw as { value?: unknown }).value
      if (typeof value !== 'string' || value.trim() === '') continue
      out[`${VAR_PREFIX[family]}-${name}`] = value.trim()
    }
  }
  return out
}

/** One weight of a self-hosted family. */
export interface FontFile {
  url: string
  weight?: number
  style?: string
}

/** A named font, from exactly one of three sources. */
export interface FontToken {
  name: string
  /** A family from the curated Google list. */
  google?: string
  /** Self-hosted files - the answer for a licensed brand font, and for GDPR. */
  files?: FontFile[]
  /** A system stack; loads nothing at all. */
  stack?: string
}

/**
 * The `font` family. Unlike the other families a font is not a slot on a
 * ladder - it names something that must be LOADED, so each entry carries its
 * source. An entry naming no source is dropped: it could never render, and a
 * variable pointing at nothing is worse than an absent one.
 */
export function fontTokens(
  config?: StudioTokensConfigLike | Record<string, unknown> | null,
): FontToken[] {
  const tokens = ((config as StudioTokensConfigLike | undefined)?.studio?.tokens ?? {}) as Record<string, unknown>
  const list = tokens?.font
  if (!Array.isArray(list)) return []

  const out: FontToken[] = []
  for (const raw of list) {
    const name = slotName(raw)
    if (!name || !raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>

    const google = typeof entry.google === 'string' && entry.google.trim() !== ''
      ? entry.google.trim() : undefined
    const stack = typeof entry.stack === 'string' && entry.stack.trim() !== ''
      ? entry.stack.trim() : undefined
    const files = Array.isArray(entry.files)
      ? entry.files.flatMap((f) => {
          if (!f || typeof f !== 'object') return []
          const url = (f as { url?: unknown }).url
          if (typeof url !== 'string' || url.trim() === '') return []
          const weight = (f as { weight?: unknown }).weight
          const style = (f as { style?: unknown }).style
          return [{
            url: url.trim(),
            ...(typeof weight === 'number' ? { weight } : {}),
            ...(typeof style === 'string' ? { style } : {}),
          }]
        })
      : undefined

    if (!google && !stack && !(files && files.length > 0)) continue
    out.push({
      name,
      ...(google ? { google } : {}),
      ...(files && files.length > 0 ? { files } : {}),
      ...(stack ? { stack } : {}),
    })
  }
  return out
}
