/**
 * File Name: style-hash.ts
 * Purpose: A short content hash for the stylesheet's ETag.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Deliberately dependency-free (no node:crypto) so the
 *          same function runs in the API, the admin and any runtime - an
 *          ETag computed differently in two places is a cache that never
 *          hits. This is a CACHE key, not a security primitive; collision
 *          resistance beyond "different CSS gives a different string" is not
 *          required.
 */

/**
 * FNV-1a over the string, base-36 encoded. Two rounds with different offsets
 * so ordering differences survive - the emitter guarantees stable order, and
 * the hash must notice when that order changes.
 */
export function styleHash(content: string): string {
  const text = String(content ?? '')
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(36)}${h2.toString(36)}`
}
