/**
 * File Name: validation-error.ts
 * Purpose: Tangen owns what a client sees when its request does not
 *          validate (closure plan Phase 6A, Unit 4; audit finding Q2).
 *          Elysia's own validation error serialises TypeBox's diagnostic
 *          as the message - the schema's internals AND the whole submitted
 *          body, echoed back inside `found` - which is both a framework
 *          contract leaking into the public API and content the client
 *          never asked us to repeat. This turns it into the same envelope
 *          every hand-written check produces: a code, a sentence, and one
 *          reason per field path.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Nothing here reads a submitted VALUE. A reason comes
 *          from TypeBox's schema-derived `message` ("Expected string"),
 *          never from `summary`, which appends what it found. The list is
 *          capped so a large schema cannot answer with a large error, and
 *          it is deduplicated by path, so the union-plus-required pair
 *          TypeBox reports for one missing property reads as one problem.
 */

/** Where the invalid input was: the same words the API uses elsewhere. */
export type ValidationTarget = 'body' | 'query' | 'params' | 'headers' | 'cookie' | 'response' | 'request'

/** At most this many field reasons travel in one response. */
export const MAX_FIELD_ERRORS = 8

export interface ValidationEnvelope {
  code: 'VALIDATION_ERROR'
  message: string
  status: 422
  /** `sort.direction` -> `Expected required property`. Never a submitted value. */
  fieldErrors: Record<string, string>
  details: { on: ValidationTarget; fields: string[]; truncated?: true }
}

/** A TypeBox error as Elysia hands it over; only these two fields are read. */
interface ValueErrorLike { path?: unknown; message?: unknown }

const TARGETS: ValidationTarget[] = ['body', 'query', 'params', 'headers', 'cookie', 'response', 'request']

/** `/sort/direction` -> `sort.direction`; `` -> `(root)`. */
export function fieldPath(path: unknown): string {
  if (typeof path !== 'string' || path === '' || path === '/') return '(root)'
  return path.replace(/^\//, '').split('/').filter(Boolean).join('.')
}

function targetOf(error: unknown): ValidationTarget {
  const t = (error as { type?: unknown } | null)?.type
  return typeof t === 'string' && (TARGETS as string[]).includes(t) ? t as ValidationTarget : 'request'
}

/** Is this Elysia's validation error rather than something we threw ourselves? */
export function isFrameworkValidationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { all?: unknown; type?: unknown; validator?: unknown }
  return Array.isArray(e.all) || (typeof e.type === 'string' && 'validator' in e)
}

/**
 * The envelope for one framework validation failure. Deterministic: the same
 * invalid request always produces the same response.
 */
export function validationEnvelope(error: unknown): ValidationEnvelope {
  const on = targetOf(error)
  const all = Array.isArray((error as { all?: unknown })?.all) ? (error as { all: ValueErrorLike[] }).all : []
  const fieldErrors: Record<string, string> = {}
  let truncated = false
  for (const entry of all) {
    if (!entry || typeof entry !== 'object') continue
    const key = fieldPath(entry.path)
    const reason = typeof entry.message === 'string' ? entry.message : 'Invalid value'
    if (key in fieldErrors) continue                       // one problem per path: the first reason is the specific one
    if (Object.keys(fieldErrors).length >= MAX_FIELD_ERRORS) { truncated = true; break }
    fieldErrors[key] = reason
  }
  const fields = Object.keys(fieldErrors)
  const listed = fields.map((f) => `${f} (${fieldErrors[f]})`).join(', ')
  const message = fields.length === 0
    ? `Invalid request ${on}`
    : `Invalid request ${on}: ${listed}${truncated ? ', and more' : ''}`
  return { code: 'VALIDATION_ERROR', message, status: 422, fieldErrors, details: { on, fields, ...(truncated ? { truncated: true as const } : {}) } }
}
