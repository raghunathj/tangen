/**
 * File Name: request-origin.ts
 * Purpose: The request's PUBLIC origin - scheme from X-Forwarded-Proto when a
 *   TLS-terminating proxy set it, host from the request (ProxyPreserveHost).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Behind Apache/nginx the API talks plain HTTP, so
 *   `new URL(request.url).origin` says `http://` even when the visitor is on
 *   HTTPS. Absolute URLs built from that (the form submitUrl, embed URLs) then
 *   die in the browser as mixed content. Only the SCHEME is taken from the
 *   header - the host still comes from the request, and only `https` is
 *   honored (an attacker-supplied header can never DOWNGRADE a real https
 *   request, and upgrading to https is at worst a redirect to the truth).
 */

/** Public origin for absolute URLs in responses. */
export function requestOrigin(request: { url: string; headers: { get(name: string): string | null } }): string {
  const url = new URL(request.url)
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (proto === 'https' && url.protocol === 'http:') {
    return `https://${url.host}`
  }
  return url.origin
}
