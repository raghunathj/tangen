/**
 * File Name: redact.ts
 * Purpose: Keeps credentials out of log records (closure plan Phase 2,
 *          Unit 2). Every property a logger is handed, and the message and
 *          stack of every error it is handed, pass through here before a
 *          sink sees them: a key that names a secret loses its value, and a
 *          value that LOOKS like a credential (a bearer token, a Tangen key,
 *          a JWT, the password of a connection string) is replaced wherever
 *          it sits in a string.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. Deliberately conservative in the other direction
 *          too: identifiers (request ids, workspace ids, UUIDs) are not
 *          secrets and must survive, or the log stops being diagnosable.
 *          Depth and size are capped so a pathological object cannot turn a
 *          log line into work. The Gateway's own access-log redaction
 *          (packages/api/src/gateway/logging.ts) is an allow-list on top of
 *          this; this is the floor under every logger.
 */

import { NO_LOG } from '@tangen/types'

export const REDACTED = '[redacted]'
/** What a NO_LOG object becomes in a log record. */
export const NO_LOG_PLACEHOLDER = '[not logged]'

/** A property whose VALUE is a credential, whatever the value looks like. */
const SECRET_KEY = /(^|[_\-.])(authorization|cookie|cookies|set-cookie|password|passwd|secret|secrets|token|tokens|api[_-]?key|apikey|x-tangen-key|private[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?key|signing[_-]?key|jwt[_-]?secret|database[_-]?url|connection[_-]?string|redis[_-]?url|credentials?)([_\-.]|$)/i

/** Is this a property name whose value must never be written down? */
/** A property that names an identifier or a count OF a secret, not the secret: apiKeyId, tokenCount. */
const IDENTIFIER_SUFFIX = /(^|_)(id|ids|count|name|label|type|prefix|length|ttl|at)$/i

export function isSecretKey(name: string): boolean {
  // camelCase joins the words a separator would: webhookSecret is webhook_secret.
  const norm = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  if (IDENTIFIER_SUFFIX.test(norm)) return false
  return SECRET_KEY.test(norm)
}

const PATTERNS: Array<[RegExp, string]> = [
  // Bearer / Basic credentials wherever they appear in a string.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/=]{8,}/g, `$1 ${REDACTED}`],
  // Tangen API keys, site keys, transfer tokens: every prefixed credential the platform mints.
  [/\btgn_[A-Za-z0-9_]{8,}/g, REDACTED],
  // A JWT: three base64url segments, the first of which decodes to a JSON header.
  [/\beyJ[A-Za-z0-9\-_]{8,}\.[A-Za-z0-9\-_]{8,}\.[A-Za-z0-9\-_]{8,}\b/g, REDACTED],
  // The password of a connection string: scheme://user:PASSWORD@host
  [/\b([a-z][a-z0-9+.\-]*:\/\/[^:/\s@]+:)[^@\s]+@/gi, `$1${REDACTED}@`],
  // key=value pairs naming a secret inside free text (query strings, error messages).
  [/\b(password|passwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token)(\s*[=:]\s*)(?!\[redacted\])[^\s&,;'"]+/gi, `$1$2${REDACTED}`],
]

/** Replaces credential-shaped material inside a string; identifiers survive. */
export function redactString(text: string): string {
  let out = text
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement)
  return out
}

const MAX_DEPTH = 6
const MAX_KEYS = 200

/**
 * Redacts a log property value: secret keys lose their values, strings are
 * scrubbed, objects and arrays are walked to a bounded depth, errors keep
 * their name and a scrubbed message and stack.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactString(value)
  if (value === null || typeof value !== 'object') return value
  // A resolved deployment or a secret accessor is marked NO_LOG: it is never
  // written down, not even redacted (amendment C - the diagnostic projection is explicit).
  if ((value as Record<symbol, unknown>)[NO_LOG] === true) return NO_LOG_PLACEHOLDER
  if (depth >= MAX_DEPTH) return '[depth]'
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), ...(value.stack ? { stack: redactString(value.stack) } : {}) }
  }
  if (value instanceof Date) return value
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => redactValue(v, depth + 1))
  const out: Record<string, unknown> = {}
  let n = 0
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (n++ >= MAX_KEYS) { out['…'] = '[truncated]'; break }
    out[k] = (v as Record<symbol, unknown> | null)?.[NO_LOG] === true ? NO_LOG_PLACEHOLDER
      : isSecretKey(k) ? (v === undefined || v === null || v === '' ? v : REDACTED) : redactValue(v, depth + 1)
  }
  return out
}

/** The properties of one log record, redacted. */
export function redactMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {}
  return redactValue(meta) as Record<string, unknown>
}
