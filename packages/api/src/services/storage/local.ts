/**
 * File Name: local.ts
 * Purpose: The local-disk storage adapter — the default backend, preserving
 *          the platform's original behavior (MEDIA_DIR layout, traversal
 *          containment, Bun.file streaming).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The path-traversal guard lives INSIDE this adapter —
 *          object-store adapters treat keys as opaque strings, but on a
 *          filesystem a key like `../../etc/passwd` must never escape the
 *          base directory.
 */
import { rm } from 'node:fs/promises'
import { resolve, sep, join, dirname } from 'node:path'
import type { StorageAdapter, StorageStreamResult } from '@tangen/types'
import { DEFAULT_MEDIA_DIR } from '../../lib/media-dir'

/**
 * Resolves a key against the base dir, rejecting traversal escapes.
 * Returns null when the key escapes the base or targets the base itself.
 */
export function safeResolve(baseDir: string, key: string): string | null {
  const base = resolve(baseDir)
  const relative = key.replace(/^[/\\]+/, '')
  const resolved = resolve(base, relative)
  if (!resolved.startsWith(base + sep)) return null
  return resolved
}

/** Creates the local-disk adapter rooted at mediaDir (the resolved storage.mediaDir; default public/media). */
export function createLocalStorage(opts: { mediaDir?: string } = {}): StorageAdapter {
  const baseDir = resolve(opts.mediaDir ?? DEFAULT_MEDIA_DIR)

  const pathFor = (key: string): string => {
    const p = safeResolve(baseDir, key)
    if (!p) throw new Error(`storage(local): key escapes the media directory: "${key}"`)
    return p
  }

  return {
    name: 'local',

    async write(key, data) {
      const target = pathFor(key)
      const expected = (data as { byteLength?: number })?.byteLength
      // Bun.write creates parent dirs and returns the bytes written. Treat a
      // short write (disk full, permissions, path issue) as a hard failure so
      // the caller never records an asset whose file isn't really on disk.
      const written = await Bun.write(target, data)
      if (expected !== undefined && written !== expected) {
        throw new Error(`storage(local): wrote ${written}/${expected} bytes to "${key}"`)
      }
      if (!(await Bun.file(target).exists())) {
        throw new Error(`storage(local): file missing after write: "${key}"`)
      }
    },

    async read(key) {
      const file = Bun.file(pathFor(key))
      if (!(await file.exists())) return null
      return new Uint8Array(await file.arrayBuffer())
    },

    async stream(key): Promise<StorageStreamResult | null> {
      const file = Bun.file(pathFor(key))
      if (!(await file.exists())) return null
      return { body: file, size: file.size, contentType: file.type || undefined }
    },

    async exists(key) {
      return Bun.file(pathFor(key)).exists()
    },

    async delete(key) {
      await rm(pathFor(key), { force: true })
    },

    async deletePrefix(prefix) {
      // A prefix maps to a directory on disk (asset dirs end with '/')
      const dir = safeResolve(baseDir, prefix.replace(/\/+$/, ''))
      if (!dir) throw new Error(`storage(local): prefix escapes the media directory: "${prefix}"`)
      await rm(dir, { recursive: true, force: true })
    },

    publicUrl() {
      // Local files are served by the platform's own /media/* route — proxied.
      return null
    },
  }
}
