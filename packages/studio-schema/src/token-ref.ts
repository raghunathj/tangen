/**
 * File Name: token-ref.ts
 * Purpose: The canonical way a style value refers to a design token.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A token reference is stored as `{family.slot}` - the
 *          W3C design-token alias form. It is the SOURCE OF TRUTH; the
 *          compiler turns it into a CSS variable at emit time. Raw
 *          `var(--tg-...)` strings are no longer canonical: they were what
 *          the first token migration wrote, and a var string is CSS, not a
 *          reference - it cannot be validated against a family, renamed when
 *          a token is renamed, or offered back to a picker as the token it
 *          came from.
 *
 *          The alias form is never valid CSS, so a reference that somehow
 *          reaches a stylesheet unresolved is visibly broken rather than
 *          silently wrong. Legacy var strings are still accepted on read and
 *          canonicalised on the next write, so nothing already stored breaks.
 *
 *          Families are TYPED: a property declares which family it accepts,
 *          and a picker offers only those. Palette resolves per property,
 *          because the same slot means a background variable on a background
 *          and a foreground variable on text.
 */

/** The token families a style property may reference. */
export const TOKEN_REF_FAMILIES = ['space', 'radius', 'width', 'type', 'palette', 'font'] as const
export type TokenRefFamily = (typeof TOKEN_REF_FAMILIES)[number]

export interface TokenRef {
  family: TokenRefFamily
  slot: string
}

/** A slot name safe inside a CSS custom-property name. */
const SAFE_SLOT = /^[A-Za-z0-9_-]+$/

const REF = /^\{([a-z]+)\.([A-Za-z0-9_-]+)\}$/
const LEGACY = /^var\(--tg-(bg|fg|space|text|radius|width|font)-([A-Za-z0-9_-]+)\)$/

/** `{space.lg}` */
export function formatTokenRef(family: TokenRefFamily, slot: string): string {
  return `{${family}.${slot}}`
}

/** The reference a stored value holds, or null for a literal. */
export function parseTokenRef(value: unknown): TokenRef | null {
  if (typeof value !== 'string') return null
  const m = REF.exec(value.trim())
  if (!m) return null
  const family = TOKEN_REF_FAMILIES.find((f) => f === m[1])
  if (!family || !SAFE_SLOT.test(m[2])) return null
  return { family, slot: m[2] }
}

export function isTokenRef(value: unknown): boolean {
  return parseTokenRef(value) !== null
}

/**
 * A legacy `var(--tg-...)` string read back as a reference, or null.
 *
 * The bg/fg prefixes both map to the palette family; which one to emit is
 * decided again from the property at compile time, so nothing is lost.
 */
export function legacyVarToRef(value: unknown): TokenRef | null {
  if (typeof value !== 'string') return null
  const m = LEGACY.exec(value.trim())
  if (!m) return null
  const prefix = m[1]
  const family: TokenRefFamily = prefix === 'bg' || prefix === 'fg' ? 'palette'
    : prefix === 'text' ? 'type'
    : (prefix as TokenRefFamily)
  return { family, slot: m[2] }
}

/** The canonical form of a value: legacy var strings become refs, all else is untouched. */
export function canonicalizeTokenValue(value: string): string {
  const legacy = legacyVarToRef(value)
  return legacy ? formatTokenRef(legacy.family, legacy.slot) : value
}

/**
 * The CSS variable a reference compiles to, for a given property.
 *
 * Palette is the one family whose variable depends on WHAT is being
 * coloured: a background reads the bg variable, text reads fg. Everything
 * else maps one family to one prefix.
 */
export function tokenRefToVar(ref: TokenRef, propertyId: string): string {
  const prefix = ref.family === 'palette'
    ? (propertyId === 'color' ? 'fg' : 'bg')
    : ref.family === 'type' ? 'text'
    : ref.family
  return `var(--tg-${prefix}-${ref.slot})`
}
