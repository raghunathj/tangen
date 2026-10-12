/**
 * File Name: token-migration.ts
 * Purpose: Token slots become class properties, so Studio has ONE styling
 *          system instead of two overlapping ones.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Studio grew a class engine alongside the token slots it
 *          was meant to replace, and the two collided on background, colour,
 *          padding and radius - the Style tab listed each of them twice. This
 *          is the one-way door out: a block's token values become the
 *          equivalent class properties, and the slot controls stop existing.
 *
 *          Values become token REFERENCES - `{space.md}` - not resolved
 *          pixels and not var() strings. The reference is the source of
 *          truth; the compiler derives the CSS variable, and the site's
 *          stylesheet still decides what `md` means, so changing a token
 *          reaches every page. Resolving here would freeze the design system
 *          into the content; storing the var string would store CSS where a
 *          reference belongs.
 *
 *          Padding and radius expand to all four sides deliberately - the
 *          class panel edits per side, and a single shorthand would have to
 *          be taken apart the first time anyone used it.
 */
import type { SubField } from '@tangen/types'
import { DEFAULT_TOKENS, type TokenFamily } from '../tokens'
import { STUDIO_WRAPPER_PROP } from './wrapper'
import { formatTokenRef } from '@tangen/studio-schema'

/** A slot name safe to drop inside `var(--tg-…)`. */
const SAFE_SLOT = /^[A-Za-z0-9_-]+$/

/** How one slot family becomes CSS, given the slot name. */
type Expand = (slot: string) => Record<string, string>

const sides = (prefix: string, suffix: string, value: string): Record<string, string> =>
  Object.fromEntries(['top', 'right', 'bottom', 'left'].map((s) => [`${prefix}-${s}${suffix}`, value]))

const corners = (value: string): Record<string, string> => ({
  'border-top-left-radius': value,
  'border-top-right-radius': value,
  'border-bottom-right-radius': value,
  'border-bottom-left-radius': value,
})

/**
 * The whole migration, as a table.
 *
 * `palette` appears twice with different vars: a palette slot means the
 * BACKGROUND var when it is a background and the FOREGROUND var when it is
 * text, which is why the family alone cannot decide.
 */
const MAPPING: Record<string, { family: TokenFamily; expand: Expand }> = {
  background: { family: 'palette', expand: (s) => ({ 'background-color': formatTokenRef('palette', s) }) },
  color: { family: 'palette', expand: (s) => ({ color: formatTokenRef('palette', s) }) },
  padding: { family: 'space', expand: (s) => sides('padding', '', formatTokenRef('space', s)) },
  rounded: { family: 'radius', expand: (s) => corners(formatTokenRef('radius', s)) },
  size: { family: 'type', expand: (s) => ({ 'font-size': formatTokenRef('type', s) }) },
  width: { family: 'width', expand: (s) => ({ width: formatTokenRef('width', s) }) },
}

/** The slot names that carry style, in the order they are applied. */
const SLOTS = Object.keys(MAPPING)

/**
 * The slots the class panel now owns.
 *
 * A field with one of these names is no longer rendered as its own control -
 * the class panel has a real property for each, and two controls for one
 * property is what made the Style tab list Background, Text colour, Padding
 * and Rounded twice. The VALUES are not lost: `tokenPropsToStyle` moves them.
 */
export const MIGRATED_SLOTS: ReadonlySet<string> = new Set(SLOTS)

type Block = Record<string, unknown>
type Def = { fields?: SubField[] } | null | undefined

/** A slot value worth migrating, or undefined. */
function slotValue(raw: unknown, family: TokenFamily): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  if (!SAFE_SLOT.test(raw)) return undefined
  // Only DECLARED slots migrate. An unrecognised one would otherwise become
  // `var(--tg-space-enormous)` - a rule that silently does nothing.
  return (DEFAULT_TOKENS[family] as readonly string[]).includes(raw) ? raw : undefined
}

/**
 * The class properties equivalent to a block's token slots.
 *
 * Reads the `_studio` wrapper first and the block's own declared props
 * second: the wrapper is Studio's own chrome, so it is what the user set most
 * recently and it wins. A prop the block's schema does NOT declare is
 * content, not style, and is left alone.
 */
export function tokenPropsToStyle(block: Block, def: Def): Record<string, string> {
  const wrapper = block[STUDIO_WRAPPER_PROP]
  const bag = wrapper && typeof wrapper === 'object' && !Array.isArray(wrapper)
    ? wrapper as Record<string, unknown>
    : {}
  const declared = new Set((def?.fields ?? []).map((f) => f.name))

  const out: Record<string, string> = {}
  for (const slot of SLOTS) {
    const { family, expand } = MAPPING[slot]
    const raw = slot in bag ? bag[slot] : (declared.has(slot) ? block[slot] : undefined)
    const value = slotValue(raw, family)
    if (value) Object.assign(out, expand(value))
  }
  return out
}

/** Whether a block carries anything the migration would move. */
export function hasTokenValues(block: Block, def: Def): boolean {
  return Object.keys(tokenPropsToStyle(block, def)).length > 0
}
