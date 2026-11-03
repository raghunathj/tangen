/**
 * File Name: media-key.ts
 * Purpose: A media storage key is assembled from a workspace prefix and a
 *          leaf name, and some of those leaf names come from the UPLOADER.
 *          This is the guard that keeps the assembled key inside the prefix
 *          it was built from.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Security audit finding 20, found 2026-10-28, and the
 *          same root cause as finding 16 (Porter, closed 2026-10-23).
 *
 *          The chain, traced through source: an upload posts
 *          `variants` as a JSON field; `resolveVariants` keyed a map by
 *          `variant.name` and validated nothing; `ingestMediaBuffer` built
 *          `${workspaceId}/${assetId}/${variant.name}.${format}` and wrote
 *          there. The local storage adapter's `safeResolve` refuses to escape
 *          the media ROOT, which is why this was not a write to `/etc`, but it
 *          does not refuse to escape the WORKSPACE prefix - and a workspace is
 *          this platform's tenancy boundary. A variant named
 *          `../../wsp_other/med_x/original` therefore put uploader-chosen
 *          bytes into another workspace's media, under `media:write` alone.
 *
 *          WHY THE GUARD IS HERE AND NOT IN `safeResolve`. `safeResolve` is
 *          the local adapter's FILESYSTEM containment: it answers "does this
 *          key leave the media directory", which is a question only a
 *          filesystem has. The prefix rule is TENANCY, and it has to hold for
 *          an object-store adapter too, where keys are opaque strings and
 *          `../` is just three characters in a name that S3 will happily
 *          store. So the rule lives above the adapter, where every backend
 *          passes through it, and `safeResolve` keeps its own narrower job.
 *          That is the decision S4 asked for.
 *
 *          Refused, never rewritten - the same reasoning as Porter's
 *          `assertSafeMediaRef` and the content validator: reducing a
 *          traversing name to its basename stores the file under a name
 *          nobody asked for and leaves the request looking valid.
 */
import { RequestError } from './errors'

/** A leaf name inside an asset prefix: no separator, no traversal, no NUL, not empty. */
export function isSafeMediaLeaf(name: unknown): name is string {
  if (typeof name !== 'string' || name === '') return false
  if (name === '.' || name === '..') return false
  return !/[/\\\0]/.test(name)
}

/**
 * A variant NAME, which is stricter than a leaf: it is also a JSON key in the
 * asset's `variants` map, a segment of a public URL, and part of a filename
 * with an extension this code appends. So it is a plain token.
 */
export function isSafeVariantName(name: unknown): name is string {
  return typeof name === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)
}

/**
 * Builds a key under `prefix` and refuses anything that would leave it.
 *
 * Both halves are checked, not just the leaf: the prefix is built from a
 * workspace id and an asset id here, and a guard that trusts its own inputs is
 * how the same name gets checked on one path and trusted on another.
 */
export function mediaKey(prefix: string, leaf: string): string {
  if (!isSafeMediaLeaf(leaf)) {
    throw new RequestError('VALIDATION_ERROR', `media key "${leaf}" is not a plain filename`, 422)
  }
  const base = prefix.replace(/\/+$/, '')
  if (base === '' || base.includes('..') || base.includes('\0')) {
    throw new Error(`media key prefix is unusable: ${JSON.stringify(prefix)}`)
  }
  return `${base}/${leaf}`
}
