/**
 * File Name: capability-guard.ts
 * Purpose: One decision for "may this Admin surface show?" (closure plan
 *          Phase 8A, Units 11, 12, 15 and 16). Every page used to branch for
 *          itself, so a disabled capability meant something different on
 *          each screen. This is the branching, once, as a pure function -
 *          the component that renders it is 8B's business.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Two dimensions that never merge. CAPABILITY says
 *          whether the platform can do the thing here; PERMISSION says
 *          whether this member may see it. Both must pass, and authorization
 *          wins every conflict - a capability being `on` never grants
 *          access, and a permission never resurrects an unavailable
 *          capability.
 */
import type { CapabilityDescriptor, CapabilityStatus } from './use-capabilities'

/**
 * What kind of surface is being guarded.
 *
 * - `feature` - the capability's product surface. Shown only when it is on.
 * - `management` - where an operator inspects or changes that state (the
 *   extensions list, a settings page, Doctor). Shown for `off` and
 *   `unavailable` too: hiding it would hide the only way back.
 */
export type SurfaceKind = 'feature' | 'management'

export type GuardOutcome =
  | { show: true; degraded: false }
  /** Show the surface, but say why it cannot do anything yet. */
  | { show: true; degraded: true; state: 'off' | 'unavailable'; reason?: CapabilityDescriptor['reason'] }
  | { show: false; because: 'loading' | 'off' | 'unavailable' | 'unknown' | 'denied' | 'error' }

export interface GuardInput {
  status: CapabilityStatus
  kind: SurfaceKind
  /** The member's permission for this surface. Undefined means "not permission-gated". */
  permitted?: boolean
  /** The descriptor, when there is one - carries the reason a degraded surface shows. */
  descriptor?: CapabilityDescriptor
  /** The bootstrap read failed: an error state, never "everything is off". */
  failed?: boolean
}

/**
 * The one branch. Order matters: authorization first (a denied surface is
 * denied whatever the platform can do), then the failure state, then
 * loading, then capability.
 */
export function guardSurface(input: GuardInput): GuardOutcome {
  if (input.permitted === false) return { show: false, because: 'denied' }
  if (input.failed) return { show: false, because: 'error' }
  if (input.status === 'loading') return { show: false, because: 'loading' }

  // A capability this server has never heard of is not a feature to show.
  // Management surfaces are the exception only when a descriptor exists.
  if (input.status === 'unknown') return { show: false, because: 'unknown' }

  if (input.status === 'on') return { show: true, degraded: false }

  // off / unavailable
  if (input.kind === 'management') {
    return { show: true, degraded: true, state: input.status, reason: input.descriptor?.reason }
  }
  return { show: false, because: input.status }
}

/** Navigation asks the same question a page does, so the two cannot disagree. */
export function navVisible(input: GuardInput): boolean {
  return guardSurface(input).show
}

/**
 * Nav items for one section, in a deterministic order: declared order first,
 * then label, so two loads never reshuffle the sidebar.
 */
export function sortNav<T extends { label: string; order?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
}
