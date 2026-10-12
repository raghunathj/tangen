/**
 * File Name: internal-error.ts
 * Purpose: The one internal-error contract (closure plan Phase 2, Unit 1).
 *          An exception nobody mapped to a RequestError reaches the client as
 *          `{ code: 'INTERNAL', message: 'Internal server error', status: 500,
 *          id }` on a production-like deployment; the raw message, name, cause
 *          chain and stack go to the server log under the same id, so an
 *          operator can find the failure a client reports without the client
 *          ever seeing what failed.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure apart from the logger. `detailMode` is the one
 *          place the policy is decided: NODE_ENV production or staging
 *          (the same signal lib/jwt-secret.ts refuses to start on) redacts;
 *          anything else is a developer's machine and keeps the message -
 *          deliberately, and tested - but never the stack. The id is the
 *          request's own X-Tangen-Request-Id when the Gateway opened one,
 *          so the log line, the response header and the body agree.
 */
import { randomUUID } from 'node:crypto'
import { getLogger } from '@tangen/logging'
import { isProductionLike } from './cors-policy'
import { currentDeploymentPolicy, type DeploymentPolicy } from './deployment-role'
import { currentGatewayContext, gatewayContextOf } from '../gateway/request-context'

export type ErrorDetailMode = 'redact' | 'detail'

/** What a client may learn about an unmapped exception on this deployment: the deployment role decides. */
export function detailMode(policy: DeploymentPolicy = currentDeploymentPolicy()): ErrorDetailMode {
  return isProductionLike(policy) ? 'redact' : 'detail'
}

export const INTERNAL_ERROR_MESSAGE = 'Internal server error'

export interface InternalErrorBody {
  error: { code: 'INTERNAL'; message: string; status: 500; id: string }
}

/** Everything the log needs to diagnose the failure; nothing of it reaches the client when redacting. */
export interface InternalErrorLogRecord {
  id: string
  method?: string
  path?: string
  route?: string | null
  errorName: string
  errorMessage: string
  errorStack?: string
  causes: string[]
}

function describe(error: unknown): { name: string; message: string; stack?: string; causes: string[] } {
  const causes: string[] = []
  let cursor: unknown = error instanceof Error ? error.cause : undefined
  for (let depth = 0; cursor !== undefined && cursor !== null && depth < 8; depth++) {
    causes.push(cursor instanceof Error ? `${cursor.name}: ${cursor.message}` : String(cursor))
    cursor = cursor instanceof Error ? cursor.cause : undefined
  }
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack, causes }
  return { name: 'NonError', message: typeof error === 'string' ? error : JSON.stringify(error) ?? String(error), causes }
}

/** The request id the Gateway assigned, from wherever it is reachable; a fresh one when no Gateway ran. */
export function requestIdFor(c: unknown): string {
  return currentGatewayContext()?.requestId ?? gatewayContextOf(c)?.requestId ?? randomUUID()
}

const log = getLogger(['tangen', 'api', 'error'])

/**
 * Builds the client body for an unmapped exception and writes the diagnosis
 * to the log under the same id.
 * @param error - Whatever was thrown.
 * @param opts - The id, the request (for the log line), the mode, and a log override for tests.
 */
export function internalErrorResponse(
  error: unknown,
  opts: { id: string; method?: string; path?: string; route?: string | null; mode?: ErrorDetailMode; log?: (record: InternalErrorLogRecord) => void },
): InternalErrorBody {
  const d = describe(error)
  const record: InternalErrorLogRecord = {
    id: opts.id, method: opts.method, path: opts.path, route: opts.route ?? undefined,
    errorName: d.name, errorMessage: d.message, errorStack: d.stack, causes: d.causes,
  }
  if (opts.log) opts.log(record)
  else log.error(`unhandled error ${opts.id}: ${d.name}: ${d.message}`, record as unknown as Record<string, unknown>)
  const mode = opts.mode ?? detailMode()
  // In detail mode the message is the developer's to read; the stack and the
  // cause chain still stay in the log - a response body is not a debugger.
  const message = mode === 'detail' && d.message ? d.message : INTERNAL_ERROR_MESSAGE
  return { error: { code: 'INTERNAL', message, status: 500, id: opts.id } }
}
