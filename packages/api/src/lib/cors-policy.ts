/**
 * File Name: cors-policy.ts
 * Purpose: The deployment's CORS posture, as data: what to do with NO origins,
 *   what to do with a wildcard, and how the boot log says which it is. The
 *   per-request decision lives in gateway/cors.ts (M4); this file keeps the
 *   posture rules both paths read.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure; no Elysia import, so it is testable as data as well
 *   as through a real app.
 *
 *   Two rules, both learned from CF-1.
 *
 *   1. An empty allow-list fails CLOSED outside development. `cors()` called
 *      with no `origin` key defaults to `origin: true` (reflect whatever the
 *      caller sent) AND `credentials: true`, so the old fallthrough handed a
 *      production deploy whose origins resolved to empty strings fully
 *      permissive credentialed CORS - the exact opposite of the allow-list it
 *      thought it had declared. Development keeps the permissive default,
 *      because a bare clone with no config must still work.
 *
 *   2. A wildcard never rides with credentials. `['*'] `is documented as
 *      supported (packages/types/src/config.ts), and credentials were
 *      hard-coded true, so a self-hoster could produce the one pairing every
 *      browser rejects outright - while curl showed a clean 200. Forcing
 *      credentials off makes it structurally impossible rather than merely
 *      improbable.
 *
 *   Per-workspace origin resolution is NOT here. That is M4 of the Gateway
 *   plan (tasks/plan-gateway.md section 26) and needs the workspace resolved
 *   before CORS is decided, which a boot-time plugin cannot do. This file only
 *   closes the fail-open hole.
 */
import { getLogger } from '@tangen/logging'
import { currentDeploymentPolicy, type DeploymentPolicy } from './deployment-role'

/** Headers the browser must be allowed to read: Toolbar timing plus the request id. */
export const CORS_EXPOSE_HEADERS = ['X-Tangen-Qm', 'Server-Timing', 'X-Tangen-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'] as const

export interface CorsOptions {
  /** true = reflect the caller's Origin, false = allow none, or an allow-list. */
  origin: boolean | string[]
  credentials: boolean
  exposeHeaders: string[]
}

/** A staging or production deployment role - the same signal lib/jwt-secret.ts refuses a generated secret on. */
export function isProductionLike(policy: DeploymentPolicy = currentDeploymentPolicy()): boolean {
  return policy.productionLike
}

/**
 * Builds the options for the shared CORS layer.
 * @param origins - The resolved allow-list (collectCorsOrigins today).
 * @param opts - `productionLike` decides the empty-list posture.
 * @returns Options safe to spread into cors().
 */
export function buildCorsOptions(
  origins: readonly string[],
  opts: { productionLike?: boolean } = {},
): CorsOptions {
  const productionLike = opts.productionLike ?? isProductionLike()
  const exposeHeaders = [...CORS_EXPOSE_HEADERS]

  if (origins.length === 0) {
    // Fail closed where it matters; stay permissive where nothing is at stake.
    return productionLike
      ? { origin: false, credentials: false, exposeHeaders }
      : { origin: true, credentials: true, exposeHeaders }
  }

  const hasWildcard = origins.includes('*')
  return {
    origin: [...origins],
    // Forced, not configurable: '*' with credentials is rejected by every
    // browser, so a config asking for it is asking for a broken response.
    credentials: !hasWildcard,
    exposeHeaders,
  }
}

/**
 * Says out loud, once at boot, what the CORS posture ended up being.
 * @param origins - The resolved allow-list.
 * @param productionLike - Whether the fail-closed branch applies.
 */
export function logCorsPosture(origins: readonly string[], productionLike = isProductionLike()): void {
  const log = getLogger(['tangen', 'api', 'cors'])
  if (origins.length === 0 && productionLike) {
    log.error(
      'CORS is failing CLOSED: no allowed origins resolved, so no cross-origin browser request will be permitted. ' +
      'Declare server.cors.origins (or frontend.url) for this environment in app/config/environments.ts, ' +
      'and check that the env vars they read - FRONTEND_URL and friends - are actually set in this deployment.',
    )
    return
  }
  if (origins.length === 0) {
    log.warn('CORS has no declared origins; reflecting any Origin because this is not a production-like environment.')
    return
  }
  if (origins.includes('*')) {
    log.warn(
      "CORS allow-list contains '*'; credentials are forced OFF because no browser accepts the pair. " +
      'Declare explicit origins if you need credentialed cross-origin requests.',
    )
  }
}

/**
 * Says once at boot how CORS is being decided (M4, plan section 26.4).
 * @param mode - 'observe' answers with the process-wide union and logs what
 *   the per-workspace decision would refuse; 'enforce' lets that decision
 *   answer.
 */
export function logCorsMode(mode: 'observe' | 'enforce'): void {
  const log = getLogger(['tangen', 'api', 'cors'])
  if (mode === 'enforce') {
    log.info('CORS is decided per workspace (TANGEN_CORS_MODE=enforce): an origin one workspace declares is not an origin for another.')
    return
  }
  // A deployed process is warned; a developer's laptop is informed. The
  // message is the operator's to act on, and a first `tangen dev` should not
  // read as a problem.
  const deployed = currentDeploymentPolicy().warnOnObservedCors
  const message =
    'CORS is in OBSERVE mode: the process-wide union of every workspace\'s origins still answers, and each origin it allows that ' +
    'the requesting workspace has not declared is logged. Set TANGEN_CORS_MODE=enforce to make the per-workspace decision answer; ' +
    'that becomes the default next release.'
  if (deployed) log.warn(message)
  else log.info(message)
}

