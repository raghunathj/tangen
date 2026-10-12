/**
 * File Name: custom-css.ts
 * Purpose: Raw CSS per class - the one escape hatch left once Creative Mode
 *          retires, and the validation that keeps it inside its own rule.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A class's `custom` is a DECLARATION LIST, never a rule.
 *          Semicolons are fine - it is several declarations. A brace is not:
 *          that is the difference between styling this class and styling the
 *          whole document, and it is the only escape that would let one page
 *          restyle every other one.
 *
 *          The rules themselves live in the compiler (raw-css.ts), which the
 *          emitter reads as well, so the panel, the write path and the
 *          stylesheet cannot drift. This module keeps the names the
 *          extension already uses and the REASON the compiler gives: the
 *          emitter's refusal is silent, and three steps later an author
 *          reading CSS that does nothing blames their own declaration.
 *
 *          Browser-safe: the compiler's root export carries no node imports,
 *          and the server route and the admin bundle both need this.
 */

import { rawCssError, MAX_RAW_CSS } from '@tangen/studio-compiler'

/** The compiler's cap; a declaration list this long is a stylesheet. */
export const MAX_CUSTOM_CSS = MAX_RAW_CSS

/**
 * What the governance audit calls a raw-CSS edit. Creative Mode's audit named
 * the freeform CONTROL that changed; raw CSS has no controls, so it reports
 * under one name - the trail answers "who stepped outside the tokens, on
 * what", and that is still answered.
 */
export const RAW_CSS_OVERRIDE = 'custom'

/**
 * Why this raw CSS cannot be saved, or null when it can be.
 *
 * The rules are the compiler's own (`rawCssError` in @tangen/studio-compiler,
 * which the emitter reads too), so what this accepts is what the stylesheet
 * writes - by construction, not by a contract test. Blank is VALID and means
 * "no custom CSS": clearing the box is how the escape hatch gets undone.
 */
export function customCssError(raw: string): string | null {
  return rawCssError(raw)
}

/**
 * The value to store, or undefined for "none". Throws the reason when the
 * input cannot be stored, so a route refuses rather than saving something the
 * emitter would later drop without telling anyone.
 */
export function readCustomCss(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined
  const error = customCssError(raw as string)
  if (error) throw new Error(error)
  const value = String(raw).trim()
  return value === '' ? undefined : value
}
