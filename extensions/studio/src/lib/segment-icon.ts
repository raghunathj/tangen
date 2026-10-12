/**
 * File Name: segment-icon.ts
 * Purpose: Which segmented options show an icon instead of a word.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Icons earn their place only where they read FASTER
 *          than the word. Alignment, breakpoints and heading levels qualify;
 *          a column count does not - "3" is clearer than any glyph of three
 *          columns, so `columns` deliberately keeps its labels.
 *
 *          The mapping is keyed on the prop name AND the value, because the
 *          same value means different things on different props.
 */
import type { IconName } from '@tangen/types'

/** Normalises `text_align`, `textAlign` and `ALIGN` to one key. */
function norm(value: string): string {
  return String(value).toLowerCase().replace(/[\s_-]/g, '')
}

/** Prop names that mean horizontal alignment. */
const ALIGN_PROPS = new Set(['align', 'textalign', 'alignment', 'alignx', 'justify'])

const ALIGN: Record<string, IconName> = {
  left: 'IconAlignLeft',
  start: 'IconAlignLeft',
  center: 'IconAlignCenter',
  centre: 'IconAlignCenter',
  middle: 'IconAlignCenter',
  right: 'IconAlignRight',
  end: 'IconAlignRight',
  justify: 'IconAlignJustify',
}

const LEVEL: Record<string, IconName> = {
  h1: 'IconH1', h2: 'IconH2', h3: 'IconH3', h4: 'IconH4',
}

const BREAKPOINT: Record<string, IconName> = {
  mobile: 'IconSmartphone',
  tablet: 'IconTablet',
  desktop: 'IconComputer',
}

const LAYOUT: Record<string, IconName> = {
  grid: 'IconLayoutGrid',
  list: 'IconLayoutRow',
  row: 'IconLayoutRow',
  column: 'IconLayoutColumn',
  columns: 'IconLayoutColumn',
}

/** The icon for one option of one prop, or null when a word reads better. */
export function segmentIcon(prop: string, value: string): IconName | null {
  const p = norm(prop)
  const v = norm(value)
  if (ALIGN_PROPS.has(p)) return ALIGN[v] ?? null
  if (p === 'level' || p === 'headinglevel') return LEVEL[v] ?? null
  if (p === 'hideon' || p === 'showon' || p === 'breakpoint') return BREAKPOINT[v] ?? null
  if (p === 'layout' || p === 'direction') return LAYOUT[v] ?? null
  return null
}

interface Option { label?: unknown; value?: unknown }

/**
 * Icons for a whole option set, or null to use the labels. All or nothing:
 * a half-iconed row reads as broken rather than as a deliberate mix.
 */
export function segmentIcons(prop: string, options: Option[]): IconName[] | null {
  if (options.length === 0) return null
  const icons: IconName[] = []
  for (const o of options) {
    const icon = segmentIcon(prop, String(o?.value ?? ''))
    if (!icon) return null
    icons.push(icon)
  }
  return icons
}
