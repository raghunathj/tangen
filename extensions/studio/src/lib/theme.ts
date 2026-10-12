/**
 * File Name: theme.ts
 * Purpose: The workspace theme in Studio's own store (T-T1) - token VALUES
 *          and fonts per workspace under the `theme:` key family,
 *          merged over the config seed so a stored override wins and
 *          "Reset to config" is one row removed.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: DECIDED (user, 2026-08-19): theming belongs to Studio,
 *          not to Tangen. It is a Studio surface a designer edits, stored in
 *          Studio's storage - the same extension store `class:` and `tag:`
 *          live in, so a theme travels between deployments and ports like
 *          them. The config's `studio.tokens` key is demoted to a SEED: read
 *          if a site declares it, never required, and not where the product
 *          points anyone.
 *
 *          One row per token value (`theme:bg-brand`) and per font
 *          (`theme:font:Display`) rather than one row for the theme, so two
 *          designers editing different tokens never trip the stale-write
 *          guard on each other, and a reset is a remove rather than a
 *          rewrite of everything else.
 *
 *          Values are keyed the way the RUNTIME reads them - `bg-brand`,
 *          `fg-brand`, `space-lg`, `text-xl`, `radius-md`, `width-wide` -
 *          which is also the shape GET tokens already served and the
 *          stylesheet already emits as `--tg-<name>` on `:root`. Nothing
 *          downstream learns a new shape; a stored value just wins the merge.
 *
 *          A stored value for a slot nobody listed ADDS the slot. That is
 *          the T-T1 promise: adding a palette slot is a Studio action, and
 *          it renders with zero stylesheet edits because widgets reference
 *          slots as `var(--tg-*)` and `:root` now defines the variable.
 *
 *          Every value is validated at the door with the emitter's own
 *          rules: `:root` is the one rule every page reads, and a value that
 *          closed it would restyle a whole site.
 *
 *          Pure module, browser-safe: the server routes and the Theme panel
 *          both read it.
 */
import {
  THEME_PREFIX, THEME_FONT_PREFIX, themeKey, themeFontKey,
  parseVarName, themeValueError, readThemeFont,
} from '@tangen/studio-schema'
import {
  mergeTokens, tokenValues, fontTokens, TOKEN_FAMILIES,
  type StudioTokens, type FontToken, type StudioTokensConfigLike,
} from '../tokens'

// The key family and its validators live in @tangen/studio-schema since
// WF-S10: Porter validates the same rows on the platform side, and the
// platform may not import extension code. Re-exported here so every existing
// `from './lib/theme'` import - the server routes, the Theme panel - is
// unchanged, and there is exactly ONE set of rules.
export {
  THEME_PREFIX, THEME_FONT_PREFIX, themeKey, themeFontKey,
  parseVarName, themeValueError, readThemeFont,
}
export type { ParsedVarName } from '@tangen/studio-schema'

/** One row of the family, as the store hands it back. */
export interface ThemeRow {
  key: string
  data: Record<string, unknown>
}

export interface ThemeRows {
  /** Stored token values, keyed as the runtime reads them. */
  values: Record<string, string>
  fonts: FontToken[]
  /** Version tokens per stored entry: `bg-brand`, `font:Display`. */
  revs: Record<string, string>
}

/** Reads the family out of a store listing, ignoring anything malformed. */
export function readThemeRows(rows: ReadonlyArray<ThemeRow>): ThemeRows {
  const values: Record<string, string> = {}
  const fonts: FontToken[] = []
  const revs: Record<string, string> = {}
  for (const { key, data } of rows ?? []) {
    if (!key.startsWith(THEME_PREFIX)) continue
    const rev = typeof data?.rev === 'string' ? data.rev : undefined
    if (key.startsWith(THEME_FONT_PREFIX)) {
      const name = key.slice(THEME_FONT_PREFIX.length)
      try {
        fonts.push(readThemeFont(name, data?.font))
      } catch {
        continue
      }
      if (rev) revs[`font:${name}`] = rev
      continue
    }
    const varName = key.slice(THEME_PREFIX.length)
    if (themeValueError(varName, data?.value) !== null) continue
    values[varName] = (data.value as string).trim()
    if (rev) revs[varName] = rev
  }
  return { values, fonts, revs }
}

export interface MergedTheme {
  /** Effective slot lists: defaults, config extras, stored extras. */
  tokens: StudioTokens
  /** Effective values: config seed under stored overrides. */
  values: Record<string, string>
  /** Effective fonts: config seed, stored overrides by name, stored additions after. */
  fonts: FontToken[]
  /** What the store holds: var names and `font:<name>` entries, sorted. */
  overridden: string[]
  revs: Record<string, string>
}

/**
 * The workspace theme as the stylesheet, the canvas and the panel read it.
 * The config seeds; a stored override wins; a stored slot nobody listed is
 * added to its family.
 */
export function mergeTheme(input: {
  config: StudioTokensConfigLike | Record<string, unknown> | null | undefined
  rows: ReadonlyArray<ThemeRow>
}): MergedTheme {
  const stored = readThemeRows(input.rows)
  const tokens = mergeTokens(input.config)
  for (const varName of Object.keys(stored.values)) {
    const parsed = parseVarName(varName)
    if (parsed && !tokens[parsed.family].includes(parsed.slot)) tokens[parsed.family].push(parsed.slot)
  }
  for (const family of TOKEN_FAMILIES) tokens[family] = [...tokens[family]]

  const values = { ...tokenValues(input.config), ...stored.values }

  const seed = fontTokens(input.config)
  const byName = new Map(stored.fonts.map((f) => [f.name, f]))
  const fonts: FontToken[] = seed.map((f) => byName.get(f.name) ?? f)
  const seeded = new Set(seed.map((f) => f.name))
  for (const f of stored.fonts) if (!seeded.has(f.name)) fonts.push(f)

  // Sorted, because a store's listing order is its own business and the
  // panel should not reorder between two loads.
  const overridden = [...Object.keys(stored.values), ...stored.fonts.map((f) => `font:${f.name}`)].sort()
  return { tokens, values, fonts, overridden, revs: stored.revs }
}
