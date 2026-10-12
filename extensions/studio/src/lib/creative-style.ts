/**
 * File Name: creative-style.ts
 * Purpose: The RETIRED Creative (freeform) prop bag - kept for reading the
 *          values blocks already carry, and for the audit that names them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: W-3 retired Creative Mode: it was Studio's THIRD
 *          styling system, and three systems colliding on padding, colour and
 *          radius is what made per-property provenance necessary at all. No
 *          panel writes this bag any more. It is still READ, in two places:
 *          `creative-migration.ts` turns a block's stored values into class
 *          properties on that block's first style edit, and server.ts uses
 *          the field list to name overrides in the governance audit.
 *
 *          The same shape is mirrored in studio-react's `creativeStyle`,
 *          which still renders it. That has to stay until migration is
 *          lazy no longer: a block nobody has styled since W-3 must keep
 *          looking exactly as it did.
 *
 *          Values are EDITOR-SUPPLIED and therefore untrusted: they were
 *          emitted as CSS, so the sanitiser allow-lists a conservative
 *          character set and rejects anything that could escape its own
 *          declaration (`;`, `{}`), fetch a resource (`url()`), or execute
 *          (`expression()`, `javascript:`). Rejection is per value: one bad
 *          override never takes the rest of the block with it. It is still
 *          the gate the migration reads through, so it stays exactly as
 *          strict as it was. Governance lives in governance.ts; the raw CSS
 *          that replaced this bag lives in custom-css.ts.
 */

/** The single reserved prop the whole creative bag lives under. */
export const CREATIVE_STYLE_PROP = 'styleCreative'

interface CreativeField {
  name: string
  label: string
  fieldType: string
  placeholder?: string
  config?: { options?: Array<{ label: string; value: string }> }
}

/** Shadow is a closed preset list - never a freeform CSS shadow value. */
const SHADOW_PRESETS = ['none', 'sm', 'md', 'lg']

/**
 * The freeform controls that used to be offered, in the order the panel drew
 * them. No longer rendered - this is the vocabulary the migration maps from
 * and the audit reports on.
 */
export const CREATIVE_STYLE_FIELDS: CreativeField[] = [
  { name: 'width', label: 'Width', fieldType: 'length', placeholder: 'e.g. 50%, 320px' },
  { name: 'maxWidth', label: 'Max width', fieldType: 'length', placeholder: 'e.g. 40rem' },
  { name: 'minHeight', label: 'Min height', fieldType: 'length', placeholder: 'e.g. 60vh' },
  { name: 'marginTop', label: 'Margin top', fieldType: 'length', placeholder: 'e.g. 2rem' },
  { name: 'marginBottom', label: 'Margin bottom', fieldType: 'length', placeholder: 'e.g. 2rem' },
  { name: 'paddingX', label: 'Padding left/right', fieldType: 'length', placeholder: 'e.g. 1.5rem' },
  { name: 'paddingY', label: 'Padding top/bottom', fieldType: 'length', placeholder: 'e.g. 1.5rem' },
  // Typography. `fontFamily` stores a family NAME - the runtime expands it to
  // a stack with a category-matched fallback (see fontStack).
  { name: 'fontFamily', label: 'Font', fieldType: 'font' },
  { name: 'fontSize', label: 'Font size', fieldType: 'length', placeholder: 'e.g. 18px' },
  { name: 'fontWeight', label: 'Weight', fieldType: 'select', config: { options: ['300', '400', '500', '600', '700', '800'].map((v) => ({ label: v, value: v })) } },
  { name: 'lineHeight', label: 'Line height', fieldType: 'text', placeholder: 'e.g. 1.5' },
  { name: 'letterSpacing', label: 'Letter spacing', fieldType: 'length', placeholder: 'e.g. 0.02em' },
  { name: 'textAlign', label: 'Align', fieldType: 'select', config: { options: ['left', 'center', 'right', 'justify'].map((v) => ({ label: v, value: v })) } },
  { name: 'textTransform', label: 'Transform', fieldType: 'select', config: { options: ['none', 'uppercase', 'lowercase', 'capitalize'].map((v) => ({ label: v, value: v })) } },
  { name: 'color', label: 'Text colour', fieldType: 'color' },
  { name: 'borderWidth', label: 'Border width', fieldType: 'length', placeholder: 'e.g. 1px' },
  { name: 'borderColor', label: 'Border colour', fieldType: 'color' },
  { name: 'borderRadius', label: 'Corner radius', fieldType: 'length', placeholder: 'e.g. 12px' },
  { name: 'shadow', label: 'Shadow', fieldType: 'select', config: { options: SHADOW_PRESETS.map((v) => ({ label: v, value: v })) } },
  { name: 'hoverBackground', label: 'Hover background', fieldType: 'color' },
  { name: 'hoverColor', label: 'Hover text colour', fieldType: 'color' },
]

const FIELD_NAMES = new Set(CREATIVE_STYLE_FIELDS.map((f) => f.name))

/** Longest value we will emit - real CSS lengths and colors are short. */
const MAX_VALUE_CHARS = 64

/**
 * Characters a length, color, or keyword legitimately needs. Everything
 * else - semicolons, braces, quotes, angle brackets, backslashes - is
 * refused, which is what keeps a stored value inside its own declaration.
 */
const SAFE_VALUE = /^[a-zA-Z0-9\s.,()%#/+-]+$/

/** Substrings that are never legitimate here even within the safe charset. */
const FORBIDDEN = ['url(', 'expression', 'javascript', '/*', '*/', '\\']

function isSafeValue(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const value = raw.trim()
  if (value === '' || value.length > MAX_VALUE_CHARS) return false
  if (!SAFE_VALUE.test(value)) return false
  const lower = value.toLowerCase()
  return !FORBIDDEN.some((bad) => lower.includes(bad))
}

/**
 * The safe subset of a stored creative bag. Unknown props are dropped
 * (only declared controls exist), `shadow` is constrained to its presets,
 * and every other value must pass the allow-list. Always returns an object.
 */
export function sanitizeCreativeStyle(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!FIELD_NAMES.has(key)) continue
    if (key === 'shadow') {
      if (typeof value === 'string' && SHADOW_PRESETS.includes(value)) out[key] = value
      continue
    }
    if (isSafeValue(value)) out[key] = value.trim()
  }
  return out
}
