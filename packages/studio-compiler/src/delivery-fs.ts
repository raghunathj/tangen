/**
 * File Name: delivery-fs.ts
 * Purpose: The filesystem Delivery Provider - the default way published
 *          artifacts reach visitors.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: An open-source or self-hosted Tangen must publish and
 *          serve pages with nothing bought and nothing configured, so this is
 *          what ships enabled by default. Object storage and CDNs are
 *          adapters over the same three-method contract, never a requirement.
 *
 *          It writes into a directory a web server can serve directly, which
 *          is why path handling is strict: a route is author-supplied and
 *          becomes a path, so anything that would escape the delivery root is
 *          refused rather than normalised into something surprising.
 */
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { DeliveryProvider } from './delivery'

/**
 * Resolves a delivery path inside the root, refusing anything that escapes.
 *
 * Checked after resolution rather than by inspecting the string: `a/../../b`
 * looks harmless in pieces and only reveals itself once resolved.
 */
function within(root: string, path: string): string {
  const base = resolve(root)
  const full = resolve(base, path)
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error(`Delivery path "${path}" would write outside the delivery root`)
  }
  return full
}

/** Every file beneath a directory, as paths relative to the root. */
async function walk(base: string, dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // A prefix nothing has been written under yet is empty, not an error.
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...await walk(base, full))
    else out.push(full.slice(base.length + 1).split(sep).join('/'))
  }
  return out
}

/** A Delivery Provider backed by a directory on disk. */
export function fileDelivery(root: string): DeliveryProvider {
  return {
    async read(path) {
      const full = within(root, path)
      try {
        return await readFile(full, 'utf8')
      } catch {
        // Missing reads as null so an unpublished route is a 404 rather than
        // a server error.
        return null
      }
    },

    async write(path, body) {
      const full = within(root, path)
      // Parents are created rather than assumed: a nested route publishes on
      // a fresh install with no directory layout prepared in advance.
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, body, 'utf8')
    },

    async list(prefix) {
      const full = within(root, prefix)
      return walk(resolve(root), full)
        .then((files) => files.map((f) => f))
    },
  }
}
