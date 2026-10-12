/**
 * File Name: resolve-actor.ts
 * Purpose: Re-resolving a recorded actor's CURRENT authority (kernel plan
 *          §12): the scheduler and a release apply run as the member or key
 *          who asked, with the authority that member or key holds NOW, never
 *          a snapshot taken when they asked. A member who is gone, suspended
 *          or demoted, or a key revoked or expired, resolves to nothing and
 *          the caller refuses the run and records why.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { eq, and, isNull } from 'drizzle-orm'
import { members, apiKeys, identities } from '@tangen/db'
import type { ActorContext } from '@tangen/types'
import { memberActor, apiKeyActor, identityActor } from './actor'
import { resolveMemberPermissions } from '../middleware/auth'

export type ResolvedActor =
  | { ok: true; actor: ActorContext }
  | { ok: false; reason: string }

/** The member's current role and status, as the auth middleware would resolve them for a session. */
export async function resolveMemberActor(
  db: any, redis: any,
  input: { workspaceId: string; memberId: string; project?: { roles?: import('@tangen/types').RoleSeedDefinition[] } },
): Promise<ResolvedActor> {
  const [row] = await db.select({ id: members.id, role: members.role, status: members.status })
    .from(members).where(and(eq(members.id, input.memberId), eq(members.workspaceId, input.workspaceId))).limit(1)
  if (!row) return { ok: false, reason: `member ${input.memberId} is no longer in workspace ${input.workspaceId}` }
  if (row.status === 'suspended') return { ok: false, reason: `member ${input.memberId} is suspended` }
  const permissions = await resolveMemberPermissions(db, redis, input.workspaceId, String(row.role), input.project)
  return { ok: true, actor: memberActor({ memberId: input.memberId, role: String(row.role), workspaceId: input.workspaceId, permissions }) }
}

/** The key's current grants: a revoked or expired key resolves to nothing. */
export async function resolveApiKeyActor(db: any, input: { workspaceId: string; apiKeyId: string }): Promise<ResolvedActor> {
  const [row] = await db.select({ id: apiKeys.id, permissions: apiKeys.permissions, expiresAt: apiKeys.expiresAt })
    .from(apiKeys).where(and(eq(apiKeys.id, input.apiKeyId), eq(apiKeys.workspaceId, input.workspaceId), isNull(apiKeys.revokedAt))).limit(1)
  if (!row) return { ok: false, reason: `API key ${input.apiKeyId} is revoked or gone` }
  if (row.expiresAt && new Date(row.expiresAt as never) < new Date()) return { ok: false, reason: `API key ${input.apiKeyId} has expired` }
  return { ok: true, actor: apiKeyActor({ apiKeyId: input.apiKeyId, workspaceId: input.workspaceId, permissions: row.permissions }) }
}

/** An identity's current authority (K8): a suspended or deleted identity resolves to nothing. */
export async function resolveIdentityActor(db: any, input: { workspaceId: string; identityId: string }): Promise<ResolvedActor> {
  const [row] = await db.select().from(identities)
    .where(and(eq(identities.id, input.identityId), eq(identities.workspaceId, input.workspaceId))).limit(1)
  if (!row) return { ok: false, reason: `identity ${input.identityId} is gone` }
  if (row.status !== 'active') return { ok: false, reason: `identity ${input.identityId} is suspended` }
  return { ok: true, actor: identityActor({ identity: row, workspaceId: input.workspaceId }) }
}

/** A recorded actor id (a member's, a key's or an identity's), resolved to its current authority. */
export async function resolveRecordedActor(
  db: any, redis: any,
  input: { workspaceId: string; actorId: string; project?: { roles?: import('@tangen/types').RoleSeedDefinition[] } },
): Promise<ResolvedActor> {
  if (input.actorId.startsWith('key_')) return resolveApiKeyActor(db, { workspaceId: input.workspaceId, apiKeyId: input.actorId })
  if (input.actorId.startsWith('idn_')) return resolveIdentityActor(db, { workspaceId: input.workspaceId, identityId: input.actorId })
  const member = await resolveMemberActor(db, redis, { workspaceId: input.workspaceId, memberId: input.actorId, project: input.project })
  if (member.ok) return member
  const key = await resolveApiKeyActor(db, { workspaceId: input.workspaceId, apiKeyId: input.actorId })
  return key.ok ? key : member
}
