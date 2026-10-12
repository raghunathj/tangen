/**
 * File Name: destinations-state.ts
 * Purpose: Why a form's Destinations tab has nothing to offer (plan-connectors
 *          D2, decision Q4). Pure, because the three answers are a rule worth
 *          stating rather than a branch buried in a component - and because
 *          the first version of that branch read the error MESSAGE, which
 *          would have told an operator they lacked permission when the real
 *          problem was a 500.
 *
 *          Flows is genuinely required: a destination IS a flow, and Forms
 *          grows no fallback executor to cover its absence (invariants 14 and
 *          15). So the tab stays and says so, which is the whole point of
 *          keeping the reason typed.
 *
 * Author: Raghunath J
 * License: MIT
 */

/**
 * - `flows-absent`: Flows is not installed, not enabled here, or its member
 *   routes are not mounted. Core answers 404 to all four, deliberately: an
 *   uninstalled extension is indistinguishable from an absent route.
 * - `no-permission`: this member may not read flows.
 * - `failed`: something else went wrong, and saying anything more definite
 *   would be a guess.
 */
export type DestinationsUnavailable = 'flows-absent' | 'no-permission' | 'failed'

/** The reason, from the status the API returned. */
export function destinationsUnavailable(error: unknown): DestinationsUnavailable {
  const status = (error as { status?: unknown })?.status
  if (status === 404) return 'flows-absent'
  if (status === 403 || status === 401) return 'no-permission'
  return 'failed'
}

/** What the tab says for each reason. One title, one sentence, at most one action. */
export const UNAVAILABLE_COPY: Record<DestinationsUnavailable, { title: string; description: string; action?: 'extensions' | 'retry' }> = {
  'flows-absent': {
    title: 'Destinations need the Flows extension',
    description:
      'Each destination is a flow: Flows runs it, retries it and keeps its history, so Forms does not need a second way to send anything. Install and enable Flows in this workspace and the destinations available here will appear.',
    action: 'extensions',
  },
  'no-permission': {
    title: 'You cannot see this form\'s destinations',
    description: 'Destinations are flows, so reading them needs the Flows permission. An admin can grant it to your role.',
  },
  failed: {
    title: 'Could not load this form\'s destinations',
    description: 'Flows did not answer. Nothing has changed, so trying again is safe.',
    action: 'retry',
  },
}
