/**
 * File Name: google-fonts.ts
 * Purpose: The webfonts Studio offers, and the stylesheet URL that loads the
 *          ones a page actually uses.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A CURATED list, not the whole Google catalogue. Sixteen
 *          hundred families is a search problem, not a design decision, and a
 *          picker nobody can scan is worse than a short list somebody can.
 *
 *          PRIVACY: these load from fonts.googleapis.com, which sends the
 *          visitor's IP to Google - a live GDPR question in the EU (a German
 *          court has ruled against it). Self-hosting is the safe answer and
 *          is deliberately NOT solved here; the list is built so a site can
 *          swap the loader later without every stored value changing.
 */

export type FontCategory = 'sans' | 'serif' | 'mono' | 'display'

export interface GoogleFont {
  name: string
  category: FontCategory
  /** Weights requested - asking for none delivers only the regular cut. */
  weights: readonly string[]
}

/** Generic families to fall back on, so a failed load keeps the same shape. */
const FALLBACK: Record<FontCategory, string> = {
  sans: 'system-ui, -apple-system, sans-serif',
  serif: 'Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, monospace',
  display: 'system-ui, sans-serif',
}

const W = ['300', '400', '500', '600', '700'] as const

/** Popular, well-drawn families across the four categories. */
export const GOOGLE_FONTS: readonly GoogleFont[] = [
  { name: 'Inter', category: 'sans', weights: W },
  { name: 'Roboto', category: 'sans', weights: W },
  { name: 'Open Sans', category: 'sans', weights: W },
  { name: 'Lato', category: 'sans', weights: ['300', '400', '700'] },
  { name: 'Montserrat', category: 'sans', weights: W },
  { name: 'Poppins', category: 'sans', weights: W },
  { name: 'Work Sans', category: 'sans', weights: W },
  { name: 'DM Sans', category: 'sans', weights: ['400', '500', '700'] },
  { name: 'Nunito', category: 'sans', weights: W },
  { name: 'Manrope', category: 'sans', weights: W },
  { name: 'Merriweather', category: 'serif', weights: ['300', '400', '700'] },
  { name: 'Playfair Display', category: 'serif', weights: ['400', '500', '600', '700'] },
  { name: 'Lora', category: 'serif', weights: ['400', '500', '600', '700'] },
  { name: 'Source Serif 4', category: 'serif', weights: W },
  { name: 'Libre Baskerville', category: 'serif', weights: ['400', '700'] },
  { name: 'JetBrains Mono', category: 'mono', weights: ['400', '500', '700'] },
  { name: 'IBM Plex Mono', category: 'mono', weights: ['400', '500', '600'] },
  { name: 'Space Mono', category: 'mono', weights: ['400', '700'] },
  { name: 'Bebas Neue', category: 'display', weights: ['400'] },
  { name: 'Oswald', category: 'display', weights: ['400', '500', '600', '700'] },
  { name: 'Abril Fatface', category: 'display', weights: ['400'] },
] as const

const BY_NAME = new Map(GOOGLE_FONTS.map((f) => [f.name, f]))

/** True when Studio offers this family (and can therefore load it). */
export function isGoogleFont(name: string): boolean {
  return BY_NAME.has(name)
}

/**
 * A full CSS font stack. The family is quoted - a multi-word family unquoted
 * is invalid CSS - and backed by a fallback of the SAME category, so a font
 * that fails to load does not reflow the page into a different design.
 */
export function fontStack(name: string): string {
  const family = String(name ?? '').trim()
  if (family === '') return ''
  const font = BY_NAME.get(family)
  return `"${family}", ${FALLBACK[font?.category ?? 'sans']}`
}

/**
 * One stylesheet request for every offered family used, or null when nothing
 * needs loading. Families Studio does not offer are dropped: this URL is
 * built from stored values, so it must never become a pass-through.
 */
export function googleFontsUrl(families: string[]): string | null {
  const wanted = [...new Set(families ?? [])]
    .map((f) => BY_NAME.get(String(f ?? '').trim()))
    .filter((f): f is GoogleFont => !!f)
    .sort((a, b) => a.name.localeCompare(b.name))

  if (wanted.length === 0) return null

  const params = wanted.map((f) => {
    const family = f.name.replace(/ /g, '+')
    return `family=${family}:wght@${f.weights.join(';')}`
  })
  return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`
}
