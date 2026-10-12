/**
 * File Name: raw-css.ts
 * Purpose: The ONE sanitiser for raw CSS a designer types - a class's custom
 *          CSS, a section's, a page's - and the reason it gives when it
 *          refuses.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Raw CSS is a DECLARATION LIST, never a rule. Semicolons
 *          are fine - it is several declarations. A brace is not: that is the
 *          difference between styling this element and styling the whole
 *          document, and it is the only escape that would let one page
 *          restyle every other one. `@import` is refused because a stylesheet
 *          that fetches is an exfiltration channel and a performance surprise;
 *          `expression(` and `javascript:` because they execute.
 *
 *          The rules used to live twice - silently in the emitter's
 *          `safeCustom`, and with reasons in the extension's custom-css.ts,
 *          held together by a contract test. Section and page CSS would have
 *          made it four places. Now the emitter, the write path and every
 *          panel read this module, and a sample that passes here is a sample
 *          the emitter writes, by construction rather than by test.
 *
 *          Dependency-free and browser-safe: the root export of this package
 *          is bundled into the admin.
 */

/** Beyond this a declaration list is a stylesheet, not a tweak. */
export const MAX_RAW_CSS = 2000

/** Sequences that are never a declaration, whatever they are wrapped in. */
export const RAW_CSS_FORBIDDEN: ReadonlyArray<readonly [needle: string, reason: string]> = Object.freeze([
  ['@import', '@import pulls in a stylesheet from anywhere - not allowed here'],
  ['@charset', '@charset is a document rule, not a declaration'],
  ['expression(', 'expression() executes script'],
  ['javascript:', 'javascript: urls execute script'],
  ['</', '"</" would break out of the style element'],
] as const)

/**
 * Why this raw CSS cannot be used, or null when it can be.
 *
 * Blank is VALID and means "no custom CSS": clearing the box is how the
 * escape hatch gets undone, so refusing it would trap the author inside it.
 */
export function rawCssError(raw: unknown): string | null {
  if (typeof raw !== 'string') return 'Custom CSS must be text'
  const value = raw.trim()
  if (value === '') return null
  if (value.length > MAX_RAW_CSS) {
    return `Custom CSS is limited to ${MAX_RAW_CSS} characters`
  }
  // Braces first: it is the one that matters, so it gets the specific reason
  // rather than being lumped in with the rest.
  if (/[{}]/.test(value)) {
    return 'Braces are not allowed - this is a list of declarations, not a rule'
  }
  if (/[<>]/.test(value)) return 'Angle brackets are not allowed in CSS'
  const lower = value.toLowerCase()
  for (const [needle, reason] of RAW_CSS_FORBIDDEN) {
    if (lower.includes(needle)) return reason
  }
  return null
}

/**
 * The raw CSS as the emitter writes it, or null when it must not be written:
 * trimmed, trailing semicolons dropped (the emitter joins declarations
 * itself), and refused by the same rules that give the reason above.
 */
export function safeRawCss(raw: unknown): string | null {
  if (rawCssError(raw) !== null) return null
  const value = (raw as string).trim().replace(/;+$/, '')
  return value === '' ? null : value
}

/**
 * A declaration list split into declarations, respecting parentheses and
 * quotes: `url(data:image/png;base64,...)` is one declaration, not two.
 */
export function splitDeclarations(raw: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (const ch of raw) {
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue }
    if (ch === '(') depth++
    else if (ch === ')' && depth > 0) depth--
    if (ch === ';' && depth === 0) {
      const d = current.trim()
      if (d) out.push(d)
      current = ''
      continue
    }
    current += ch
  }
  const last = current.trim()
  if (last) out.push(last)
  return out
}
