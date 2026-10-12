/**
 * File Name: route.ts
 * Purpose: Serves the published workspace stylesheet from this site's own
 *          origin, read from the Delivery Layer.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This used to fetch /api/v1/ext/studio/styles with the
 *          site's API key, which put the AUTHORING API in the visitor path -
 *          every page view asked an extension route for its CSS, and a
 *          disabled Studio would have taken the styling down with it.
 *
 *          It now resolves the stylesheet's route pointer through the
 *          PLATFORM delivery route and returns the versioned artifact it
 *          names. Same URL for the page, same soft failure, no extension and
 *          no key involved.
 *
 *          Two upstream requests, because that is what versioning buys: the
 *          pointer is revalidated (a publish moves it) and the artifact it
 *          names is immutable. The version doubles as the ETag, so an
 *          unchanged stylesheet still costs the browser nothing.
 *
 *          A site that wanted one request could link the versioned URL
 *          directly - which is exactly what <StudioPage/> does for a
 *          delivered page. This route exists for the surfaces that render
 *          Studio blocks WITHOUT a page artifact behind them, like the live
 *          preview.
 */
import { upstreamDelivery, deliveryConfigured } from '@/lib/studio-delivery'

/** The route the workspace stylesheet publishes under. */
const STYLES_POINTER = 'tangen/routes/_styles.json'

/** An unconfigured site renders unstyled rather than erroring. */
const EMPTY = () => new Response('', {
  status: 200,
  headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' },
})

export async function GET(request: Request) {
  if (!deliveryConfigured()) return EMPTY()

  try {
    const pointer = await fetch(upstreamDelivery(STYLES_POINTER)!, { cache: 'no-store' })
    if (!pointer.ok) return EMPTY()
    const version = (JSON.parse(await pointer.text()) as { version?: unknown }).version
    if (typeof version !== 'string') return EMPTY()

    // The version identifies the content, so it is the honest ETag - and a
    // matching one means the browser already holds this exact stylesheet.
    const etag = `"${version}"`
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } })
    }

    const css = await fetch(upstreamDelivery(`tangen/builds/${version}/page.css`)!, { cache: 'no-store' })
    if (!css.ok) return EMPTY()

    return new Response(await css.text(), {
      status: 200,
      headers: {
        'Content-Type': 'text/css; charset=utf-8',
        ETag: etag,
        // Revalidate every time, but transfer nothing when unchanged. A long
        // max-age would strand a published change behind a cache for a day,
        // which is exactly the "no rebuild" promise broken.
        'Cache-Control': 'public, max-age=0, must-revalidate',
      },
    })
  } catch (err) {
    console.error('[tangen] published stylesheet lookup failed:', (err as Error)?.message ?? err)
    return EMPTY()
  }
}
