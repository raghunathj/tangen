/**
 * File Name: theme-value.ts
 * Purpose: The workspace theme's key family and its validators - what a
 *          `theme:<var>` row may hold, and what a `theme:font:<name>` row may
 *          hold.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Lives in the CONTRACT package for the same reason
 *          `delivery-kv.ts` lives in the compiler: TWO sides need it and
 *          neither may depend on the other. The Studio extension validates a
 *          designer's write with it, and the platform's Porter provider
 *          validates the same row again before copying it into another
 *          environment. A restated copy in Porter would be a second set of
 *          rules that drifts, and the row it lets through lands on `:root` -
 *          the one rule every published page reads.
 *
 *          `extensions/studio/src/lib/theme.ts` re-exports these names, so
 *          the extension's own imports are unchanged; the merge itself
 *          (`readThemeRows` / `mergeTheme`) stays there, because merging is
 *          a Studio behaviour rather than a contract.
 */
import { isGoogleFont } from './google-fonts'
import { fontTokens, type FontToken, type TokenFamily } from './tokens'

/** The key family. `theme:<var>` holds a value; `theme:font:<name>` a font. */
export const THEME_PREFIX = 'theme:'
export const THEME_FONT_PREFIX = 'theme:font:'

export const themeKey = (varName: string): string => `${THEME_PREFIX}${varName}`
export const themeFontKey = (name: string): string => `${THEME_FONT_PREFIX}${name}`

/** The custom-property prefix each family is read under by the runtime. */
const FAMILY_BY_PREFIX: Record<string, TokenFamily> = {
  bg: 'palette', fg: 'palette', space: 'space', text: 'type', radius: 'radius', width: 'width',
}

/** A slot or font name that can sit inside a custom-property name. */
const SAFE_SLOT = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/
/** The stylesheet's own rule for a font name (SAFE_NAME in stylesheet.ts). */
const SAFE_FONT_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/

export interface ParsedVarName {
  family: TokenFamily
  /** The palette half, or null for the other families. */
  half: 'bg' | 'fg' | null
  slot: string
}

/** `bg-brand` -> palette / bg / brand. Null for a name the runtime never reads. */
export function parseVarName(varName: string): ParsedVarName | null {
  if (typeof varName !== 'string') return null
  const at = varName.indexOf('-')
  if (at <= 0) return null
  const prefix = varName.slice(0, at)
  const slot = varName.slice(at + 1)
  const family = FAMILY_BY_PREFIX[prefix]
  if (!family || !SAFE_SLOT.test(slot) || slot.length > 64) return null
  return { family, half: family === 'palette' ? (prefix as 'bg' | 'fg') : null, slot }
}

/** A declaration value that cannot terminate its own rule - the emitter's `safeValue`. */
const UNSAFE_VALUE = /[{};<>]/
const FORBIDDEN = ['@import', '@charset', 'expression(', 'javascript:', '</']

/** Why this token value cannot be stored, or null when it can be. */
export function themeValueError(varName: string, value: unknown): string | null {
  if (!parseVarName(varName)) return 'That is not a token name Studio reads (bg-, fg-, space-, text-, radius- or width- followed by a slot)'
  if (typeof value !== 'string') return 'A token value must be text'
  const v = value.trim()
  if (v === '') return 'A token value cannot be empty - reset it to use the config value instead'
  if (v.length > 200) return 'A token value is limited to 200 characters'
  if (UNSAFE_VALUE.test(v)) return 'A token value cannot contain braces, semicolons or angle brackets'
  const lower = v.toLowerCase()
  for (const bad of FORBIDDEN) {
    if (lower.includes(bad)) return `A token value cannot contain "${bad}"`
  }
  return null
}

/**
 * A font as the store should hold it, from a body naming ONE source.
 * Throws the reason: the Theme panel shows it beside the picker, and Porter
 * reports it as the refusal for the row.
 */
export function readThemeFont(name: string, raw: unknown): FontToken {
  if (typeof name !== 'string' || !SAFE_FONT_NAME.test(name) || name.length > 64) {
    throw new Error('A font name uses letters, digits, hyphens and underscores, and starts with a letter')
  }
  const entry = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  if (typeof entry.google === 'string' && entry.google.trim() !== '' && !isGoogleFont(entry.google.trim())) {
    throw new Error(`"${entry.google.trim()}" is not in Studio's Google Fonts list`)
  }
  // The config reader is the one normaliser for the three shapes, so a
  // stored font can never differ from a config font in what it may carry.
  const [font] = fontTokens({ studio: { tokens: { font: [{ ...entry, name }] } } } as never)
  if (!font) throw new Error('A font needs one source: a Google family, a system stack, or uploaded files')
  return font
}
