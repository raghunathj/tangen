/**
 * File Name: monitor.ts
 * Purpose: The Gateway's counters as one snapshot for the Performance
 *   Monitor - what the Gateway refused, would have refused, nearly refused,
 *   and could not count, since the process started.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Plan 29.5. Nothing here is a new counter: each
 *   module that decides something already counts it (the rate-limit hook,
 *   the policy observer, the store, the CORS layer, the request limits, the
 *   surface exposure, the connection log), because the log line alone is
 *   throttled to the 1/10/100 cadence and the running total is what tells
 *   an operator whether a budget is close. This module only reads them and
 *   shapes the answer the admin route returns.
 *
 *   Why no /metrics endpoint. Section 29 keeps Prometheus and OpenTelemetry
 *   out of the baseline; the existing admin surface (routes/admin/
 *   query-monitor.ts) is where an operator already looks, and these
 *   counters belong beside the N+1 detector rather than on a new page.
 *
 *   "By dimension" is derived, not counted twice: a denial is counted per
 *   policy, and the policy names what it counts by (CATEGORY_DEFAULTS, a
 *   route row's own `by`, or the realtime gauges), so the per-dimension view
 *   is the per-policy view folded through that.
 */
import type { RateLimitDimension } from '@tangen/types'
import { rateLimitCounts } from './rate-limit'
import { CATEGORY_DEFAULTS } from './rate-limit/policy'
import { storeFailureCount } from './rate-limit/store'
import { policyMismatchCounts } from './policy-observer'
import { corsDivergenceCounts } from './cors'
import { limitRefusalCounts } from './request-limits'
import { exposureRefusalCounts } from './surface-exposure'
import { connectionCounts } from './connection-log'
import { ROUTE_POLICIES } from './route-policy'
import { dynamicRoutePolicies } from './dynamic-policies'
import { REALTIME_MESSAGE_POLICY_ID } from './realtime-limits'

/** A gauge or window the realtime gate keys on, beside the request dimensions. */
export type MonitorDimension = RateLimitDimension | 'connection'

export interface GatewayMonitorSnapshot {
  rateLimit: {
    /** Totals across every policy. */
    totals: { denied: number; wouldDeny: number; nearMiss: number }
    /** `<kind>|<policy>` as the hook counts it. */
    byPolicy: Record<string, number>
    /** Denials and would-denials folded onto the dimensions their policy counts by. */
    byDimension: Record<string, number>
    storeFailures: number
  }
  policyMismatches: Record<string, number>
  /** Observe-mode CORS divergences, `<workspaceId>|<route>`. */
  cors: Record<string, number>
  /** Request-limit refusals and clamps, `<limit>|<via>`. */
  requestLimits: Record<string, number>
  /** Surface refusals (apiExposure), `<category>|<workspaceId>`. */
  exposure: Record<string, number>
  realtime: ReturnType<typeof connectionCounts>
}

/**
 * The dimensions one policy id counts by: the category's default, a route
 * row's own budget, or one of the realtime gate's gauges and windows.
 * @param policyId - As it appears in the counters.
 * @returns The dimensions, or an empty list for an id nothing declares.
 */
export function dimensionsOfPolicy(policyId: string): MonitorDimension[] {
  if (policyId.startsWith('category:')) {
    const category = policyId.slice('category:'.length) as keyof typeof CATEGORY_DEFAULTS
    return CATEGORY_DEFAULTS[category]?.by ?? []
  }
  if (policyId.startsWith('route:')) {
    const id = policyId.slice('route:'.length)
    const row = [...dynamicRoutePolicies(), ...ROUTE_POLICIES].find((p) => p.id === id)
    const budget = row?.rateLimit
    if (budget && budget !== 'inherit' && budget !== 'none') return budget.by ?? ['ip', 'route']
    return []
  }
  if (policyId === 'realtime:connections') return ['workspace']
  if (policyId === 'realtime:connections-per-identity') return ['identity']
  if (policyId === REALTIME_MESSAGE_POLICY_ID) return ['connection']
  return []
}

/** Keeps the entries whose key names the workspace, when one is given. */
function scoped(counts: Record<string, number>, workspaceId: string | null | undefined, position: 0 | 1): Record<string, number> {
  if (!workspaceId) return counts
  const out: Record<string, number> = {}
  for (const [key, n] of Object.entries(counts)) {
    if (key.split('|')[position] === workspaceId) out[key] = n
  }
  return out
}

/**
 * The live gauges per workspace and the remembered closes are the caller's
 * workspace unless every workspace was asked for; the process totals, the
 * close codes and the per-transport gauge are process-wide by nature.
 */
function scopedRealtime(counts: ReturnType<typeof connectionCounts>, workspaceId: string | null | undefined): ReturnType<typeof connectionCounts> {
  if (!workspaceId) return counts
  return {
    ...counts,
    openByScope: scoped(counts.openByScope, workspaceId, 0),
    lastCloses: counts.lastCloses.filter((c) => c.workspaceId === workspaceId),
  }
}

/**
 * Reads every Gateway counter into one answer.
 * @param opts - The caller's workspace; counters keyed on a workspace are
 *               limited to it, the rest are process-wide by nature.
 * @returns The snapshot.
 */
export function gatewayMonitorSnapshot(opts: { workspaceId?: string | null } = {}): GatewayMonitorSnapshot {
  const byPolicy = rateLimitCounts()
  const totals = { denied: 0, wouldDeny: 0, nearMiss: 0 }
  const byDimension: Record<string, number> = {}
  for (const [key, n] of Object.entries(byPolicy)) {
    const [kind, policy] = key.split('|') as [string, string]
    if (kind === 'denied') totals.denied += n
    else if (kind === 'would-deny') totals.wouldDeny += n
    else if (kind === 'near-miss') totals.nearMiss += n
    if (kind === 'near-miss') continue
    for (const dimension of dimensionsOfPolicy(policy)) {
      byDimension[dimension] = (byDimension[dimension] ?? 0) + n
    }
  }
  return {
    rateLimit: { totals, byPolicy, byDimension, storeFailures: storeFailureCount() },
    policyMismatches: policyMismatchCounts(),
    cors: scoped(corsDivergenceCounts(), opts.workspaceId, 0),
    requestLimits: limitRefusalCounts(),
    exposure: scoped(exposureRefusalCounts(), opts.workspaceId, 1),
    realtime: scopedRealtime(connectionCounts(), opts.workspaceId),
  }
}
