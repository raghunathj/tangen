/**
 * File Name: css-value.ts
 * Purpose: Reading and writing CSS values for the visual style controls -
 *          splitting "1.5rem" into a number and a unit so it can be edited
 *          as a stepper plus a unit picker rather than typed as text.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The rule throughout is DO NOT MANGLE. A value the
 *          controls cannot represent - `auto`, `calc(...)`, `var(--x)` - is
 *          reported as a keyword or raw string and handed back unchanged, so
 *          editing a neighbouring property can never quietly destroy it.
 *          Text inputs were at least honest about this; a stepper that reads
 *          `calc(100% - 2rem)` as `100` would not be.
 */

/** Lengths that are words, not measurements. */
export const KEYWORD_LENGTHS = ['auto', 'none', 'inherit', 'initial', 'unset'] as const
export type KeywordLength = (typeof KEYWORD_LENGTHS)[number]

export interface ParsedLength {
  value?: number
  unit?: string
  /** The value is a word (`auto`), not a measurement. */
  keyword?: string
  /** The value is an expression the controls cannot edit; preserve verbatim. */
  raw?: string
}

const LENGTH_RE = /^(-?\d*\.?\d+)\s*(px|rem|em|%|vh|vw|ch|pt)?$/i

/** Splits a stored value into something the controls can edit, or flags it. */
export function parseLength(input: string | undefined | null): ParsedLength {
  const text = String(input ?? '').trim()
  if (text === '') return {}

  const keyword = KEYWORD_LENGTHS.find((k) => k === text.toLowerCase())
  if (keyword) return { keyword }

  const m = LENGTH_RE.exec(text)
  if (!m) return { raw: text }

  const value = Number(m[1])
  if (!Number.isFinite(value)) return { raw: text }
  // A bare number means pixels - it is what a designer typing "24" intends.
  return { value, unit: (m[2] ?? 'px').toLowerCase() }
}

/** Joins a number and unit back into a stored value; empty CLEARS the prop. */
export function formatLength(value: number | null | undefined, unit: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  // Number's own formatting drops the trailing zero, so 24.0 becomes "24".
  return `${value}${unit}`
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const FN_RE = /^(rgb|rgba|hsl|hsla|color|var)\(/i
const NAMED_RE = /^[a-z]+$/i

/** True when a value plausibly names a colour in any of its usual shapes. */
export function isColorish(input: string | undefined | null): boolean {
  const text = String(input ?? '').trim()
  if (text === '') return false
  return HEX_RE.test(text) || FN_RE.test(text) || NAMED_RE.test(text)
}

/**
 * A 6-digit hex for the native swatch, which understands nothing else. The
 * STORED value stays whatever the user wrote - this is display only, and
 * black is the honest fallback for a colour the swatch cannot render.
 */
export function normalizeHex(input: string | undefined | null): string {
  const text = String(input ?? '').trim()
  if (!HEX_RE.test(text)) return '#000000'
  const hex = text.slice(1).toLowerCase()
  return hex.length === 3 ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : `#${hex}`
}
