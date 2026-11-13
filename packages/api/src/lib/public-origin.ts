/**
 * File Name: public-origin.ts
 * Purpose: The one canonical answer to "what is this deployment's public
 *   address" for a handler that must build an absolute link back to itself:
 *   the configured `server.url` when there is one, and the request's own
 *   origin otherwise - derived from forwarding headers ONLY when the operator
 *   has declared which proxies sit in front of the process.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure over a Request plus a config; no I/O, no Elysia.
 *   The same rule as client-ip.ts, for the same reason: a header nobody
 *   vouched for carries no information. `X-Forwarded-Host` is read only
 *   behind a declared proxy, because a caller who can set it could otherwise
 *   make this deployment publish links to a host they control - the Share
 *   dialog, an embed script tag, a notification mail. That is host-header
 *   poisoning, and the only defence is not to believe the header.
 *
 *   Why it exists. `server.url` DEFAULTS to a localhost URL in development
 *   and to nothing at all in staging or production, so a deployment behind a
 *   proxy with no SERVER_URL set serves every page correctly and hands out
 *   `http://localhost` links - measured on a real deployment 2026-11-13,
 *   where the Forms share dialog published exactly that. The deployment is
 *   warned at boot now (deployment-validation.ts PUBLIC_URL_DEFAULTED), and
 *   this is what makes the fallback correct rather than merely present.
 */
import type { TrustedProxyConfig } from '@tangen/types'

type HeaderReader = { headers?: { get?: (name: string) => string | null }; url?: string }

const read = (request: HeaderReader | undefined, name: string): string | null =>
  request?.headers?.get?.(name)?.split(',')[0]?.trim() || null

/** A host is usable when it is a host: no scheme, no path, no spaces. */
function usableHost(host: string | null): string | null {
  if (!host) return null
  const trimmed = host.trim()
  if (trimmed === '' || /[\s/\\]/.test(trimmed) || trimmed.includes('://')) return null
  // A bracketed IPv6 literal, a name, or a name:port - nothing else.
  return /^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9._-]+)(:\d{1,5})?$/.test(trimmed) ? trimmed : null
}

/**
 * The origin a caller reached this deployment on, or null.
 *
 * @param request - The incoming request (headers and url are read).
 * @param cfg - The operator's trusted-proxy declaration; absent means trust none.
 */
export function requestPublicOrigin(
  request: HeaderReader | undefined,
  cfg: TrustedProxyConfig | undefined,
): string | null {
  const fromUrl = (() => {
    try { return request?.url ? new URL(request.url) : null } catch { return null }
  })()

  // Behind a DECLARED proxy the forwarded pair is the public address; the
  // socket-side URL is the private one the proxy dialled.
  if (cfg?.enabled === true) {
    const host = usableHost(read(request, 'x-forwarded-host'))
    if (host) {
      const proto = read(request, 'x-forwarded-proto')
      const scheme = proto === 'https' || proto === 'http' ? proto : (fromUrl?.protocol.replace(':', '') ?? 'https')
      return `${scheme}://${host}`
    }
  }

  // No declared proxy, or it forwarded no host: the Host header is the name
  // the caller used, and it is not a forwarding header - a direct caller sets
  // it as a matter of protocol. A proxy that rewrites it (Apache's
  // ProxyPreserveHost Off) leaves the private name here, which is why the
  // forwarded pair above is tried first.
  const host = usableHost(read(request, 'host'))
  if (host) {
    const proto = read(request, 'x-forwarded-proto')
    const trusted = cfg?.enabled === true && (proto === 'https' || proto === 'http')
    const scheme = trusted ? proto : (fromUrl?.protocol.replace(':', '') ?? 'http')
    return `${scheme}://${host}`
  }

  return fromUrl ? fromUrl.origin : null
}

/**
 * What a handler should use: the configured public URL, else the request's
 * own origin. Configuration wins because an operator who names an address
 * means it, and because a job with no request has nothing else.
 */
export function publicOriginFor(
  configured: string | null | undefined,
  request: HeaderReader | undefined,
  cfg: TrustedProxyConfig | undefined,
): string | null {
  const named = typeof configured === 'string' ? configured.trim().replace(/\/+$/, '') : ''
  if (named !== '') return named
  return requestPublicOrigin(request, cfg)
}
