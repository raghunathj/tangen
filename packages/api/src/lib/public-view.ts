/**
 * File Name: public-view.ts
 * Purpose: The public/admin read boundary in ONE place. API-key callers see
 *          the published web: reads default to status 'published' and serve
 *          the snapshot frozen at publish; drafts are only reachable when the
 *          key carries the objects `read_draft` grant (preview keys). Member
 *          (admin-panel) callers keep the working view unchanged.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { RequestError } from './errors'
export { applyPublishedSnapshot } from '../services/local-client'
import { readViewOf, isPublicView } from '../kernel/read-view'
import { actorFromContext, type LegacyIdentityContext } from '../kernel/actor'

/**
 * The status a read is allowed to run with.
 * - members: whatever they asked for (null = admin default, all non-archived)
 * - API keys: 'published' unless they explicitly ask for drafts AND hold the
 *   `read_draft` grant for the type (403 otherwise — explicit ask, honest no)
 */
export function resolveReadStatus(input: LegacyIdentityContext & {
  typeName?: string
  requested?: string | null
}): string | null {
  // K2: the view is the actor's by policy (kernel/read-view.ts), never the
  // presence of a member id.
  return readViewOf(actorFromContext(input), input.requested, input.typeName).status
}

/** True when this read must present the published web (snapshot + published-only expansion). */
export function isPublicPublishedView(ctx: LegacyIdentityContext | null | undefined, effectiveStatus: string | null): boolean {
  return isPublicView(actorFromContext(ctx), effectiveStatus)
}

/** 404 unless the row is published — the public never learns a draft exists. */
export function assertRowPublished(row: Record<string, unknown> | null | undefined): void {
  if (!row || row.status !== 'published') {
    throw new RequestError('NOT_FOUND', 'Object not found', 404)
  }
}
