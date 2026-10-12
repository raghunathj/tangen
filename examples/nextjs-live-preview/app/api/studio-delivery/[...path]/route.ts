/**
 * File Name: route.ts
 * Purpose: Serves published Studio artifacts from this site's own origin.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A thin pass-through to the PLATFORM delivery route.
 *          It exists for the browser, not for the server: a <link> in page
 *          source would otherwise have to spell the workspace and environment
 *          out in public HTML. They are public routing identifiers rather
 *          than credentials, so nothing breaks if they leak - but there is no
 *          reason to publish them, and proxying keeps the request same-origin
 *          so there is no CORS allow-list to maintain either.
 *
 *          Upstream cache headers are passed straight through. That is the
 *          whole point of versioned artifacts: a build path is immutable and
 *          may be held forever, a route pointer must be revalidated, and a
 *          proxy that invented its own policy would throw both away.
 *
 *          No API key. These bytes are already on a published page, and
 *          requiring one would recreate the dependency delivery removes.
 */
import { upstreamDelivery } from '@/lib/studio-delivery'

/** An empty stylesheet: an unconfigured site renders unstyled, never broken. */
const EMPTY_CSS = new Response('', { status: 200, headers: { 'Content-Type': 'text/css; charset=utf-8' } })

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const joined = (path ?? []).join('/')

  // The path becomes a storage key upstream. Refusing traversal here as well
  // is cheap, and it means a hostile request never leaves this origin.
  if (!joined || joined.includes('..')) return new Response('Not found', { status: 404 })

  const upstream = upstreamDelivery(joined)
  if (!upstream) return EMPTY_CSS

  const res = await fetch(upstream, { cache: 'no-store' })
  if (!res.ok) {
    // A missing artifact must not break the page: an unstyled page is
    // readable, a 500 is not.
    return joined.endsWith('.css') ? EMPTY_CSS : new Response('Not found', { status: res.status })
  }

  return new Response(await res.text(), {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': res.headers.get('cache-control') ?? 'public, max-age=0, must-revalidate',
    },
  })
}
