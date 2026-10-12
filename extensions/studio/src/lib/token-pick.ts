/**
 * File Name: token-pick.ts
 * Purpose: Which tokens a style property may pick from, and what a picked
 *          value displays as.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Tokens are typed by family, so a picker exposes only
 *          compatible ones - a spacing slot can never be offered to a colour.
 *          Literals always stay available; a token is an option beside the
 *          literal control, never a replacement for it.
 *
 *          The registry's family names and the workspace token families are
 *          nearly the same vocabulary; `font` is the exception. It has no
 *          slot list in StudioTokens because font tokens are NAMED rather
 *          than scaled, so its slots are passed in from the same GET tokens
 *          response - see tokenSlotsFor.
 */
import { parseTokenRef, legacyVarToRef, formatTokenRef, type StyleProperty, type TokenRefFamily } from '@tangen/studio-schema'
import type { StudioTokens, TokenFamily } from '../tokens'

/** The workspace token family a registry family reads from, if any. */
const SLOT_FAMILY: Partial<Record<TokenRefFamily, TokenFamily>> = {
  space: 'space', radius: 'radius', width: 'width', type: 'type', palette: 'palette',
}

/**
 * The slots a property may reference, or null when it takes literals only.
 *
 * `fonts` is separate because the font family has no slot list in
 * StudioTokens - the workspace's font TOKENS are its slots, and they are
 * named rather than scaled. They come from the same GET tokens response
 * (`fonts`), and they are exactly the faces the stylesheet loads an
 * @font-face and a --tg-font-<name> for. Offering anything else would name a
 * face nothing downloaded.
 */
export function tokenSlotsFor(
  property: Pick<StyleProperty, 'tokenFamily'>,
  tokens: StudioTokens,
  fonts?: readonly string[],
): string[] | null {
  if (!property.tokenFamily) return null
  if (property.tokenFamily === 'font') {
    return fonts && fonts.length > 0 ? [...fonts] : null
  }
  const fam = SLOT_FAMILY[property.tokenFamily]
  if (!fam) return null
  const slots = tokens[fam]
  return Array.isArray(slots) && slots.length > 0 ? slots : null
}

/** The slot a stored value references, reading the canonical and the legacy form. */
export function pickedSlot(value: unknown): string | null {
  const ref = parseTokenRef(value) ?? legacyVarToRef(value)
  return ref ? ref.slot : null
}

/** The value to store for a picked slot - always the canonical reference. */
export function pickedValue(property: Pick<StyleProperty, 'tokenFamily'>, slot: string): string {
  return formatTokenRef(property.tokenFamily ?? 'space', slot)
}
