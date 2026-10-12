/**
 * File Name: wrapper.ts
 * Purpose: The Studio WRAPPER - the chrome Studio supplies to any block:
 *          box styling and responsive visibility. Defined ONCE here instead
 *          of repeated across every component def, and offered for a
 *          developer's own components too, so nobody hand-authors `hideOn`
 *          on a hero just to hide it on mobile.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Stored under the reserved `_studio` key. The platform
 *          already treats underscore-prefixed keys as its own
 *          (`_key`/`_type`/`_disabled`/`_label`) and nobody names a
 *          component prop that way, so collision with a developer's props
 *          is impossible BY CONSTRUCTION - a site's `hero` may keep its own
 *          `background` meaning a media picker without either shadowing the
 *          other.
 *
 *          `readWrapper` falls back to the flat shape so content written
 *          before the move keeps rendering with no migration; `writeWrapper`
 *          folds any flat value it finds into the namespace, so a block
 *          never ends up carrying both.
 *
 *          Which fields apply mirrors the runtime exactly: layout blocks
 *          that style themselves take visibility only, and kit.image keeps
 *          its own `rounded` (which rounds the image, not the box).
 */
import type { SubField } from '@tangen/types'
import { DEFAULT_TOKENS } from '../tokens'

/** The reserved key the whole wrapper lives under. */
export const STUDIO_WRAPPER_PROP = '_studio'

const opts = (values: readonly string[]) => values.map((v) => ({ label: v, value: v }))

/** Box chrome - every block except the ones that style themselves. */
export const WRAPPER_BOX_FIELDS: SubField[] = [
  { name: 'background', label: 'Background', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.palette) } },
  { name: 'color', label: 'Text colour', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.palette) } },
  { name: 'padding', label: 'Padding', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.space) } },
  { name: 'rounded', label: 'Rounded', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.radius) } },
]

/** Responsive visibility - EVERY block, with no exception. */
export const WRAPPER_VISIBILITY_FIELDS: SubField[] = [
  {
    // Advanced, not Style: hiding at a breakpoint is behaviour, and sitting
    // it beside Padding invites using it as a layout tool.
    name: 'hideOn', label: 'Hide on', fieldType: 'multiselect', group: 'advanced',
    config: { options: [['mobile', 'Mobile'], ['tablet', 'Tablet'], ['desktop', 'Desktop']].map(([value, label]) => ({ label, value })) },
  },
]

/** Kit blocks that own their whole box, so the wrapper adds none of it. */
const SELF_STYLED = new Set(['kit.section', 'kit.row', 'kit.loop'])

/** kit.image's own `rounded` rounds the IMAGE; the wrapper leaves it alone. */
const NO_WRAPPER_ROUNDED = new Set(['kit.image'])

/**
 * The wrapper fields a block type gets.
 *
 * `ownProps` are the names the block's own schema declares. Any box slot it
 * already has is dropped, because two controls for one property is worse than
 * either: they disagree about what is set, and the reported symptom was a
 * Style tab listing Background, Text colour, Padding and Rounded twice.
 *
 * Deriving this beats the hardcoded kit list it replaces - that list could
 * never cover a SITE-defined component, which is exactly where the duplicate
 * showed up.
 */
export function wrapperFieldsFor(_type: string, _ownProps: readonly string[] = []): SubField[] {
  // The box chrome is RETIRED (Arc W-2). The class panel owns background,
  // colour, padding and radius now, and rendering both was the reported
  // duplicate. WRAPPER_BOX_FIELDS is kept for reading legacy values and for
  // the migration - it is simply no longer offered as controls.
  //
  // Visibility stays: it is Studio's own, not a style slot a developer can
  // own, and losing it would remove the only responsive control.
  return [...WRAPPER_VISIBILITY_FIELDS]
}

type Block = Record<string, unknown>

const bag = (block: Block | null | undefined): Record<string, unknown> | null => {
  const raw = block?.[STUDIO_WRAPPER_PROP]
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

/**
 * One wrapper value: the namespace first, then the legacy flat prop so
 * content written before the move keeps rendering.
 */
export function readWrapper(block: Block | null | undefined, name: string): unknown {
  if (!block || typeof block !== 'object') return undefined
  const inner = bag(block)?.[name]
  return inner !== undefined ? inner : block[name]
}

/** All wrapper field names, for migration and emptiness checks. */
const ALL_NAMES = [...WRAPPER_BOX_FIELDS, ...WRAPPER_VISIBILITY_FIELDS].map((f) => f.name)

/**
 * Writes one wrapper value, immutably. Any legacy FLAT value is folded into
 * the namespace at the same time - leaving both would let the read fallback
 * keep serving a stale value the rail no longer shows. Clearing the last
 * value removes the key rather than leaving an empty object behind.
 */
export function writeWrapper(block: Block, name: string, value: unknown): Block {
  const next: Block = { ...block }
  const inner: Record<string, unknown> = { ...(bag(block) ?? {}) }

  // Fold legacy flat values in, so a block never carries both shapes.
  for (const n of ALL_NAMES) {
    if (n in next) {
      if (!(n in inner) && next[n] !== undefined) inner[n] = next[n]
      delete next[n]
    }
  }

  if (value === undefined || value === null || value === '') delete inner[name]
  else inner[name] = value

  if (Object.keys(inner).length === 0) delete next[STUDIO_WRAPPER_PROP]
  else next[STUDIO_WRAPPER_PROP] = inner
  return next
}

/** True when a block carries any wrapper value, in either shape. */
export function hasWrapperValues(block: Block | null | undefined): boolean {
  if (!block || typeof block !== 'object') return false
  const inner = bag(block)
  if (inner && Object.keys(inner).length > 0) return true
  return ALL_NAMES.some((n) => block[n] !== undefined)
}
