import { currentDeploymentPolicy } from './deployment-role'
/**
 * File Name: refresh-cookie.ts
 * Purpose: Single source of truth for the refresh-token Set-Cookie string so
 *          the hardening attributes (HttpOnly, SameSite, Secure) can never
 *          drift between the login and workspace-switch endpoints.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Secure is applied when NODE_ENV is production/staging;
 *                     TANGEN_COOKIE_SECURE=true|false overrides in both directions
 *                     (e.g. false for production behind plain-HTTP internal LBs
 *                     that terminate TLS upstream without forwarding proto).
 */

function isSecureContext(): boolean {
  const override = process.env.TANGEN_COOKIE_SECURE
  if (override === 'true') return true
  if (override === 'false') return false
  return currentDeploymentPolicy().secureCookies
}

/**
 * Name of the admin refresh-token cookie. Browsers key cookies by host only,
 * NOT port, so two Tangen instances on localhost (say :3000 and :3010) would
 * otherwise share a single `refresh_token` and clobber each other's admin
 * session — logging into one silently swaps the other into that workspace.
 *
 * In development we namespace the cookie by the API port so local instances
 * coexist; production sites sit on distinct domains (separate cookie jars) and
 * keep the plain `refresh_token`. `TANGEN_COOKIE_NAME` overrides both — set it
 * per instance if you run several on one host outside development.
 */
export function refreshCookieName(): string {
  const explicit = process.env.TANGEN_COOKIE_NAME?.trim()
  if (explicit) return explicit
  const port = process.env.PORT?.trim()
  if (!currentDeploymentPolicy().productionLike && port) return `refresh_token_${port}`
  // Two deployed processes behind ONE host name (a staging and a production
  // deployment sharing a domain) would share this cookie; set
  // TANGEN_COOKIE_NAME per deployment in that arrangement.
  return 'refresh_token'
}

/**
 * Builds the refresh-token Set-Cookie header value.
 * @param token - Raw refresh token string.
 * @param ttlDays - Cookie lifetime in days.
 * @returns Set-Cookie header value with HttpOnly, Path, SameSite, Max-Age and
 *          (outside development) Secure attributes.
 */
export function buildRefreshCookie(token: string, ttlDays: number, opts: { crossSite?: boolean } = {}): string {
  // A split-domain Admin (its own origin, the API named in tangen:config)
  // needs the cookie on a cross-site request, which browsers grant only to
  // SameSite=None; Secure - so a split deployment is an HTTPS deployment.
  const sameSite = opts.crossSite ? 'None' : 'Lax'
  const base = `${refreshCookieName()}=${token}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${ttlDays * 86400}`
  return isSecureContext() || opts.crossSite ? `${base}; Secure` : base
}

/** Whether a request came from another site than the API itself (the Origin header names a different host). */
export function isCrossSiteRequest(headers: { get(name: string): string | null } | Record<string, string | undefined>): boolean {
  const get = (n: string) => typeof (headers as { get?: unknown }).get === 'function' ? (headers as { get(n: string): string | null }).get(n) : (headers as Record<string, string | undefined>)[n] ?? (headers as Record<string, string | undefined>)[n.toLowerCase()]
  const origin = get('origin')
  const host = get('host')
  if (!origin || !host) return false
  try { return new URL(origin).host !== host } catch { return false }
}

/**
 * Reads the refresh token from a raw Cookie header, matching the exact
 * (possibly port-namespaced) cookie name. Split-based, not regex, so a
 * configured TANGEN_COOKIE_NAME can never inject regex metacharacters.
 * @param cookieHeader - The raw `Cookie:` request header (may be empty).
 * @returns The token value, or undefined when the cookie is absent.
 */
export function readRefreshToken(cookieHeader: string): string | undefined {
  const prefix = `${refreshCookieName()}=`
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length)
  }
  return undefined
}
