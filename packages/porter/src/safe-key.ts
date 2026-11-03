/**
 * File Name: safe-key.ts
 * Purpose: A bundle names its own media files, and a bundle is UNTRUSTED
 *          input. These are the two guards that stop one of those names
 *          becoming a storage path somewhere it was never meant to reach.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Found in the second audit pass over Porter's import
 *          paths, 2026-10-23, which the 2026-10-12 audit named as one of the
 *          three areas it had given least attention.
 *
 *          The chain, traced through source: `media/index` in a bundle carries
 *          a `filename` and an `asset.id`; `porter-import.ts` built
 *          `${workspaceId}/${targetId}/${filename}` from it and wrote there.
 *          The local storage adapter's own `safePath` refuses to escape the
 *          media ROOT, which is why this is not a read of `/etc/passwd` - but
 *          it does not refuse to escape the WORKSPACE prefix, and a workspace
 *          is this platform's tenancy boundary. A `filename` of
 *          `../../<other-workspace>/<asset>/logo.png` therefore put
 *          bundle-chosen bytes into another workspace's media.
 *
 *          Refused, never rewritten. Quietly reducing a traversing name to its
 *          basename would import the file under a name nobody asked for and
 *          leave the bundle looking valid; the same reasoning as the content
 *          validator, which refuses a malformed document and names the node
 *          rather than reshaping it.
 */

/** A leaf filename: no separator, no traversal, no NUL, not empty. */
export function isSafeBundleFilename(name: unknown): name is string {
  if (typeof name !== 'string' || name === '') return false
  if (name === '.' || name === '..') return false
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false
  return true
}

/** An id that is safe to put in a storage path: the shape every Tangen id has. */
export function isSafeBundleId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(id) && !id.includes('..')
}

/**
 * The guard both the read side and the write side call, so a name can never be
 * checked on one path and trusted on the other.
 */
export function assertSafeMediaRef(assetId: unknown, filename: unknown): asserts filename is string {
  if (!isSafeBundleId(assetId)) {
    throw new Error(`bundle media entry has an unusable asset id: ${JSON.stringify(assetId)}`)
  }
  if (!isSafeBundleFilename(filename)) {
    throw new Error(
      `bundle media entry "${String(assetId)}" names a file that is not a plain filename: ${JSON.stringify(filename)}`,
    )
  }
}
