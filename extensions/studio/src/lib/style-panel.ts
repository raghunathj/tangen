/**
 * File Name: style-panel.ts
 * Purpose: Pure model for the kit style panel - which blocks get token
 *          pickers (kit.*), which prop belongs to which token family, the
 *          palette swatch CSS, and the ladder scale the visual pickers
 *          size their samples with. Everything derives from the field
 *          SCHEMA (a select whose options are exactly one DEFAULT slot
 *          list IS that family's token prop) - the contract's no-per-
 *          widget-forks rule, mechanically.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Matching against the DEFAULT lists is sound because
 *          kit defs carry the defaults verbatim (builder-kit.ts) while the
 *          workspace's EXTENDED lists live only in the tokens endpoint the
 *          panel fetches - defs stay contract-pure, pickers show more.
 */
import type { SubField } from '@tangen/types'
import { DEFAULT_TOKENS, TOKEN_FAMILIES, type TokenFamily } from '../tokens'

/** Kit blocks (kit.*) get the token style panel; everything else keeps the plain rail. */
export function isKitBlock(type: string | null | undefined): boolean {
  return typeof type === 'string' && type.startsWith('kit.')
}

/**
 * The token family a kit prop binds to, read off the SCHEMA: a select
 * whose option values are exactly a DEFAULT slot list (same order, same
 * length) is that family's token prop. Null means "not a token prop" -
 * the rail renders the normal FieldControl. Resolving by option list, not
 * prop name, is what lets kit.spacer's `size` be space while
 * kit.heading's `size` is type, with zero per-widget switches.
 */
export function tokenFamilyForField(field: Pick<SubField, 'fieldType' | 'config'>): TokenFamily | null {
  if (field.fieldType !== 'select') return null
  const values = (field.config?.options ?? []).map((o) => o.value)
  if (values.length === 0) return null
  for (const family of TOKEN_FAMILIES) {
    const slots = DEFAULT_TOKENS[family]
    if (values.length === slots.length && values.every((v, i) => v === slots[i])) return family
  }
  return null
}

/**
 * Admin-side PREVIEW approximations for the default palette slots - the
 * rendering runtime's stylesheet owns the real values; these only keep the
 * swatches legible inside the admin, where no --tg-* vars are defined.
 */
const PALETTE_PREVIEW: Record<string, string> = {
  default: '#ffffff',
  muted: '#f4f4f5',
  brand: '#4f46e5',
  accent: '#0ea5e9',
  inverse: '#111827',
}

/** CSS custom-property-name-safe slot names only (site-authored strings). */
const CSS_SAFE_SLOT = /^[a-zA-Z0-9_-]+$/

/**
 * The background CSS for one palette swatch: `var(--tg-bg-<slot>, fallback)`
 * per the contract, so a site that loads its token stylesheet into the
 * admin sees its real colors; the fallback keeps default slots legible and
 * extended slots neutral. Non-CSS-safe slot names render transparent.
 */
export function paletteSwatchCss(slot: string): string {
  if (!CSS_SAFE_SLOT.test(slot)) return 'transparent'
  return `var(--tg-bg-${slot}, ${PALETTE_PREVIEW[slot] ?? 'transparent'})`
}

/**
 * Where a slot sits on its family's ladder, 0..1 - the pickers size their
 * samples (bar heights, "Aa" ramps, corner radii) off this, so extended
 * slots slot into the visual scale with no per-slot knowledge.
 */
export function scaleSample(index: number, count: number): number {
  if (count <= 1) return 1
  return Math.min(1, Math.max(0, index / (count - 1)))
}
