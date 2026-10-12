/**
 * File Name: studio-delivery.ts
 * Purpose: Reading published Studio pages from the Tangen Delivery Layer.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is the production visitor path. It talks to
 *          /api/v1/delivery/* - a PLATFORM route - and never to the Studio
 *          extension, which is what makes a published page survive Studio
 *          being disabled or uninstalled.
 *
 *          Two different endpoints on purpose, and the difference is not
 *          arbitrary:
 *
 *          The SERVER resolves pages by calling the API directly. It is
 *          server to server, it crosses no origin, and the workspace id lives
 *          in a server-only env var where the browser cannot see it.
 *
 *          The BROWSER gets a same-origin PROXY path for the stylesheet,
 *          because a <link> in page source would otherwise have to spell the
 *          workspace and environment out in public HTML. They are public
 *          routing identifiers rather than credentials, so nothing breaks if
 *          they leak - but there is no reason to publish them, and the proxy
 *          also means no CORS allow-list to maintain.
 *
 *          Nothing here is Next-specific except where it is fetched from; the
 *          delivery client is framework-neutral.
 */
import { resolvePage, type DeliveredPage } from '@tangen/studio-runtime'

/** The API base, same value tangen.config uses for server.url. */
const API = (process.env.NEXT_PUBLIC_TANGEN_API_URL ?? '').replace(/\/+$/, '')

/** Public routing identifiers, kept server-side because they need not be public. */
const WORKSPACE = process.env.TANGEN_WORKSPACE_ID ?? ''
const ENVIRONMENT = process.env.TANGEN_ENV ?? ''

/** Where the browser reaches delivery: this site's own origin. */
export const DELIVERY_PROXY = '/api/studio-delivery/'

/** Whether this site is configured to read published pages at all. */
export function deliveryConfigured(): boolean {
  return !!API && !!WORKSPACE && !!ENVIRONMENT
}

/** What the site's proxy has to add to every upstream request. */
export function upstreamDelivery(path: string): string | null {
  if (!deliveryConfigured()) return null
  return `${API}/api/v1/delivery/${path}`
    + `?workspace=${encodeURIComponent(WORKSPACE)}&env=${encodeURIComponent(ENVIRONMENT)}`
}

/**
 * The published page for a route, or null when nothing is published there.
 *
 * Null rather than a throw: an unpublished path is a 404 this site renders,
 * and a delivery hiccup should cost the page its Studio content rather than
 * the whole request.
 */
export async function publishedPage(route: string): Promise<DeliveredPage | null> {
  if (!deliveryConfigured()) return null
  try {
    // `surfaces`: the shared header and footer resolve beside the page (two more
    // reads, under the reserved /_surfaces route) and <StudioPage/> renders them.
    return await resolvePage(API, { route, workspace: WORKSPACE, env: ENVIRONMENT }, { surfaces: true })
  } catch (err) {
    console.error(`[tangen] delivery lookup for "${route}" failed:`, (err as Error)?.message ?? err)
    return null
  }
}
