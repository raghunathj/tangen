/**
 * File Name: theme-panel.ts
 * Purpose: The pure state behind the editable Variables panel (T-T4): the
 *          rows per token family with where each value comes from, the
 *          font rows with their source, and the validation the panel shows
 *          before a save.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The panel is a renderer of what this hands it, so the
 *          interesting decisions are testable without a render:
 *
 *          - A palette slot is TWO rows, bg and fg. The runtime reads them
 *            as two variables (`--tg-bg-brand` paints, `--tg-fg-brand` is
 *            the text on it), and a designer changing the brand colour has
 *            to be able to keep the text legible.
 *          - Three sources, named honestly. `override` is in the store
 *            (T-T1); `config` is the site's seed; `runtime` means nobody
 *            declared a value and the runtime stylesheet's default is what
 *            renders. The old panel guessed at that last one; this says so.
 *          - Validation is the store's own rule (`themeValueError`), so the
 *            panel refuses exactly what the server would and never shows a
 *            save that then fails.
 *
 *          Pure module - no platform imports.
 */
import { isGoogleFont } from '@tangen/studio-schema'
import { TOKEN_FAMILIES, type StudioTokens, type TokenFamily, type FontToken } from '../tokens'
import { themeValueError } from './theme'

/** Where a token's effective value comes from. */
export type TokenSource = 'override' | 'config' | 'runtime'

export interface TokenRow {
  family: TokenFamily
  slot: string
  /** The palette half this row is, or null for the other families. */
  half: 'bg' | 'fg' | null
  /** The name the runtime reads the variable under: `bg-brand`, `space-lg`. */
  varName: string
  /** The declared value, or null when the runtime default is what renders. */
  value: string | null
  source: TokenSource
  /** Position on the family's ladder, 0..1, for the sample. */
  at: number
}

/** The custom-property prefix each family is read under by the runtime. */
const VAR_PREFIX: Record<TokenFamily, string> = {
  palette: 'bg', space: 'space', type: 'text', radius: 'radius', width: 'width',
}

function sourceOf(varName: string, values: Record<string, string>, overridden: ReadonlySet<string>): TokenSource {
  if (overridden.has(varName)) return 'override'
  return varName in values ? 'config' : 'runtime'
}

/** The rows one family shows, in the family's slot order. */
export function tokenRows(
  family: TokenFamily,
  tokens: StudioTokens,
  values: Record<string, string> = {},
  overridden: readonly string[] = [],
): TokenRow[] {
  const held = new Set(overridden)
  const slots = tokens[family] ?? []
  const out: TokenRow[] = []
  slots.forEach((slot, i) => {
    const at = slots.length <= 1 ? 1 : i / (slots.length - 1)
    const halves: Array<'bg' | 'fg' | null> = family === 'palette' ? ['bg', 'fg'] : [null]
    for (const half of halves) {
      const varName = `${half ?? VAR_PREFIX[family]}-${slot}`
      out.push({
        family, slot, half, varName, at,
        value: varName in values ? values[varName] : null,
        source: sourceOf(varName, values, held),
      })
    }
  })
  return out
}

/** Every family's rows, for a panel that draws them all. */
export function allTokenRows(tokens: StudioTokens, values?: Record<string, string>, overridden?: readonly string[]): Record<TokenFamily, TokenRow[]> {
  const out = {} as Record<TokenFamily, TokenRow[]>
  for (const family of TOKEN_FAMILIES) out[family] = tokenRows(family, tokens, values, overridden)
  return out
}

/** The words the panel uses for a source. No em dashes. */
export function sourceLabel(source: TokenSource): string {
  switch (source) {
    case 'override': return 'Custom'
    case 'config': return 'From config'
    case 'runtime': return 'Runtime default'
  }
}

/** The store's own validation, so the panel refuses what the server would. */
export function tokenInputError(varName: string, value: string): string | null {
  return themeValueError(varName, value)
}

/** The three sources a font may come from, as the picker lists them. */
export type FontSourceKind = 'google' | 'stack' | 'files'

export const FONT_SOURCES: ReadonlyArray<{ id: FontSourceKind; label: string }> = [
  { id: 'google', label: 'Google Fonts' },
  { id: 'stack', label: 'System stack' },
  { id: 'files', label: 'Uploaded files' },
]

export function fontSourceOf(font: FontToken): FontSourceKind {
  if (font.google) return 'google'
  if (font.stack) return 'stack'
  return 'files'
}

export interface FontRow {
  name: string
  font: FontToken
  kind: FontSourceKind
  source: 'override' | 'config'
  /** One line the list shows: "Google: Inter", "System stack: Georgia, serif", "2 uploaded files". */
  summary: string
}

export function fontRows(fonts: readonly FontToken[], overridden: readonly string[] = []): FontRow[] {
  const held = new Set(overridden)
  return fonts.map((font) => {
    const kind = fontSourceOf(font)
    const summary = kind === 'google'
      ? `Google: ${font.google}`
      : kind === 'stack'
        ? `System stack: ${font.stack}`
        : `${font.files?.length ?? 0} uploaded file${(font.files?.length ?? 0) === 1 ? '' : 's'}`
    return { name: font.name, font, kind, source: held.has(`font:${font.name}`) ? 'override' : 'config', summary }
  })
}

/** What the font picker's fields hold. */
export interface FontDraft {
  google?: string
  stack?: string
  /** One file per line: `url [weight] [style]`. */
  files?: string
}

/** The body PATCH theme/fonts/:name takes - a font without its name. */
export type FontSource = Omit<FontToken, 'name'>

/**
 * Turns the picker's fields into one font source, or says what is missing.
 * The file list is typed rather than uploaded here: the media library
 * already holds the files, and a url per line is what a designer can paste.
 */
export function buildFont(kind: FontSourceKind, draft: FontDraft): { font: FontSource } | { error: string } {
  if (kind === 'google') {
    const google = (draft.google ?? '').trim()
    if (!google) return { error: 'Pick a Google family' }
    if (!isGoogleFont(google)) return { error: `"${google}" is not in Studio's Google Fonts list` }
    return { font: { google } }
  }
  if (kind === 'stack') {
    const stack = (draft.stack ?? '').trim()
    if (!stack) return { error: 'Type a font stack, like Georgia, serif' }
    return { font: { stack } }
  }
  const lines = (draft.files ?? '').split(/[\n,]/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return { error: 'Add at least one file url, one per line, with an optional weight' }
  const files: NonNullable<FontToken['files']> = []
  for (const line of lines) {
    const [url, weight, style] = line.split(/\s+/)
    const file: { url: string; weight?: number; style?: string } = { url }
    if (weight !== undefined) {
      const n = Number(weight)
      if (!Number.isInteger(n) || n < 1 || n > 1000) return { error: `"${weight}" is not a weight - use a number like 400 or 700` }
      file.weight = n
    }
    if (style !== undefined) file.style = style
    files.push(file)
  }
  return { font: { files } }
}
