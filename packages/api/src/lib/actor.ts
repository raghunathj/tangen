/**
 * File Name: actor.ts
 * Purpose: A1 — THE actor-resolution rule for content writes. Every audit column
 *   (created_by / updated_by / published_by) and event payload resolves the acting
 *   identity the same way: admin member first, API key second, null for system
 *   writes (scheduler). Fixes the split-brain where create used only the API key
 *   (admin creates stored NULL) while update used only the member.
 *
 * Author: Raghunath J
 * License: MIT
 */

// K1: this module is the adapter between the kernel's ActorContext and the
// three shapes older code reads (an attribution id, a hook actor, the request
// decorations). New code takes the actor from ctx.exec and uses the kernel.
export { attributionIdOf, hookActorOf, legacyIdentityOf } from '../kernel/actor'

/** The id to store in audit columns: member (admin session) → API key (REST) → null. */
export function resolveActorId(
  memberId: string | null | undefined,
  apiKeyId: string | null | undefined,
): string | null {
  return memberId ?? apiKeyId ?? null
}

// ── Audit display (A2) — resolve WHO the audit ids are, for the admin editor ──
import { inArray } from 'drizzle-orm'
import { members, apiKeys } from '@tangen/db'
import { hookActorOf } from '../kernel/actor'
import type { ExecutionContext } from '@tangen/types'

export interface ActorLabel { label: string | null; kind: 'member' | 'api_key' }
/** One attribution: the actor's id when it has one, its kind (K5: the row's `*_by_kind` column, so a system actor shows as such), and a label when resolvable. */
export interface AuditActor { id: string | null; label: string | null; kind: 'member' | 'api_key' | 'system' | 'site_user' | null }
export interface AuditInfo {
  created_by: AuditActor | null
  updated_by: AuditActor | null
  published_by: AuditActor | null
}

/** The audit actor ids present on a row (drizzle camelCase or raw-SQL snake_case). */
export function pickAuditActorIds(row: Record<string, unknown>): string[] {
  const ids = [
    row.createdBy ?? row.created_by,
    row.updatedBy ?? row.updated_by,
    row.publishedBy ?? row.published_by,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)
  return [...new Set(ids)]
}

/** Resolve actor ids to display labels: members by name/email, API keys by key name. */
export async function resolveActorLabels(db: any, ids: string[]): Promise<Map<string, ActorLabel>> {
  const out = new Map<string, ActorLabel>()
  if (ids.length === 0) return out
  const memberRows = await db
    .select({ id: members.id, name: members.name, email: members.email })
    .from(members).where(inArray(members.id, ids))
  for (const m of memberRows) out.set(m.id, { label: m.name ?? m.email, kind: 'member' })
  const remaining = ids.filter((id) => !out.has(id))
  if (remaining.length > 0) {
    const keyRows = await db
      .select({ id: apiKeys.id, label: apiKeys.label })
      .from(apiKeys).where(inArray(apiKeys.id, remaining))
    for (const k of keyRows) out.set(k.id, { label: k.label ?? 'API key', kind: 'api_key' })
  }
  return out
}

/** Shape the admin-only audit block. Unknown ids still surface (legacy/deleted actors). */
export function buildAudit(row: Record<string, unknown>, labels: Map<string, ActorLabel>): AuditInfo {
  const one = (camel: string, snake: string): AuditActor | null => {
    const id = (row[camel] ?? row[snake]) as string | null | undefined
    const kindCol = (row[`${camel}Kind`] ?? row[`${snake}_kind`]) as AuditActor['kind'] | undefined
    if (!id) return kindCol ? { id: null, label: kindCol === 'system' ? 'Tangen' : null, kind: kindCol } : null
    const l = labels.get(id)
    return { id, label: l?.label ?? null, kind: l?.kind ?? kindCol ?? null }
  }
  return {
    created_by: one('createdBy', 'created_by'),
    updated_by: one('updatedBy', 'updated_by'),
    published_by: one('publishedBy', 'published_by'),
  }
}

/**
 * Builds the ContentHookCtx.actor for a write (C2): member session -> admin,
 * API key -> rest, neither (scheduler, in-process local client) -> system.
 */
export function hookActor(
  memberId?: string | null,
  apiKeyId?: string | null,
  role?: string | null,
  exec?: ExecutionContext | null,
): { memberId?: string; apiKeyId?: string; identityId?: string; identityKind?: 'service' | 'agent'; role?: string; source: 'admin' | 'rest' | 'system' } {
  // K8: the execution names the actor exactly (an identity is neither a member nor a key).
  if (exec?.actor && exec.actor.identity.kind !== 'system') return hookActorOf(exec.actor) as never
  if (memberId) return { memberId, ...(role ? { role } : {}), source: 'admin' }
  if (apiKeyId) return { apiKeyId, source: 'rest' }
  return { source: 'system' }
}
