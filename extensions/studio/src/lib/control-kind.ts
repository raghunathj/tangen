/**
 * File Name: control-kind.ts
 * Purpose: Which compact control an inspector field gets, and whether the
 *          field fits a two-column row at all.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Studio's inspector is 320px. Every comparable builder
 *          puts the label LEFT and the control RIGHT at 24-28px, roughly
 *          twice the density of the admin's stacked CRUD row - but only
 *          because it never tries to fit a media picker or a richtext editor
 *          into 180px. Deciding which fields can take the compact row, and
 *          honestly conceding the ones that cannot, is this module's job.
 *
 *          Token-bound props never reach here: `tokenFamilyForField` claims
 *          them first and they render as token pickers.
 */
import type { SubField } from '@tangen/types'

/** Segments narrower than this stop being readable in a 180px column. */
export const SEGMENT_MAX_OPTIONS = 4
/** A segment label longer than this cannot sit on one line. */
export const SEGMENT_MAX_LABEL = 8

export type ControlKind =
  | 'switch'      // boolean
  | 'stepper'     // number, scrubbable
  | 'segmented'   // short closed enum, one visible button per option
  | 'toggles'     // short multiselect - segmented, but many may be on
  | 'select'      // closed enum too wide to segment
  | 'text'        // single-line string
  | 'wide'        // needs the full column and its own control

/** Two-column (label left) or stacked (label above). */
export type RowLayout = 'inline' | 'stacked'

const BOOLEAN = new Set(['boolean', 'checkbox', 'toggle', 'switch'])
const NUMBER = new Set(['number', 'integer', 'float', 'decimal'])
const CLOSED_ENUM = new Set(['select', 'radio'])
const SHORT_TEXT = new Set(['text', 'string', 'slug', 'url', 'email', 'phone', 'color'])

interface Option { label?: unknown; value?: unknown }

/** Options a field declares up front, or null when there are none to lay out. */
function optionsOf(field: SubField): Option[] | null {
  const raw = (field.config as { options?: unknown } | undefined)?.options
  if (!Array.isArray(raw)) return null
  const clean = raw.filter((o): o is Option => !!o && typeof o === 'object')
  return clean.length > 0 ? clean : null
}

/** True when the options are few enough and short enough to sit in a row. */
function segmentable(options: Option[]): boolean {
  if (options.length > SEGMENT_MAX_OPTIONS) return false
  return options.every((o) => {
    const label = typeof o.label === 'string' ? o.label : String(o.value ?? '')
    return label.length <= SEGMENT_MAX_LABEL
  })
}

/**
 * The control one inspector field gets. Anything not positively recognised
 * falls to `wide`, which keeps its existing full-width control - an unknown
 * field type squeezed into 180px would be a regression, not a redesign.
 */
export function controlKind(field: SubField): ControlKind {
  const type = String(field.fieldType ?? '')
  if (BOOLEAN.has(type)) return 'switch'
  if (NUMBER.has(type)) return 'stepper'

  if (CLOSED_ENUM.has(type)) {
    const options = optionsOf(field)
    // No options yet (they load dynamically) means nothing to lay out.
    if (!options) return 'wide'
    return segmentable(options) ? 'segmented' : 'select'
  }

  if (type === 'multiselect') {
    const options = optionsOf(field)
    return options && segmentable(options) ? 'toggles' : 'wide'
  }

  if (SHORT_TEXT.has(type)) return 'text'
  return 'wide'
}

/** Where the label sits for a given control. */
export function rowLayout(kind: ControlKind): RowLayout {
  return kind === 'wide' ? 'stacked' : 'inline'
}

// ── Token families ──────────────────────────────────────────────────────────

/** Swatches that still fit a 180px column without becoming pinheads. */
export const SWATCH_INLINE_MAX = 10

/**
 * Whether a token family fits the compact row. Only the palette does: a
 * colour needs no label to be understood, because the swatch IS the value.
 * The other families are LADDERS whose tiles are legible only beside their
 * slot names ("md", "lg"), and those names need the width.
 */
export function tokenLayout(family: string, slotCount: number): RowLayout {
  if (family !== 'palette') return 'stacked'
  if (slotCount === 0 || slotCount > SWATCH_INLINE_MAX) return 'stacked'
  return 'inline'
}
