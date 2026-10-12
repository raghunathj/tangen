/**
 * File Name: client-ip.ts
 * Purpose: The one canonical answer to "who is calling" - resolving a caller
 *   address from forwarding headers ONLY when the operator has declared which
 *   proxies sit in front of the process, and from the socket otherwise.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure over a Request plus a config; no I/O, no Elysia.
 *
 *   Why this exists. Every place that needed a caller IP read
 *   `x-forwarded-for.split(',')[0]` - the LEFTMOST hop, which is the one value
 *   in the chain the client itself controls. A caller could therefore rotate a
 *   header and walk past the Porter redemption lockout and the form IP dedupe,
 *   and the ip_address stored on a submission was attacker-controlled data the
 *   admin displayed as fact.
 *
 *   The rule: with no trusted proxy configured, forwarding headers are not read
 *   AT ALL. Not read cautiously, not read as a fallback - ignored. A header
 *   nobody vouched for carries no information. With trusted proxies configured,
 *   the chain is walked from the RIGHT (the end the infrastructure appends to)
 *   past the hops we trust, and the first untrusted address is the caller.
 *
 *   `null` is a real answer and means "no trustworthy address". It is better
 *   than '0.0.0.0', which is a lie that collapses every caller into one bucket.
 *
 *   CIDR matching is exact for IPv4. IPv6 is matched by exact address and by
 *   the `loopback` shorthand only; a deployment fronted by an IPv6 proxy should
 *   list the proxy address literally. Stated rather than silently approximated.
 */
import type { TrustedProxyConfig, WorkspaceProject } from '@tangen/types'

const LOOPBACK_V4 = '127.0.0.0/8'
const PRIVATE_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']

/** Parses an IPv4 dotted quad to a 32-bit unsigned integer; null when not IPv4. */
function v4ToInt(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    n = n * 256 + octet
  }
  return n >>> 0
}

/** True when an IPv4 address falls inside a `a.b.c.d/bits` block. */
function inV4Cidr(address: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/')
  const bits = Number(bitsRaw)
  if (!base || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const a = v4ToInt(address)
  const b = v4ToInt(base)
  if (a === null || b === null) return false
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return ((a & mask) >>> 0) === ((b & mask) >>> 0)
}

/**
 * Is this address one of the hops the operator said to trust?
 * @param address - The candidate address, already trimmed.
 * @param trust - CIDRs, bare addresses, or the shorthands 'loopback' | 'private'.
 * @returns True when trusted. An empty list trusts nothing, which is the default.
 */
export function isTrustedAddress(address: string, trust: readonly string[] | undefined): boolean {
  if (!address || !trust || trust.length === 0) return false
  const bare = address.replace(/^\[|\]$/g, '')
  for (const entry of trust) {
    const rule = entry.trim()
    if (rule === '') continue
    if (rule === 'loopback') {
      if (bare === '::1' || inV4Cidr(bare, LOOPBACK_V4)) return true
      continue
    }
    if (rule === 'private') {
      if (PRIVATE_V4.some((c) => inV4Cidr(bare, c))) return true
      continue
    }
    if (rule.includes('/')) {
      if (inV4Cidr(bare, rule)) return true
      continue
    }
    if (rule === bare) return true
  }
  return false
}

type HeaderReader = { headers?: { get?: (name: string) => string | null } }

/** Reads one header off a Request or anything shaped like one. */
function header(request: HeaderReader | undefined, name: string): string | null {
  return request?.headers?.get?.(name) ?? null
}

/**
 * The caller's address, or null when none can be trusted.
 * @param request - The incoming request (only headers are read).
 * @param cfg - The operator's trusted-proxy declaration; absent means trust none.
 * @param socketAddress - The peer address the runtime reports, when available.
 * @returns An address string, or null when nothing trustworthy is known.
 */
export function clientIp(
  request: HeaderReader | undefined,
  cfg: TrustedProxyConfig | undefined,
  socketAddress?: string | null,
): string | null {
  const socket = socketAddress?.trim() || null
  // Fail safe: a header nobody vouched for carries no information.
  if (cfg?.enabled !== true) return socket

  const headerName = cfg.header ?? 'x-forwarded-for'
  const raw = header(request, headerName)
  const chain = (raw ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h !== '')
  if (chain.length === 0) return socket

  // An explicit hop count wins: some fronts append a hop that cannot be
  // expressed as a CIDR, and the operator counting them is the honest answer.
  if (typeof cfg.hops === 'number' && cfg.hops > 0) {
    const index = chain.length - 1 - cfg.hops
    return index >= 0 ? (chain[index] as string) : socket
  }

  // Walk from the RIGHT - the end the infrastructure appends to.
  for (let i = chain.length - 1; i >= 0; i--) {
    const candidate = chain[i] as string
    if (!isTrustedAddress(candidate, cfg.trust)) return candidate
  }
  // Every hop was a proxy we trust, so the socket peer is the closest thing
  // to a caller we have.
  return socket
}

/**
 * The peer address the runtime reports for this request, when it exposes one.
 * @param ctx - An Elysia context (its `server` carries Bun's requestIP).
 * @returns The socket peer address, or null.
 */
export function socketAddressOf(ctx: unknown): string | null {
  const c = ctx as { server?: { requestIP?: (r: unknown) => { address?: string } | null }; request?: unknown; rawRequest?: unknown }
  try {
    // The body cap (gateway/request-limits.ts) re-wraps the request to bound
    // its body and keeps the original as rawRequest; the server can only
    // look up the one it created.
    return c?.server?.requestIP?.(c.rawRequest ?? c.request)?.address ?? null
  } catch {
    return null
  }
}

// ── Deployment-scope holder ───────────────────────────────────────────────────
//
// trustedProxy is operator-owned: it describes the machine, not a tenant. It is
// resolved once at boot and read by call sites that have a Request but no
// config handle, following the setActiveBehaviorRegistry precedent in index.ts.

let _trustedProxy: TrustedProxyConfig | undefined

/** Sets the process-wide trusted-proxy declaration (called once from createServer). */
export function setTrustedProxy(cfg: TrustedProxyConfig | undefined): void {
  _trustedProxy = cfg
}

/** The process-wide trusted-proxy declaration; undefined means trust nothing. */
export function getTrustedProxy(): TrustedProxyConfig | undefined {
  return _trustedProxy
}

/**
 * Finds the operator's `server.trustedProxy` among the loaded projects.
 *
 * It is deliberately NOT a union across workspaces: who sits in front of the
 * process is one fact about one machine. The first declaration wins and a
 * conflicting second one is reported, because two tenants disagreeing about the
 * network topology means one of them is wrong.
 * @param projects - Loaded workspace projects.
 * @returns The declared config, or undefined when nothing declares one.
 */
export function resolveTrustedProxy(
  projects: readonly WorkspaceProject[] | undefined,
): TrustedProxyConfig | undefined {
  let found: TrustedProxyConfig | undefined
  let foundIn = ''
  for (const project of projects ?? []) {
    const cfg = (project.deploymentGateway as { trustedProxy?: TrustedProxyConfig } | undefined)?.trustedProxy
    if (!cfg) continue
    const where = project.workspaceId
    if (!found) {
      found = cfg
      foundIn = where
    } else if (JSON.stringify(found) !== JSON.stringify(cfg)) {
      console.warn(
        `[gateway] conflicting gateway.trustedProxy declarations (${foundIn} vs ${where}); ` +
        `using ${foundIn}. trustedProxy is a property of the deployment, not of a workspace.`,
      )
    }
  }
  return found
}
