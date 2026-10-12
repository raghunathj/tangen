/**
 * File Name: members-reconcile.ts
 * Purpose: Reconciles the desired membership a project declares
 *          (`app/config/members.ts`) into this deployment's database: creates
 *          the members that are missing without a credential, adjusts a
 *          workspace role that differs, unions declared per-deployment grants
 *          onto members, and leaves everyone else alone.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The plan is @tangen/types' planMemberReconciliation;
 *          this module only applies it. Declared grants are ADDITIVE (unioned,
 *          never removed) and scoped to this deployment's role. Runs at boot for
 *          every project.
 */
import { randomBytes } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { members, memberGrants } from '@tangen/db'
import { planMemberReconciliation, resolveDesiredGrants, type ExistingMember, type MembersDesiredState, type MemberReconcilePlan, type DeploymentRole } from '@tangen/types'
import { unusablePasswordHash } from './porter-members'

export interface ReconcileResult { plan: MemberReconcilePlan; created: number; applied: number }

export async function readExistingMembers(db: any, workspaceId: string): Promise<ExistingMember[]> {
  const rows = await db.select({ id: members.id, email: members.email, role: members.role }).from(members).where(eq(members.workspaceId, workspaceId)) as ExistingMember[]
  // Attach current grants so the planner can diff and skip no-op set-grants.
  const grantRows = await db.select({ memberId: memberGrants.memberId, capabilities: memberGrants.capabilities, extensions: memberGrants.extensions })
    .from(memberGrants).where(eq(memberGrants.workspaceId, workspaceId)) as Array<{ memberId: string; capabilities: string[]; extensions: string[] }>
  const byMember = new Map(grantRows.map((g) => [g.memberId, { capabilities: g.capabilities ?? [], extensions: g.extensions ?? [] }]))
  for (const m of rows) m.grants = byMember.get(m.id)
  return rows
}

/** Unions the given capabilities/extensions onto a member's grant row (additive). */
async function applyGrantUnion(db: any, workspaceId: string, memberId: string, addCaps: string[], addExts: string[]): Promise<void> {
  if (addCaps.length === 0 && addExts.length === 0) return
  const [cur] = await db.select().from(memberGrants)
    .where(and(eq(memberGrants.workspaceId, workspaceId), eq(memberGrants.memberId, memberId))).limit(1)
  const capabilities = [...new Set([...(cur?.capabilities ?? []), ...addCaps])]
  const extensions = [...new Set([...(cur?.extensions ?? []), ...addExts])]
  const now = new Date()
  await db.insert(memberGrants)
    .values({ workspaceId, memberId, capabilities, extensions, grantedBy: 'reconcile', updatedAt: now })
    .onConflictDoUpdate({ target: [memberGrants.workspaceId, memberGrants.memberId], set: { capabilities, extensions, updatedAt: now } })
}

export async function reconcileMembers(
  db: any,
  input: { workspaceId: string; desired: MembersDesiredState; deploymentRole?: DeploymentRole },
): Promise<ReconcileResult> {
  const existing = await readExistingMembers(db, input.workspaceId)
  const plan = planMemberReconciliation(input.desired, existing, input.deploymentRole)
  const desiredByEmail = new Map(input.desired.map((m) => [m.email.trim().toLowerCase(), m]))
  let created = 0
  let applied = 0
  for (const step of plan.steps) {
    if (step.op === 'create') {
      const id = `mem_${randomBytes(9).toString('hex')}`
      await db.insert(members).values({ id, workspaceId: input.workspaceId, email: step.email, name: step.name, role: step.role, passwordHash: unusablePasswordHash() })
      created++; applied++
      // A created member has no id until now, so the planner could not emit its
      // set-grants; apply the member's declared grants for this deployment here.
      if (input.deploymentRole) {
        const want = desiredByEmail.get(step.email)
        if (want) {
          const g = resolveDesiredGrants(want, input.deploymentRole)
          await applyGrantUnion(db, input.workspaceId, id, g.capabilities, g.extensions)
        }
      }
    } else if (step.op === 'set-role') {
      await db.update(members).set({ role: step.to }).where(eq(members.id, step.memberId))
      applied++
    } else if (step.op === 'set-grants') {
      await applyGrantUnion(db, input.workspaceId, step.memberId, step.capabilities, step.extensions)
      applied++
    }
  }
  return { plan, created, applied }
}
