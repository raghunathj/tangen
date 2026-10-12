/**
 * File Name: translate-rows.ts
 * Purpose: The model behind the inspector's row-translation panel: which
 *          rows of a repeater can be translated, what each is called, and
 *          which cannot be addressed yet.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A repeater inside a block (a button group's buttons,
 *          an accordion's items) is not one value with a side column; it is
 *          rows, each keyed by `_key`, and the overlay keeps a map under the
 *          repeater prop keyed the same way (docs/localization.md). The
 *          admin's repeater editor does the same thing with one input per
 *          locale under each row; Studio shows one locale at a time, so the
 *          panel lists the rows and, under each, the localized fields.
 *
 *          Reading and writing go through locale-overlay.ts like every
 *          other prop - this module decides nothing about the overlay. It
 *          is pure so the panel's behaviour is pinned without a renderer.
 */
import type { SubField } from '@tangen/types'

export interface TranslationRow {
  /** The row's `_key`, the name the overlay addresses it by. */
  key: string
  /** Position in the base array, for the fallback title. */
  index: number
  /** The row as stored in the default locale. */
  base: Record<string, unknown>
}

export interface TranslationRows {
  rows: TranslationRow[]
  /** Rows that have no `_key` yet and so cannot be translated until a base save mints one. */
  unkeyed: number
}

/** The keyed rows of a repeater value, in order; rows without a key are counted, not guessed. */
export function translationRows(value: unknown): TranslationRows {
  if (!Array.isArray(value)) return { rows: [], unkeyed: 0 }
  const rows: TranslationRow[] = []
  let unkeyed = 0
  value.forEach((row, index) => {
    const key = row && typeof row === 'object' && !Array.isArray(row)
      ? (row as { _key?: unknown })._key
      : undefined
    if (typeof key === 'string' && key) rows.push({ key, index, base: row as Record<string, unknown> })
    else unkeyed += 1
  })
  return { rows, unkeyed }
}

/** Longer than this and the title wraps in a 320px rail. */
const TITLE_MAX = 40

/**
 * What a row is called in the panel: its first localized text in the base
 * language, so the translator knows WHICH button this is, else its number.
 */
export function rowTitle(base: Record<string, unknown>, localized: readonly SubField[], index: number): string {
  for (const f of localized) {
    const v = base[f.name]
    if (typeof v === 'string' && v.trim()) {
      const t = v.trim()
      return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX).trimEnd()}...` : t
    }
  }
  return `Row ${index + 1}`
}

/** The note under the panel when some rows wait for a base save, or null. */
export function unkeyedRowsReason(unkeyed: number, defaultLocale: string): string | null {
  if (unkeyed <= 0) return null
  return unkeyed === 1
    ? `1 row has no key yet. Save once in ${defaultLocale}, then translate it.`
    : `${unkeyed} rows have no key yet. Save once in ${defaultLocale}, then translate them.`
}
