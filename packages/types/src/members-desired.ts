/**
 * File Name: members-desired.ts
 * Purpose: The desired state of a workspace's membership, declared in code
 *          (`app/config/members.ts`) and reconciled into each deployment. It
 *          says WHO is a member and with WHICH workspace role. It never
 *          carries a credential: a member it creates has no password until
 *          invited or reset. Tangen Cloud will write the same shape.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Every deployment reconciles the same declaration into
 *          its own database (tasks/remove-environments-programme.md, stage
 *          R5); a member's presence on a staging deployment and on a
 *          production deployment are two reconciliations of one declaration.
 */

import type { DeploymentRole } from './deployment-role'
import type { Capability } from './member-permissions'
import type { ExtensionId } from './registry'

/**
 * A per-member additive grant entry in the declaration. `on` scopes it to a
 * deployment role (omitted = every deployment), so one declaration can say
 * "grant this only in production" and each deployment applies only the entries
 * that match its own `resolveDeploymentRole()`. Declared grants are ADDITIVE:
 * reconcile unions them onto the member's row and never removes (manual removal
 * is via the admin UI). See tasks/plan-per-user-grants.md.
 */
export interface DesiredMemberGrant {
  on?: DeploymentRole
  capabilities?: Capability[]
  extensions?: ExtensionId[]
}

export interface DesiredMember {
  /** Matched case-insensitively; the identity within the workspace. */
  email: string
  name?: string
  /** The workspace role; `editor` when omitted for a member the plan creates. */
  role?: string
  /** Extra capabilities/extension access on top of the role, per deployment. */
  grants?: DesiredMemberGrant[]
}

/** The grants a declaration adds for a member in a given deployment, unioned. */
export function resolveDesiredGrants(
  member: DesiredMember,
  deploymentRole: DeploymentRole,
): { capabilities: string[]; extensions: string[] } {
  const caps = new Set<string>()
  const exts = new Set<string>()
  for (const g of member.grants ?? []) {
    if (g.on && g.on !== deploymentRole) continue
    for (const c of g.capabilities ?? []) caps.add(c)
    for (const e of g.extensions ?? []) exts.add(e)
  }
  return { capabilities: [...caps], extensions: [...exts] }
}

export type MembersDesiredState = DesiredMember[]

/** Identity helper for `app/config/members.ts`. */
export function defineMembers(members: MembersDesiredState): MembersDesiredState {
  return members
}

export interface ExistingMember {
  id: string
  email: string
  role: string
  /** Grants already stored for this member in THIS deployment (for diffing). */
  grants?: { capabilities: string[]; extensions: string[] }
}

export type MemberReconcileStep =
  | { op: 'create'; email: string; name: string | null; role: string }
  | { op: 'set-role'; memberId: string; email: string; from: string; to: string }
  /** Union these declared grants onto the member's row (additive, never removes). */
  | { op: 'set-grants'; memberId: string; email: string; capabilities: string[]; extensions: string[] }

export interface MemberReconcilePlan {
  steps: MemberReconcileStep[]
  toCreate: string[]
}

/** True when the member's stored grants already contain every declared one. */
function grantsContained(
  declared: { capabilities: string[]; extensions: string[] },
  current: { capabilities: string[]; extensions: string[] } | undefined,
): boolean {
  const cur = current ?? { capabilities: [], extensions: [] }
  return declared.capabilities.every((c) => cur.capabilities.includes(c))
    && declared.extensions.every((e) => cur.extensions.includes(e))
}

/**
 * The steps that take `existing` to `desired`. Members the declaration does
 * not name are left alone: the declaration adds and adjusts, it never removes.
 * When `deploymentRole` is given, declared grants that apply to this deployment
 * are unioned onto existing members (a `set-grants` step) unless already
 * present. Grants for a member the plan is creating apply on the next reconcile
 * (or are set by the applier right after create), since the member has no id yet.
 */
export function planMemberReconciliation(
  desired: MembersDesiredState,
  existing: ExistingMember[],
  deploymentRole?: DeploymentRole,
): MemberReconcilePlan {
  const steps: MemberReconcileStep[] = []
  const toCreate: string[] = []
  const byEmail = new Map(existing.map((m) => [m.email.toLowerCase(), m]))
  for (const want of desired) {
    const email = want.email.trim().toLowerCase()
    if (!email) continue
    const have = byEmail.get(email)
    if (!have) {
      steps.push({ op: 'create', email, name: want.name ?? null, role: want.role ?? 'editor' })
      toCreate.push(email)
      continue
    }
    if (want.role && want.role !== have.role) {
      steps.push({ op: 'set-role', memberId: have.id, email, from: have.role, to: want.role })
    }
    if (deploymentRole) {
      const declared = resolveDesiredGrants(want, deploymentRole)
      if ((declared.capabilities.length || declared.extensions.length) && !grantsContained(declared, have.grants)) {
        steps.push({ op: 'set-grants', memberId: have.id, email, capabilities: declared.capabilities, extensions: declared.extensions })
      }
    }
  }
  return { steps, toCreate }
}
