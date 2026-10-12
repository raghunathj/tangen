/**
 * File Name: read-view.ts
 * Purpose: The read view one actor gets (kernel plan §8), derived from the
 *          actor by policy and never from the presence of a member id: a
 *          member and a system actor read live state; a key reads the
 *          published web unless it asked for drafts and holds the
 *          `read_draft` grant for the type.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: K2 gives the routes this rule through
 *          lib/public-view.ts; K3 makes the operations take the view as
 *          input so the routes stop computing it at all.
 */
import type { ActorContext } from '@tangen/types'
import { requireDecision } from './policy'

export type ReadView = 'public' | 'draft' | 'internal'

export interface ResolvedReadView {
  /** The status filter the read runs with; null = every status (a member's unfiltered read). */
  status: string | null
  view: ReadView
}

export function readViewOf(actor: ActorContext | null | undefined, requested: string | null | undefined, typeName?: string): ResolvedReadView {
  const wanted = requested?.trim() || null
  if (!actor) return { status: 'published', view: 'public' }
  if (actor.identity.kind === 'system') return { status: wanted, view: 'internal' }
  if (actor.identity.kind === 'member') return { status: wanted, view: 'draft' }
  // A key, or a site user: the published web unless drafts were asked for AND granted.
  if (!wanted || wanted === 'published') return { status: 'published', view: 'public' }
  requireDecision(actor, { kind: 'object', action: 'read_draft', type: typeName })
  return { status: wanted, view: 'draft' }
}

/** True when this read must present the published web (snapshot + published-only expansion). */
export function isPublicView(actor: ActorContext | null | undefined, effectiveStatus: string | null): boolean {
  if (effectiveStatus !== 'published') return false
  return !actor || (actor.identity.kind !== 'member' && actor.identity.kind !== 'system')
}
