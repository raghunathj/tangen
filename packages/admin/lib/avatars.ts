/**
 * File Name: avatars.ts
 * Purpose: Profile-avatar helpers — a palette of gradient SVG avatars (rendered
 *          with the member's initials, stored as tiny SVG data URIs) and an image
 *          uploader that crops+resizes to a small square JPEG data URI. Both end
 *          up in the `members.avatar` text column and render via a plain <img>.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** Curated gradient color pairs for the avatar picker. */
export const AVATAR_GRADIENTS: [string, string][] = [
  ['#667eea', '#764ba2'], ['#f093fb', '#f5576c'], ['#4facfe', '#00f2fe'],
  ['#43e97b', '#38f9d7'], ['#fa709a', '#fee140'], ['#30cfd0', '#330867'],
  ['#ff9a9e', '#fecfef'], ['#ffecd2', '#fcb69f'], ['#5ee7df', '#b490ca'],
  ['#f6d365', '#fda085'], ['#c471f5', '#fa71cd'], ['#48c6ef', '#6f86d6'],
]

/** Initials from a name, or the email's LOCAL part (before @) — up to two letters. */
export function avatarInitials(name: string | null | undefined, email: string): string {
  const source = (name && name.trim()) || (email || '').split('@')[0] || '?'
  const parts = source.split(/[\s._-]+/).filter(Boolean)
  const two = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
  return (two || source[0] || '?').toUpperCase()
}

/** An SVG gradient avatar (with initials) as a small data URI — renders via <img>. */
export function gradientAvatarUri(index: number, initials: string): string {
  const [a, b] = AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length]
  const text = initials.replace(/[<&>]/g, '')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
    `<rect width="128" height="128" fill="url(#g)"/>` +
    `<text x="64" y="68" font-family="system-ui,sans-serif" font-size="52" font-weight="600" fill="#fff" text-anchor="middle" dominant-baseline="central">${text}</text>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** True when a stored avatar is one of our generated gradient SVGs. */
/**
 * Flat avatar tones (decision of 2026-09-07: the gradients read as a toy next
 * to the calibrated UI). Hex because the SVG is a data URI, where tokens do
 * not reach; each pairs a muted ground with a readable foreground, and the
 * `className` is the same pair in tokens for the picker swatch.
 */
export const AVATAR_TONES: Array<{ bg: string; fg: string; className: string }> = [
  { bg: '#E0E7FF', fg: '#3730A3', className: 'bg-accent-muted text-accent-fg' },
  { bg: '#FDECC8', fg: '#8A5A00', className: 'bg-warning-muted text-warning-fg' },
  { bg: '#D1FAE5', fg: '#065F46', className: 'bg-success-muted text-success-fg' },
  { bg: '#DBEAFE', fg: '#1E40AF', className: 'bg-info-muted text-info-fg' },
  { bg: '#FCE7F3', fg: '#9D174D', className: 'bg-danger-muted text-danger-fg' },
  { bg: '#E5E7EB', fg: '#374151', className: 'bg-surface-selected text-fg' },
]

/** A flat, initials-on-a-tone avatar as an SVG data URI. */
export function toneAvatarUri(index: number, initials: string): string {
  const tone = AVATAR_TONES[((index % AVATAR_TONES.length) + AVATAR_TONES.length) % AVATAR_TONES.length]!
  const text = initials.replace(/[<&>]/g, '')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<rect width="128" height="128" fill="${tone.bg}"/>` +
    `<text x="64" y="68" font-family="system-ui,sans-serif" font-size="52" font-weight="600" fill="${tone.fg}" text-anchor="middle" dominant-baseline="central">${text}</text>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** True for any avatar the Admin generated itself (gradient or flat tone), as opposed to an upload or a URL. */
export function isGradientAvatar(avatar: string | null | undefined): boolean {
  return typeof avatar === 'string' && avatar.startsWith('data:image/svg+xml')
}

/**
 * Read an image File, cover-crop to a 128px square, and return a JPEG data URI —
 * small enough to store inline (no media/env coupling for a workspace-scoped
 * member). Rejects non-images.
 */
export function fileToAvatarDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file'))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const size = 128
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas unavailable')
        const scale = Math.max(size / img.width, size / img.height)
        const w = img.width * scale
        const h = img.height * scale
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      } catch (e) {
        reject(e as Error)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')) }
    img.src = url
  })
}
