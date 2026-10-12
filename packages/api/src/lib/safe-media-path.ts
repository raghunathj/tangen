/**
 * File Name: safe-media-path.ts
 * Purpose: Containment check for media file requests — resolves a requested
 *          path against the media base directory and rejects anything that
 *          escapes it (path traversal).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: node:path only. Uses resolved-prefix comparison rather
 *                     than regex stripping — the robust idiom for traversal guards.
 */
import { resolve, sep } from 'node:path'

/**
 * Resolves a requested media path and verifies it stays inside the base directory.
 * @param baseDir - The media root directory (MEDIA_DIR).
 * @param requestedPath - Raw path from the URL wildcard (already URL-decoded).
 * @returns The absolute file path when safely contained, or null when the
 *          request escapes the base directory or targets the base itself.
 */
export function resolveSafeMediaPath(baseDir: string, requestedPath: string): string | null {
  const base = resolve(baseDir)
  // Strip leading slashes so absolute-looking requests resolve inside the base
  const relative = requestedPath.replace(/^[/\\]+/, '')
  const resolved = resolve(base, relative)
  if (!resolved.startsWith(base + sep)) return null
  return resolved
}
