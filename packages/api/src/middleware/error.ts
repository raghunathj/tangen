/**
 * File Name: error.ts
 * Purpose: Global Elysia error handler that maps AuthError, RequestError, and
 *   framework error codes (PARSE, NOT_FOUND, VALIDATION) to consistent JSON
 *   error responses with appropriate HTTP status codes. A framework
 *   validation failure becomes Tangen's own envelope (lib/validation-error.ts):
 *   `VALIDATION_ERROR` with one reason per field path and no submitted value.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: elysia, ../lib/errors (RequestError - imported inline for
 *   type safety), ../lib/internal-error for the 500 contract: a production-like
 *   deployment never sees an exception message, a stack or a driver string,
 *   only `{ code: 'INTERNAL', message: 'Internal server error', status, id }`
 *   with the id the log line carries.
 */

import { Elysia } from 'elysia'
import { internalErrorResponse, requestIdFor, type ErrorDetailMode, type InternalErrorLogRecord } from '../lib/internal-error'
import { gatewayContextOf, REQUEST_ID_HEADER } from '../gateway/request-context'
import { validationEnvelope } from '../lib/validation-error'

/**
 * Elysia plugin that intercepts all thrown errors and serialises them as
 * structured `{ error: { code, message, status, fieldErrors? } }` JSON responses.
 */
export const createErrorMiddleware = (opts: { mode?: ErrorDetailMode; log?: (record: InternalErrorLogRecord) => void } = {}) => (app: Elysia) =>
  app.onError((c) => {
    const { code, error, set } = c
    if (error instanceof Error && error.name === 'AuthError') {
      set.status = 401
      return { error: { code: 'UNAUTHORIZED', message: error.message, status: 401 } }
    }
    // A RequestError thrown while the body was being READ arrives wrapped in
    // Elysia's 400 ParseError with the original as `cause` - that is how the
    // Gateway's bounded body reader (gateway/request-limits.ts) delivers its
    // 413. The cause is the answer; the wrapper would turn every oversize
    // body into "malformed JSON".
    const cause = (error as { cause?: unknown } | undefined)?.cause
    const requestError = error instanceof Error && error.name === 'RequestError'
      ? error
      : cause instanceof Error && cause.name === 'RequestError' ? cause : null
    if (requestError) {
      const e = requestError as import('../lib/errors').RequestError
      set.status = e.statusCode
      // An upstream Retry-After survives as a REAL header, not just a JSON
      // field - standard clients and proxies back off on the header alone.
      const retryAfter = (e.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds
      if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
        set.headers['Retry-After'] = String(Math.ceil(retryAfter))
      }
      return { error: { code: e.code, message: e.message, status: e.statusCode, fieldErrors: e.fieldErrors, ...(e.details !== undefined ? { details: e.details } : {}) } }
    }
    if (code === 'PARSE') {
      set.status = 400
      return { error: { code: 'PARSE_ERROR', message: 'Invalid or malformed JSON in request body', status: 400 } }
    }
    if (code === 'NOT_FOUND') {
      set.status = 404
      return { error: { code: 'NOT_FOUND', message: 'Route not found', status: 404 } }
    }
    // Tangen owns the validation contract: Elysia's own message is TypeBox's
    // diagnostic, schema internals and the whole submitted body included
    // (lib/validation-error.ts). One envelope, one code, no values echoed.
    if (code === 'VALIDATION') {
      set.status = 422
      return { error: validationEnvelope(error) }
    }
    // Anything else is an exception nobody mapped: the client gets the one
    // INTERNAL contract with an id, the log gets the diagnosis under that id
    // (lib/internal-error.ts). The message is redacted on production-like
    // deployments and kept, deliberately, on a developer's machine.
    set.status = 500
    // One id per response: a mount that already stamped the header (the
    // extension dispatchers hand it to the handler as req.requestId) keeps it.
    const stamped = set.headers[REQUEST_ID_HEADER.toLowerCase()]
    const id = typeof stamped === 'string' && stamped ? stamped : requestIdFor(c)
    set.headers[REQUEST_ID_HEADER.toLowerCase()] ??= id
    let path: string | undefined
    try { path = new URL(c.request.url).pathname } catch { path = undefined }
    return internalErrorResponse(error, { id, method: c.request?.method, path, route: gatewayContextOf(c)?.route ?? null, mode: opts.mode, log: opts.log })
  })

/** The global handler with the deployment's own detail mode. */
export const errorMiddleware = createErrorMiddleware()
