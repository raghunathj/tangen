/**
 * File Name: index.ts
 * Purpose: Astro adapter for the toolbar's SSR timings relay - a middleware
 *          that scopes SDK request collection per incoming request and
 *          injects the contract script tag into HTML responses, so the
 *          Tangen Toolbar's Requests tab shows server-side fetches on Astro
 *          sites (dev server and SSR mode).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Wire it up in src/middleware.ts:
 *            export { onRequest } from '@tangen/astro'
 *          (or compose via Astro's sequence()). No astro dependency needed -
 *          the middleware shape is a plain (context, next) function. Static
 *          builds render at build time, so there is nothing to relay there;
 *          the middleware only ever sees dev/SSR requests.
 */
import { collectSsrTimings, injectSsrTimings } from '@tangen/sdk/node'

type MiddlewareNext = () => Promise<Response>

/**
 * Astro middleware: collects the SDK requests this render makes and injects
 * the SSR timings tag before </body> of HTML responses. Non-HTML responses
 * and renders with no SDK traffic pass through untouched.
 */
export async function onRequest(_context: unknown, next: MiddlewareNext): Promise<Response> {
  const { result: res, entries } = await collectSsrTimings(next)
  if (entries.length === 0) return res
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) return res
  try {
    const html = await res.text()
    return new Response(injectSsrTimings(html, entries), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
  } catch {
    // Streamed/consumed bodies must never break the page over a dev tool.
    return res
  }
}
