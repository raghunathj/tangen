/**
 * File Name: logging.ts
 * Purpose: The Gateway access log - the record it writes, and the redaction
 *   that keeps a credential out of it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/logging for the sink; everything else is pure so
 *   the exact bytes are testable without capturing a logger.
 *
 *   Redaction here is an ALLOW-LIST, not a deny-list. The record is built from
 *   named fields of the request context, so a value can only appear because
 *   somebody added it deliberately. Deny-lists leak by omission; this one can
 *   only leak by commission.
 *
 *   Two deny-lists sit on top of that, for the two places a secret can arrive
 *   anyway. Headers: an operator can ask for a header by name, and asking for
 *   `authorization` is a mistake rather than permission, so the credential
 *   header names are refused whatever the include-list says. Paths: the flow
 *   webhook (Flows' own public route, `/api/v1/ext/flows/hooks/:token`) and the Porter transfer surface put
 *   a credential IN THE URL, which is the one place a header deny-list cannot
 *   see, so long opaque path segments are replaced. The query string is never
 *   logged at all.
 *
 *   Never logged, per the locked list: API keys, Authorization headers,
 *   passwords, access and refresh tokens, sensitive form values, secrets.
 */
import { getLogger } from '@tangen/logging'
import type { GatewayRequestContext } from '@tangen/types'

/** Header names whose VALUE is a credential. Refused regardless of config. */
export const SECRET_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-tangen-key',
  'x-tangen-playground',
  'x-tangen-transfer',
  'x-tangen-preview-token',
  'x-api-key',
] as const

/** Is this a header whose value must never be written down? */
export function isSecretHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return (SECRET_HEADERS as readonly string[]).includes(lower)
    || lower.endsWith('-token')
    || lower.endsWith('-secret')
}

const REDACTED = '[redacted]'
/** A UUID is an identifier, not a secret, and is useful in a trace. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Replaces path segments that look like a credential.
 * @param path - A URL pathname (no query string).
 * @returns The path with opaque segments replaced by `[redacted]`.
 */
export function scrubPath(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      if (segment === '') return segment
      if (segment.startsWith('tgn_')) return REDACTED
      if (UUID.test(segment)) return segment
      // Long, opaque and unpunctuated is what a token looks like; a route
      // segment or a slug is neither that long nor that uniform.
      if (segment.length >= 32 && /^[A-Za-z0-9_-]+$/.test(segment)) return REDACTED
      return segment
    })
    .join('/')
}

export interface AccessLogOptions {
  headers?: Headers
  /** Header names the operator asked for. Credential headers are refused. */
  includeHeaders?: string[]
}

/**
 * Builds the access-log record for one finished request.
 * @param ctx - The Gateway request context.
 * @param opts - Optional request headers plus the operator's include-list.
 * @returns A flat record safe to serialise.
 */
export function accessLogRecord(
  ctx: GatewayRequestContext,
  opts: AccessLogOptions = {},
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    requestId: ctx.requestId,
    method: ctx.method,
    path: scrubPath(ctx.path),
    route: ctx.route,
    routeCategory: ctx.routeCategory,
    accessMode: ctx.accessMode,
    authMode: ctx.authMode,
    status: ctx.status,
    durationMs: ctx.durationMs,
    workspaceId: ctx.workspaceId,
    clientIp: ctx.clientIp,
    origin: ctx.origin,
    userId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    extensionId: ctx.extensionId,
  }
  if (ctx.upstreamRequestId) record.upstreamRequestId = ctx.upstreamRequestId
  // The site member behind a site-key request: an id, joinable with the
  // connection log; the email is PII and is never a field here.
  if (ctx.siteUserId) record.siteUserId = ctx.siteUserId
  if (ctx.rateLimit) record.rateLimit = ctx.rateLimit
  // Only when a cap refused: a 413 beside `limits` says which ceiling and
  // what was seen, so a cap that bites can be counted from the log alone.
  if (ctx.limits) record.limits = ctx.limits

  const wanted = (opts.includeHeaders ?? []).filter((name) => !isSecretHeader(name))
  if (wanted.length > 0 && opts.headers) {
    const headers: Record<string, string> = {}
    for (const name of wanted) {
      const value = opts.headers.get(name)
      if (value != null) headers[name.toLowerCase()] = value.slice(0, 300)
    }
    if (Object.keys(headers).length > 0) record.headers = headers
  }
  return record
}

/**
 * Should this request produce an access-log line?
 * @param mode - The resolved `logging.requests` value.
 * @param status - The response status, or null when it never resolved.
 * @returns Whether to write a line.
 */
export function shouldLogRequest(mode: boolean | 'errors-only', status: number | null): boolean {
  if (mode === false) return false
  if (mode === true) return true
  // 'errors-only'. An unresolved status means something went wrong before a
  // response existed, which is exactly the case worth keeping.
  return status === null || status >= 400
}

/**
 * The human-readable half of an access-log line.
 *
 * It names the POLICY, not only the path. M2's whole purpose is comparing what
 * the table said against what happened, and a reader scanning a terminal should
 * be able to do that without a JSON parser - `policy=delivery/public` beside a
 * 401 is the mismatch, visible on the line itself. An unmatched request says
 * `unmatched` rather than leaving a blank, because "no row" is an answer.
 * @param ctx - The finished request context.
 * @returns The message text for the log line.
 */
export function accessLogLine(ctx: GatewayRequestContext): string {
  const policy = `${ctx.route ?? 'unmatched'}/${ctx.accessMode}`
  return `${ctx.method} ${scrubPath(ctx.path)} ${ctx.status ?? '-'} ${ctx.durationMs ?? '-'}ms policy=${policy}`
}

const logger = getLogger(['tangen', 'api', 'gateway'])

/**
 * Writes one access-log line at a level that matches the outcome.
 * @param ctx - The finished request context.
 * @param opts - Header options passed through to the record builder.
 */
export function logAccess(ctx: GatewayRequestContext, opts: AccessLogOptions = {}): void {
  const record = accessLogRecord(ctx, opts)
  const status = ctx.status ?? 0
  const line = accessLogLine(ctx)
  // A 500 leaving no server-side trace was gap G-g; it is an error line now.
  if (status >= 500 || ctx.status === null) logger.error(line, record)
  else if (status >= 400) logger.warn(line, record)
  else logger.debug(line, record)
}
