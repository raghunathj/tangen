/**
 * File Name: creative.ts
 * Purpose: Creative (freeform) style overrides - turning a block's
 *          `styleCreative` bag into the CSS properties, custom properties
 *          and classes the wrapper emits.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The RUNTIME half of Studio's one deliberate relaxation
 *          of the token-only line; the authoring half (the field list, the
 *          panel) lives in @tangen/ext-studio, which this package cannot
 *          import (zero dependencies by contract) - so the allow-list is
 *          MIRRORED here, and it is the one that actually protects the page.
 *
 *          Values are editor-supplied and land in a style attribute, so the
 *          allow-list is conservative: a safe character set, a length cap,
 *          and no url()/expression()/javascript/comment syntax. Anything
 *          else is dropped per value - one bad override never takes the
 *          block with it. A block with no usable overrides produces NOTHING,
 *          so governed blocks render byte-identical to before this existed.
 */
import type { CSSProperties } from 'react'
import { fontStack } from '@tangen/studio'

const SHADOW_PRESETS = ['none', 'sm', 'md', 'lg']
const MAX_VALUE_CHARS = 64
const SAFE_VALUE = /^[a-zA-Z0-9\s.,()%#/+-]+$/
const FORBIDDEN = ['url(', 'expression', 'javascript', '/*', '*/', '\\']

/** Closed enums - never freeform, so they cannot smuggle a value through. */
const TEXT_ALIGNS = ['left', 'center', 'right', 'justify']
const TEXT_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize']

function oneOfValue(raw: unknown, allowed: string[]): string | null {
  return typeof raw === 'string' && allowed.includes(raw) ? raw : null
}

function safe(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (value === '' || value.length > MAX_VALUE_CHARS) return null
  if (!SAFE_VALUE.test(value)) return null
  const lower = value.toLowerCase()
  return FORBIDDEN.some((bad) => lower.includes(bad)) ? null : value
}

/** What one block's creative bag contributes to its wrapper. */
export type CreativeStyle = { style: CSSProperties; classes: string[] }

/**
 * The CSS for a block's creative overrides, layered ON TOP of the token
 * classes by the caller - creative wins per property because it is applied
 * to the same inline style object afterwards, and every property the author
 * did not override keeps its token value.
 */
export function creativeStyle(bag: unknown): CreativeStyle {
  const out: CreativeStyle = { style: {}, classes: [] }
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return out
  const b = bag as Record<string, unknown>

  const width = safe(b.width); if (width) out.style.width = width
  const maxWidth = safe(b.maxWidth); if (maxWidth) out.style.maxWidth = maxWidth
  const minHeight = safe(b.minHeight); if (minHeight) out.style.minHeight = minHeight
  const marginTop = safe(b.marginTop); if (marginTop) out.style.marginTop = marginTop
  const marginBottom = safe(b.marginBottom); if (marginBottom) out.style.marginBottom = marginBottom

  const paddingX = safe(b.paddingX)
  if (paddingX) { out.style.paddingLeft = paddingX; out.style.paddingRight = paddingX }
  const paddingY = safe(b.paddingY)
  if (paddingY) { out.style.paddingTop = paddingY; out.style.paddingBottom = paddingY }

  const borderWidth = safe(b.borderWidth)
  if (borderWidth) {
    out.style.borderWidth = borderWidth
    // Without a style a border never paints, and authors reach for width
    // first - implying `solid` is what they meant every time.
    out.style.borderStyle = 'solid'
  }
  // ── Typography ──────────────────────────────────────────────────────────
  // fontFamily stores a family NAME, never a CSS stack: the sanitiser rejects
  // quotes (rightly), and expanding here means the fallback always matches
  // the font's own category, so a failed webfont load does not reflow the
  // page into a different design.
  const fontFamily = safe(b.fontFamily); if (fontFamily) out.style.fontFamily = fontStack(fontFamily)
  const fontSize = safe(b.fontSize); if (fontSize) out.style.fontSize = fontSize
  const fontWeight = safe(b.fontWeight); if (fontWeight) out.style.fontWeight = fontWeight
  const lineHeight = safe(b.lineHeight); if (lineHeight) out.style.lineHeight = lineHeight
  const letterSpacing = safe(b.letterSpacing); if (letterSpacing) out.style.letterSpacing = letterSpacing
  const color = safe(b.color); if (color) out.style.color = color
  const textAlign = oneOfValue(b.textAlign, TEXT_ALIGNS); if (textAlign) out.style.textAlign = textAlign as never
  const textTransform = oneOfValue(b.textTransform, TEXT_TRANSFORMS)
  if (textTransform) out.style.textTransform = textTransform as never

  const borderColor = safe(b.borderColor); if (borderColor) out.style.borderColor = borderColor
  const borderRadius = safe(b.borderRadius); if (borderRadius) out.style.borderRadius = borderRadius

  if (typeof b.shadow === 'string' && SHADOW_PRESETS.includes(b.shadow) && b.shadow !== 'none') {
    out.classes.push(`tg-shadow-${b.shadow}`)
  }

  // Hover cannot be expressed inline, so it rides custom properties the
  // stylesheet's :hover rule consumes.
  const hoverBg = safe(b.hoverBackground)
  const hoverFg = safe(b.hoverColor)
  if (hoverBg) (out.style as Record<string, string>)['--tg-hover-bg'] = hoverBg
  if (hoverFg) (out.style as Record<string, string>)['--tg-hover-fg'] = hoverFg
  if (hoverBg || hoverFg) out.classes.push('tg-has-hover')

  return out
}
