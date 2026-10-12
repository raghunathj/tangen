/**
 * File Name: style-validate.ts
 * Purpose: One answer to "will this value do anything" - the compiler refuses
 *          what fails here, and the Style panel explains it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A control that saves a value, puts it in the JSON, puts
 *          it in the CSS, and changes nothing a browser renders is worse than
 *          a control that is not there: the designer has no way to tell the
 *          difference between "this does nothing" and "I used it wrong".
 *          Invalid CSS is dropped SILENTLY by every browser, so the only
 *          place that failure can be caught is before it is emitted.
 *
 *          Two consumers on purpose. If only the compiler refused, the
 *          designer would still see the value stick in the panel and wonder;
 *          if only the panel refused, a value written by the API, an import
 *          or an older client would still reach the stylesheet. So the rule
 *          lives here once and both read it.
 *
 *          Enums are deliberately NOT checked. Their control is a select, so
 *          it cannot produce anything else, and a value the registry stopped
 *          offering (`display:contents`) is still valid CSS the compiler
 *          already knows how to split - refusing it would delete real work.
 */
import { parseTokenRef, legacyVarToRef } from './token-ref'
import type { StyleProperty } from './style-properties'

/** Lengths that are words rather than measurements. */
const LENGTH_KEYWORDS = new Set([
  'auto', 'none', 'inherit', 'initial', 'unset', 'revert',
  'fit-content', 'max-content', 'min-content', 'normal',
])

/** Keywords a numeric property may legitimately hold. */
const NUMBER_KEYWORDS = new Set(['auto', 'normal', 'inherit', 'initial', 'unset', 'revert'])

/** Every unit CSS knows that could appear in a stored value. */
const ANY_UNIT = '(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|fr|pt|cm|mm|in|pc|q|svh|dvh|lvh|svw|dvw|lvw)'
const MEASURE = new RegExp(`^-?(\\d+\\.?\\d*|\\.\\d+)${ANY_UNIT}?$`, 'i')
const FUNCTION = /^(var|calc|min|max|clamp|env)\(/i
const PLAIN_NUMBER = /^-?(\d+\.?\d*|\.\d+)$/

/**
 * The unit a value carries, or null when it has none - a unitless number, a
 * keyword or a function. Exported because the panel's unit picker needs the
 * same reading the guard uses.
 */
export function unitOf(value: string): string | null {
  const m = MEASURE.exec(String(value ?? '').trim())
  return m?.[2] ? m[2].toLowerCase() : null
}

/** True when a value can stand where CSS expects a length. */
export function isLengthValue(value: string | undefined): boolean {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (v === '') return false
  if (LENGTH_KEYWORDS.has(v.toLowerCase())) return true
  if (FUNCTION.test(v)) return true
  return MEASURE.test(v)
}

/** True when a value can stand where CSS expects a number. */
export function isNumberValue(value: string | undefined): boolean {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (v === '') return false
  if (NUMBER_KEYWORDS.has(v.toLowerCase())) return true
  if (FUNCTION.test(v)) return true
  // line-height is the reason a length passes here: `line-height: 24px` is
  // as legal as `line-height: 1.5`, and refusing it would delete real work.
  return PLAIN_NUMBER.test(v) || MEASURE.test(v)
}

/** The reference a value holds, canonical form or the legacy var string. */
function refOf(value: string) {
  return parseTokenRef(value) ?? legacyVarToRef(value)
}

/**
 * Why this value will not work on this property, or null when it will.
 *
 * The message is written for a designer looking at the control, not for a
 * log: it names what was expected, because "invalid" alone leaves someone
 * guessing at the same wrong value twice.
 */
export function styleValueError(property: StyleProperty, value: string | undefined): string | null {
  const v = String(value ?? '').trim()
  if (v === '') return null

  const ref = refOf(v)
  if (ref) {
    if (!property.tokenFamily) {
      return `${property.label} takes a plain value, not a token.`
    }
    if (ref.family !== property.tokenFamily) {
      return `That is a ${ref.family} token. ${property.label} takes ${property.tokenFamily} tokens.`
    }
    return null
  }

  // A property whose only workable values are tokens. Anything else compiles
  // to CSS that references something the stylesheet never defined.
  if (property.tokensOnly) {
    return property.hint ?? `${property.label} takes a design token, not a typed value.`
  }

  if (property.control === 'length') {
    if (!isLengthValue(v)) {
      return `${property.label} needs a length - a number with a unit, a keyword like auto, or calc().`
    }
    const unit = unitOf(v)
    if (unit && property.units && !property.units.includes(unit)) {
      return `${property.label} cannot use ${unit} - CSS ignores it here. Use ${property.units.join(', ')}.`
    }
    return null
  }

  if (property.control === 'number') {
    if (!isNumberValue(v)) {
      return `${property.label} needs a number.`
    }
    return null
  }

  if (property.pattern && !new RegExp(property.pattern, 'i').test(v)) {
    return property.hint ?? `${property.label} does not accept that value.`
  }

  return null
}

/** Whether a value would be dropped. The compiler's whole question. */
export function isEmittableValue(property: StyleProperty, value: string | undefined): boolean {
  return styleValueError(property, value) === null
}
