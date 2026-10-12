/**
 * File Name: extension-http.ts
 * Purpose: The outbound HTTP facility an extension is handed as `ctx.http`
 *          and the narrowed secret accessor (Extension Kernel K1.4,
 *          tasks/plan-extension-kernel.md). For an extension whose manifest
 *          declares `grants`, `ctx.http` reaches only the hosts its
 *          `network:<host>` grants name (`network:*.suffix` for subdomains,
 *          `network:any` for everything - privileged), refuses a target that
 *          resolves to a private, loopback or link-local address unless
 *          `network:private` is held (DNS rebinding and intranet reach are
 *          the SSRF classes this closes), follows redirects itself so every
 *          hop is re-checked, and audits every call - host, method, status,
 *          duration, outcome - never the URL's query or the body. An
 *          extension without `grants` keeps today's reach, audited.
 *          `narrowSecrets` limits a grants-declaring extension's
 *          `ctx.secrets` to its own names plus `secrets:<name>` grants.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure except for the defaults: `fetch`, `dns.lookup`
 *          and the telemetry bus, each injectable. The window between the
 *          lookup and the connection is not closed (Bun's fetch cannot pin
 *          an address with SNI intact); the check refuses what resolves
 *          private NOW, which is the rebinding defence that is possible here.
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { NO_LOG } from '@tangen/types'
import { getLogger } from '@tangen/logging'
import { emitTelemetry } from '../telemetry/bus'

const log = () => getLogger(['tangen', 'api', 'ext-http'])

export type ExtensionHttpRefusal = 'scheme' | 'host_not_granted' | 'private_address' | 'unresolvable' | 'too_many_redirects'

export interface ExtensionHttpAudit {
  extensionId: string
  workspaceId: string
  method: string
  /** The target's host (with port when given). Never the path's query or the body. */
  host: string
  status: number | null
  result: 'ok' | 'refused' | 'failed'
  reason?: ExtensionHttpRefusal
  redirects: number
  durationMs: number
}

export interface ExtensionHttpDeps {
  extensionId: string
  workspaceId: string
  /** The extension's effective grants (E.14: never null; a grantless manifest holds nothing). */
  grants: readonly string[]
  fetchImpl?: typeof fetch
  /** Resolves a hostname to its addresses. */
  lookup?: (host: string) => Promise<string[]>
  audit?: (entry: ExtensionHttpAudit) => void
  maxRedirects?: number
  /** Applied when the caller passes no signal. */
  timeoutMs?: number
}

/** The call `ctx.http` is: fetch's shape, the extension's reach. */
export type ExtensionHttp = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export class ExtensionHttpRefused extends Error {
  readonly code = 'NETWORK_REFUSED'
  constructor(message: string, readonly reason: ExtensionHttpRefusal, readonly host: string) {
    super(message)
    this.name = 'ExtensionHttpRefused'
  }
}

