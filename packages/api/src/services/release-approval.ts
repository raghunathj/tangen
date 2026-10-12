/**
 * File Name: release-approval.ts
 * Purpose: Approval freezes a Release (tasks/remove-environments-programme.md,
 *          stage R4): the draft of every item - row, translations, labels,
 *          extension data - is stored on the item as `frozen_payload`, its
 *          fingerprint as `target_fingerprint`, and the checksum of the whole
 *          set on the release. What is reviewed is what publishes: a draft
 *          that changes after approval fails the apply preflight.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { createHash } from 'node:crypto'
import { transitionRelease, type LifecycleExec } from './release-lifecycle'
import { readObjectSource, fingerprintObject, canonicalJson, type FrozenObjectSource } from './object-snapshot'

/** Items in a stable order: by type name, then object id. */
export function orderReleaseItems<T extends { typeName: string; objectId: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.typeName.localeCompare(b.typeName) || a.objectId.localeCompare(b.objectId))
}

/**
 * One checksum over the ordered items and their frozen payloads, in the
 * canonical JSON form: the payload is hashed at approval from memory and
 * again from jsonb, which keeps neither key order nor the difference between
 * a Date and its ISO string.
 */
export function releaseChecksum(items: Array<{ typeName: string; objectId: string; payload: unknown }>): string {
  const h = createHash('sha256')
  for (const i of orderReleaseItems(items)) h.update(`${i.typeName}/${i.objectId}\n${canonicalJson(i.payload)}\n`)
  return h.digest('hex')
}

export interface ApproveDeps {
  db: any
  exec: LifecycleExec
  tables: Record<string, any>
}

export interface ApproveResult { checksum: string; items: number; historyId: string }

export class ReleaseApprovalError extends Error {
  readonly status: number
  constructor(readonly kind: 'not found' | 'state' | 'items', message: string) {
    super(message)
    this.status = kind === 'not found' ? 404 : kind === 'state' ? 409 : 422
  }
}

export async function approveRelease(deps: ApproveDeps, input: { releaseId: string; workspaceId: string; actor: string | null }): Promise<ApproveResult> {
  const [release] = await deps.exec(`SELECT id, status FROM releases WHERE id = $1 AND workspace_id = $2`, [input.releaseId, input.workspaceId])
  if (!release) throw new ReleaseApprovalError('not found', `release ${input.releaseId} not found`)
  if (release.status !== 'in_review') throw new ReleaseApprovalError('state', `release ${input.releaseId} cannot approve while ${String(release.status)}: allowed from in_review`)
  const rows = await deps.exec(`SELECT id, object_id, type_name FROM release_items WHERE release_id = $1`, [input.releaseId])
  const items = orderReleaseItems(rows.map((r) => ({ id: String(r.id), objectId: String(r.object_id), typeName: String(r.type_name) })))
  if (items.length === 0) throw new ReleaseApprovalError('items', `release ${input.releaseId} has no items to approve`)
  const frozen: Array<{ item: (typeof items)[number]; source: FrozenObjectSource; fingerprint: string }> = []
  const problems: string[] = []
  for (const item of items) {
    const table = deps.tables[item.typeName]
    if (!table) { problems.push(`${item.typeName}/${item.objectId}: type "${item.typeName}" is not in the schema`); continue }
    const source = await readObjectSource(deps.db, input.workspaceId, item.typeName, table, item.objectId)
    if (!source) { problems.push(`${item.typeName}/${item.objectId}: no longer exists - remove the item and submit again`); continue }
    frozen.push({ item, source, fingerprint: fingerprintObject(source) })
  }
  if (problems.length > 0) throw new ReleaseApprovalError('items', `release ${input.releaseId} cannot be approved:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  const checksum = releaseChecksum(frozen.map((f) => ({ typeName: f.item.typeName, objectId: f.item.objectId, payload: f.source })))
  for (const [position, f] of frozen.entries()) {
    await deps.exec(`UPDATE release_items SET frozen_payload = $1::jsonb, target_fingerprint = $2, position = $3, apply_outcome = NULL, applied_at = NULL, apply_error = NULL WHERE id = $4`, [JSON.stringify(f.source), f.fingerprint, position, f.item.id])
  }
  const t = await transitionRelease(deps.exec, {
    releaseId: input.releaseId, workspaceId: input.workspaceId, action: 'approve', actor: input.actor,
    set: { approved_at: new Date(), approved_by: input.actor, approved_checksum: checksum },
    history: { checksum, counts: { items: frozen.length } },
  })
  return { checksum, items: frozen.length, historyId: t.historyId }
}

export async function unapproveRelease(deps: Pick<ApproveDeps, 'exec'>, input: { releaseId: string; workspaceId: string; actor: string | null; reason?: string | null }): Promise<{ historyId: string }> {
  const t = await transitionRelease(deps.exec, {
    releaseId: input.releaseId, workspaceId: input.workspaceId, action: 'unapprove', actor: input.actor, reason: input.reason ?? null,
    set: { approved_at: null, approved_by: null, approved_checksum: null, scheduled_at: null, scheduled_by: null },
  })
  await deps.exec(`UPDATE release_items SET frozen_payload = NULL, target_fingerprint = NULL, position = NULL WHERE release_id = $1`, [input.releaseId])
  return { historyId: t.historyId }
}

export interface FrozenRelease {
  order: Array<{ id: string; objectId: string; typeName: string; position: number; fingerprint: string | null }>
  frozen: Record<string, FrozenObjectSource>
  checksum: string
}

/** The approved payload as stored, in apply order; null when the release is not approved. */
export async function loadFrozenPayload(exec: LifecycleExec, releaseId: string): Promise<FrozenRelease | null> {
  const rows = await exec(`SELECT id, object_id, type_name, frozen_payload, target_fingerprint, position FROM release_items WHERE release_id = $1 ORDER BY position, type_name, object_id`, [releaseId])
  const order: FrozenRelease['order'] = []
  const frozen: Record<string, FrozenObjectSource> = {}
  for (const r of rows) {
    if (r.frozen_payload == null || r.position == null) return null
    order.push({ id: String(r.id), objectId: String(r.object_id), typeName: String(r.type_name), position: Number(r.position), fingerprint: (r.target_fingerprint as string | null) ?? null })
    frozen[String(r.object_id)] = (typeof r.frozen_payload === 'string' ? JSON.parse(r.frozen_payload) : r.frozen_payload) as FrozenObjectSource
  }
  if (order.length === 0) return null
  return { order, frozen, checksum: releaseChecksum(order.map((o) => ({ typeName: o.typeName, objectId: o.objectId, payload: frozen[o.objectId] }))) }
}
