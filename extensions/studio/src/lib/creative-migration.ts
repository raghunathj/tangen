/**
 * File Name: creative-migration.ts
 * Purpose: Creative Mode's freeform values become class properties, so Studio
 *          has ONE styling system instead of three.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The sibling of token-migration.ts, and the last of the
 *          three. W-1 folded the token slots into classes; this folds in the
 *          freeform bag, and what remains is a class panel plus the raw-CSS
 *          escape hatch in custom-css.ts.
 *
 *          Two things make this NOT a copy of the token migration.
 *
 *          First, the source must GO. Token slots render as classes, so
 *          leaving them behind after W-1 was harmless duplication. Creative
 *          values render as an INLINE style attribute (studio-react
 *          `creativeStyle`), and inline beats every class - a block that kept
 *          its bag would accept class edits, save them, and never change on
 *          screen. `withoutCreativeStyle` is therefore part of the migration,
 *          not a tidy-up.
 *
 *          Second, the bag allow-listed by CHARACTER, so `textAlign` accepted
 *          any short safe-looking string. A class property is a REGISTRY
 *          property, and the registry says which values exist - so an enum
 *          value the registry does not offer is dropped rather than carried
 *          into a rule that would silently do nothing.
 *
 *          Hover has no inline equivalent; the runtime routed it through
 *          custom properties and a `:hover` rule. On a class it is simply the
 *          hover STATE of the same property, which is where the panel already
 *          looks for it.
 */
import { propertyById, fontStack, type StoredValue } from '@tangen/studio'
import { CREATIVE_STYLE_PROP, sanitizeCreativeStyle } from './creative-style'

/**
 * What each shadow preset has always rendered as. Copied from
 * studio-react's stylesheet rather than imported - the extension does not
 * depend on the React runtime - and held to that source by a test, because a
 * preset redefined there would change what migrated blocks look like.
 */
export const SHADOW_PRESET_CSS: Record<string, string> = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.06)',
  md: '0 4px 12px rgba(0, 0, 0, 0.08)',
  lg: '0 12px 32px rgba(0, 0, 0, 0.12)',
}

type Props = Record<string, StoredValue>

/** How one creative field becomes class properties. */
type Expand = (value: string) => Props

const sides = (prefix: string, suffix: string, value: string): Props =>
  Object.fromEntries(['top', 'right', 'bottom', 'left'].map((s) => [`${prefix}-${s}${suffix}`, value]))

const corners = (value: string): Props => ({
  'border-top-left-radius': value,
  'border-top-right-radius': value,
  'border-bottom-right-radius': value,
  'border-bottom-left-radius': value,
})

/** A one-for-one field, with no reshaping beyond the rename. */
const one = (id: string): Expand => (value) => ({ [id]: value })

/**
 * An enum field, held to the values the registry actually offers. The bag
 * allowed anything short and safe-looking, which is how `text-align: bananas`
 * could be stored; carrying it forward would produce a declaration the
 * browser drops, which reads as a broken migration rather than a bad value.
 */
const enumOf = (id: string): Expand => (value) => {
  const options = propertyById(id)?.options ?? []
  return options.includes(value) ? { [id]: value } : {}
}

/**
 * The whole migration, as a table. Order matters only for the hover fields,
 * which merge into properties the normal fields may already have set - so
 * they are applied afterwards, not from here.
 */
const MAPPING: Record<string, Expand> = {
  width: one('width'),
  maxWidth: one('max-width'),
  minHeight: one('min-height'),
  marginTop: one('margin-top'),
  marginBottom: one('margin-bottom'),
  paddingX: (v) => ({ 'padding-left': v, 'padding-right': v }),
  paddingY: (v) => ({ 'padding-top': v, 'padding-bottom': v }),

  // The bag stored a family NAME and the runtime expanded it, so the stack is
  // built here too: storing the bare name would drop the category-matched
  // fallback and let a failed webfont reflow the page into another design.
  fontFamily: (v) => ({ 'font-family': fontStack(v) }),
  fontSize: one('font-size'),
  fontWeight: enumOf('font-weight'),
  lineHeight: one('line-height'),
  letterSpacing: one('letter-spacing'),
  textAlign: enumOf('text-align'),
  textTransform: enumOf('text-transform'),
  color: one('color'),

  // A width with no style never paints, and authors reach for width first -
  // the runtime implied `solid` every time, so the migration must too or
  // every migrated border quietly disappears.
  borderWidth: (v) => ({ ...sides('border', '-width', v), 'border-style': 'solid' }),
  borderColor: one('border-color'),
  borderRadius: (v) => corners(v),

  // `none` was the ABSENCE of a shadow, not a value: the runtime emitted a
  // class only for the other three, so there is nothing to carry.
  shadow: (v): Props => (SHADOW_PRESET_CSS[v] ? { 'box-shadow': SHADOW_PRESET_CSS[v] } : {}),
}

/** The hover fields, and the property whose hover state they become. */
const HOVER: Record<string, string> = {
  hoverBackground: 'background-color',
  hoverColor: 'color',
}

/** Adds a hover value to a property without discarding its normal one. */
function withHover(current: StoredValue | undefined, value: string): StoredValue {
  const base = typeof current === 'string' ? { base: current } : { ...(current ?? {}) }
  return { ...base, hover: { base: value } }
}

type Block = Record<string, unknown> | null | undefined

/**
 * The class properties equivalent to a block's Creative overrides.
 *
 * Sanitising first is not belt and braces: it is where unknown props, unsafe
 * characters and the shadow preset list are enforced, and it is the same
 * function that decided what the runtime would render, so what comes out here
 * is exactly what was on screen.
 *
 * `base` is what the block's TOKEN slots migrated to, when both migrations run
 * on the same first edit. Layering here rather than merging afterwards is what
 * keeps the two honest about each other: a creative value overwrites the token
 * one because inline beat the token class on screen, and a hover value folds
 * INTO the token value rather than replacing it - a block with a token colour
 * and a creative hover colour must keep both.
 */
export function creativeToStyle(block: Block, base: Props = {}): Props {
  const bag = sanitizeCreativeStyle(
    block && typeof block === 'object' && !Array.isArray(block)
      ? (block as Record<string, unknown>)[CREATIVE_STYLE_PROP]
      : undefined,
  )

  const out: Props = { ...base }
  for (const [field, expand] of Object.entries(MAPPING)) {
    const value = bag[field]
    if (value) Object.assign(out, expand(value))
  }
  for (const [field, id] of Object.entries(HOVER)) {
    const value = bag[field]
    if (value) out[id] = withHover(out[id], value)
  }
  return out
}

/** Whether a block carries anything the migration would move. */
export function hasCreativeValues(block: Block): boolean {
  return Object.keys(creativeToStyle(block)).length > 0
}

/**
 * The block without its Creative bag - the second half of the migration.
 *
 * Returns the SAME object when there was nothing to strip, so a caller can
 * skip a save rather than writing an identical block back.
 */
export function withoutCreativeStyle<T extends Record<string, unknown>>(block: T): T {
  if (!(CREATIVE_STYLE_PROP in block)) return block
  const next = { ...block }
  delete next[CREATIVE_STYLE_PROP]
  return next
}
