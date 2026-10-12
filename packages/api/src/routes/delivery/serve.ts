/**
 * File Name: serve.ts
 * Purpose: Serving published Studio artifacts - a PLATFORM route, so a
 *          published page never depends on Studio being installed.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Disabling or uninstalling Studio must never make an
 *          already-published page unavailable. That cannot be met by keeping
 *          data safe: extension routes come from the installed manifest, so a
 *          disabled extension has no routes at all and anything served
 *          through /api/v1/ext/studio/* is gone whether or not its rows
 *          survived.
 *
 *          So delivery lives here, in the platform, and Studio is involved
 *          only in AUTHORING. The provider is the same three-method contract
 *          the compiler publishes through, which is why this file neither
 *          knows nor cares whether the bytes came from a store, a directory
 *          or a bucket.
 *
 *          Versioned build paths are immutable by construction - a publish
 *          writes a new version rather than mutating one - so they are served
 *          with a cache lifetime a CDN can honour. Route pointers change on
 *          every publish and must be revalidated.
 */
import type { DeliveryProvider } from '@tangen/studio-compiler'

/** Where delivery is mounted. */
const MOUNT = '/api/v1/delivery/'

/** The only prefix delivery will read. */
const NAMESPACE = 'tangen/'

/** A year. Versioned artifacts never change, so this is safe and useful. */
const IMMUTABLE_MAX_AGE = 31_536_000

/**
 * The storage path a request refers to, or null when it is not a legitimate
 * delivery request.
 *
 * A delivery path becomes a storage key, so traversal is refused outright.
 * The namespace check matters just as much: the same store holds `class:`,
 * `preset:` and `tag:` rows, and delivery must never become a public reader
 * for all of them.
 */
export function deliveryPath(pathname: string): string | null {
  if (!pathname.startsWith(MOUNT)) return null
  const rest = decodeURIComponent(pathname.slice(MOUNT.length))
  if (rest.includes('..') || rest.startsWith('/')) return null
  return rest.startsWith(NAMESPACE) ? rest : null
}

/**
 * Whether this path can be cached forever.
 *
 * Only versioned build paths. A route pointer is the one mutable thing in the
 * whole design - it is what a publish moves - so caching it hard would pin
 * visitors to an old version.
 */
export function isImmutablePath(path: string): boolean {
  return path.startsWith(`${NAMESPACE}builds/`)
}

const CONTENT_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
}

/**
 * The content type for a delivery path, by extension.
 *
 * Lives here, in the one dependency-free file of the delivery layer, and the
 * stores import it: they record it beside the bytes, so a bucket with a CDN
 * in front and this route answer with identical headers.
 */
export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  const ext = dot === -1 ? '' : path.slice(dot + 1)
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

/** Serves one artifact. */
export async function deliveryResponse(
  provider: DeliveryProvider, path: string,
): Promise<Response> {
  const body = await provider.read(path)
  if (body === null) {
    // A visitor asking for something unpublished is a 404, never a 500.
    return new Response('Not found', { status: 404 })
  }

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentTypeFor(path),
      'Cache-Control': isImmutablePath(path)
        ? `public, max-age=${IMMUTABLE_MAX_AGE}, immutable`
        : 'public, max-age=0, must-revalidate',
      // CORS is deliberately NOT set here. The platform's shared cors layer
      // owns it, and hand-rolling `Allow-Origin: *` alongside that layer's
      // `Allow-Credentials: true` produces a combination the CORS spec
      // forbids - browsers reject the response outright, so a cross-origin
      // fetch of a published artifact would fail while curl looked fine.
      //
      // A site whose origin is not in the workspace's allow-list should
      // proxy delivery through its own server, which is the recommended
      // pattern anyway and keeps the workspace id out of page source.
    },
  })
}