/** Loopback, RFC1918, link-local, CGNAT, unspecified, and the v6 equivalents (mapped v4 included). */
export function isPrivateAddress(address: string): boolean {
  const a = address.trim().replace(/^\[|\]$/g, '').toLowerCase()
  const v4 = (ip: string): boolean => {
    const p = ip.split('.').map(Number)
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
    const [a1, a2, a3] = p as [number, number, number, number]
    return a1 === 0 || a1 === 10 || a1 === 127
      || (a1 === 172 && a2 >= 16 && a2 <= 31)
      || (a1 === 192 && a2 === 168)
      || (a1 === 169 && a2 === 254)
      || (a1 === 100 && a2 >= 64 && a2 <= 127)
      // IETF protocol assignments, 192.0.0.0/24.
      || (a1 === 192 && a2 === 0 && a3 === 0)
      // Benchmarking, 198.18.0.0/15.
      || (a1 === 198 && (a2 === 18 || a2 === 19))
      // Multicast (224/4) and reserved (240/4), which includes the broadcast
      // address. Nothing an extension should be asked to fetch.
      || a1 >= 224
  }
  if (isIP(a) === 4) return v4(a)
  if (isIP(a) !== 6) return false
  if (a === '::' || a === '::1') return true
  // An IPv4-mapped address has TWO spellings and the parser picks the second:
  // `new URL('http://[::ffff:169.254.169.254]/').hostname` is
  // `[::ffff:a9fe:a9fe]`. Checking only the dotted one saw the form a person
  // types and missed the form it arrives in, so the metadata address read as
  // public. Normalise both to dotted quad before deciding.
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (dotted) return v4(dotted[1]!)
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a)
  if (hex) {
    const hi = parseInt(hex[1]!, 16)
    const lo = parseInt(hex[2]!, 16)
    return v4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`)
  }
  // NAT64, 64:ff9b::/96 - the low 32 bits are an embedded IPv4 address, so a
  // translating resolver reaches it.
  if (a.startsWith('64:ff9b:')) return true
  const first = parseInt(a.split(':')[0] || '0', 16)
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80
}

const networkGrants = (grants: readonly string[]) =>
  grants.filter((g) => g.startsWith('network:')).map((g) => g.slice('network:'.length).trim().toLowerCase()).filter(Boolean)

/** Whether a URL's host is named by the grants: exact, `*.suffix` (subdomains only), with a port when the grant carries one, or `any`. */
export function hostAllowedBy(url: URL, grants: readonly string[]): boolean {
  const patterns = networkGrants(grants)
  if (patterns.includes('any')) return true
  const hostname = url.hostname.toLowerCase()
  const hostWithPort = url.host.toLowerCase()
  return patterns.some((p) => {
    if (p === 'private') return false
    if (p.startsWith('*.')) return hostname.endsWith(p.slice(1)) && hostname !== p.slice(2)
    return p.includes(':') ? p === hostWithPort : p === hostname
  })
}

function defaultAudit(entry: ExtensionHttpAudit): void {
  emitTelemetry({
    name: 'extension.http.completed',
    severity: entry.result === 'ok' ? 'info' : 'warn',
    status: entry.result === 'ok' ? 'ok' : 'failed',
    workspaceId: entry.workspaceId,
    durationMs: entry.durationMs,
    attributes: {
      extensionId: entry.extensionId, host: entry.host, method: entry.method,
      status: entry.status ?? 0, result: entry.result, ...(entry.reason ? { errorCode: entry.reason } : {}),
    },
  })
  if (entry.result !== 'ok') log().warn(`extension '${entry.extensionId}' http ${entry.method} ${entry.host}: ${entry.result}${entry.reason ? ` (${entry.reason})` : ''}`)
}

const defaultLookup = async (host: string): Promise<string[]> => (await dnsLookup(host, { all: true })).map((r) => r.address)

/** The one constructor; `buildExtensionCtx` hands its result to the extension as `ctx.http`. */
export function createExtensionHttp(deps: ExtensionHttpDeps): ExtensionHttp {
  const fetchImpl = deps.fetchImpl ?? fetch
  const lookup = deps.lookup ?? defaultLookup
  const audit = deps.audit ?? defaultAudit
  const maxRedirects = deps.maxRedirects ?? 5
  const timeoutMs = deps.timeoutMs ?? 30_000
  const grants = deps.grants
  const privateAllowed = networkGrants(grants).includes('private')

  /** Refuses, or returns nothing: the host is granted and resolves public (or private is allowed). */
  const check = async (url: URL): Promise<ExtensionHttpRefusal | null> => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'scheme'
    if (!hostAllowedBy(url, grants)) return 'host_not_granted'
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    let addresses: string[]
    if (isIP(hostname)) addresses = [hostname]
    else {
      try { addresses = await lookup(hostname) } catch { return 'unresolvable' }
      if (addresses.length === 0) return 'unresolvable'
    }
    if (!privateAllowed && addresses.some(isPrivateAddress)) return 'private_address'
    return null
  }

  const refusal = (reason: ExtensionHttpRefusal, url: URL): ExtensionHttpRefused => {
    const host = url.host || url.href
    const message = reason === 'scheme' ? `Extension '${deps.extensionId}' may only call http(s) URLs, not ${url.protocol}`
      : reason === 'host_not_granted' ? `Extension '${deps.extensionId}' is not granted network access to ${host}: declare network:${host} in its manifest grants`
      : reason === 'private_address' ? `Extension '${deps.extensionId}' may not reach ${host}: it resolves to a private address - missing network:private grant`
      : reason === 'unresolvable' ? `Extension '${deps.extensionId}' cannot resolve ${host}`
      : `Extension '${deps.extensionId}' followed too many redirects from ${host}`
    return new ExtensionHttpRefused(message, reason, host)
  }

  return async (input, init) => {
    const started = performance.now()
    const first = input instanceof Request ? new URL(input.url) : new URL(String(input))
    let method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const record = (partial: Omit<ExtensionHttpAudit, 'extensionId' | 'workspaceId' | 'method' | 'host' | 'durationMs'>) =>
      audit({ extensionId: deps.extensionId, workspaceId: deps.workspaceId, method, host: first.host || first.href, durationMs: Math.round((performance.now() - started) * 10) / 10, ...partial })

    let url = first
    let body = init?.body ?? (input instanceof Request ? input.body : undefined)
    let redirects = 0
    const signal = init?.signal ?? AbortSignal.timeout(timeoutMs)
    for (;;) {
      const why = await check(url)
      if (why) { record({ status: null, result: 'refused', reason: why, redirects }); throw refusal(why, url) }
      let res: Response
      try {
        res = await fetchImpl(url, { ...init, method, body, signal, redirect: 'manual' })
      } catch (err) {
        record({ status: null, result: 'failed', redirects })
        throw err
      }
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (!location) { record({ status: res.status, result: 'ok', redirects }); return res }
      redirects++
      if (redirects > maxRedirects) { record({ status: res.status, result: 'refused', reason: 'too_many_redirects', redirects }); throw refusal('too_many_redirects', url) }
      url = new URL(location, url)
      // 307/308 keep the method and body; the rest become a GET, as a browser would.
      if (res.status !== 307 && res.status !== 308) { method = 'GET'; body = undefined }
    }
  }
}

export interface NarrowSecretsDeps {
  extensionId: string
  /** The extension's effective grants (E.14: never null). */
  grants: readonly string[]
  /** Whether a name resolves as a platform-wide secret key (not one of the extension's own). */
  isPlatformKey: (name: string) => boolean
}

type SecretAccessorLike = { get(name: string): string | undefined; has(name: string): boolean; readonly provider: string }

/**
 * A grants-declaring extension's `ctx.secrets`: its own names answer as
 * before; a platform key answers only under `secrets:<name>` (or the
 * privileged `secrets:any`), and `get` of a refused name throws - a grant
 * is explicit, and an undefined that hides a refusal is a wrong guess.
 */
export function narrowSecrets(base: SecretAccessorLike | undefined, deps: NarrowSecretsDeps): SecretAccessorLike | undefined {
  if (!base) return base
  const granted = new Set(deps.grants.filter((g) => g.startsWith('secrets:')).map((g) => g.slice('secrets:'.length)))
  const allowed = (name: string) => granted.has('any') || granted.has(name) || !deps.isPlatformKey(name)
  const narrowed = {
    get: (name: string) => {
      if (!allowed(name)) throw new Error(`Extension '${deps.extensionId}' is not granted the secret ${name}: declare secrets:${name} in its manifest grants`)
      return base.get(name)
    },
    has: (name: string) => allowed(name) && base.has(name),
    provider: base.provider,
  }
  Object.defineProperty(narrowed, NO_LOG, { value: true, enumerable: false })
  return narrowed
}
