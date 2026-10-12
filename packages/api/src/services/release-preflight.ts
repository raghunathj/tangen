/**
 * File Name: release-preflight.ts
 * Purpose: Every check an apply, a retry or an inspection runs before a
 *          Release publishes anything, read-only (tasks/remove-environments-programme.md,
 *          stage R4): the release is in the right state, its payload is
 *          frozen and matches the approved checksum, every type still
 *          exists, every extension whose data it carries is active in the
 *          workspace, and no item's draft changed since approval.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { LifecycleExec } from './release-lifecycle'
import { loadFrozenPayload, type FrozenRelease } from './release-approval'
import { readObjectSource, fingerprintObject } from './object-snapshot'

export type PreflightCode = 'RELEASE_STATUS' | 'PAYLOAD' | 'CHECKSUM' | 'TYPES' | 'EXTENSIONS' | 'DRAFT_CONFLICT' | 'PROVIDERS'
export interface PreflightCheck { code: PreflightCode; ok: boolean; detail: string }
export type PreflightMode = 'apply' | 'retry' | 'inspect'

/** Outcomes that count as applied: a retry skips these items. */
export const APPLIED_OUTCOMES: ReadonlySet<string> = new Set(['published', 'unchanged'])

export interface PreflightDeps {
  db: any
  exec: LifecycleExec
  tables: Record<string, any>
  /** Whether an extension is active in the workspace; the default reads the installation table. */
  extensionActive?: (extensionId: string, workspaceId: string) => Promise<boolean>
  /** Extra checks a caller contributes (storage reachable, ...). */
  providers?: (input: { workspaceId: string }) => Promise<PreflightCheck[]>
}

export interface PreflightReport {
  ok: boolean
  checks: PreflightCheck[]
  status: string | null
  pending: Array<{ typeName: string; objectId: string; position: number }>
  alreadyApplied: Array<{ typeName: string; objectId: string; outcome: string }>
  frozen: FrozenRelease | null
}

export async function preflightRelease(deps: PreflightDeps, input: { releaseId: string; workspaceId: string; mode: PreflightMode }): Promise<PreflightReport> {
  const checks: PreflightCheck[] = []
  const check = (code: PreflightCode, ok: boolean, detail: string) => { checks.push({ code, ok, detail }) }
  const [release] = await deps.exec(`SELECT id, status, approved_checksum FROM releases WHERE id = $1 AND workspace_id = $2`, [input.releaseId, input.workspaceId])
  const empty: PreflightReport = { ok: false, checks, status: null, pending: [], alreadyApplied: [], frozen: null }
  if (!release) { check('RELEASE_STATUS', false, `release ${input.releaseId} not found`); return empty }
  const status = String(release.status)
  const wanted = input.mode === 'apply' ? ['approved'] : input.mode === 'retry' ? ['failed'] : ['approved', 'failed']
  check('RELEASE_STATUS', wanted.includes(status), wanted.includes(status) ? `release is ${status}` : `release is ${status}; ${input.mode} needs ${wanted.join(' or ')}`)

  const frozen = await loadFrozenPayload(deps.exec, input.releaseId)
  check('PAYLOAD', frozen !== null, frozen ? `${frozen.order.length} item(s) frozen at approval` : 'no frozen payload: the release is not approved, or its approval was withdrawn')
  const approvedChecksum = release.approved_checksum == null ? null : String(release.approved_checksum)
  if (frozen && approvedChecksum) check('CHECKSUM', frozen.checksum === approvedChecksum, frozen.checksum === approvedChecksum ? `payload checksum ${approvedChecksum.slice(0, 12)} matches the approval` : `payload checksum ${frozen.checksum.slice(0, 12)} differs from the approved ${approvedChecksum.slice(0, 12)}: the stored payload is not what was approved`)
  else check('CHECKSUM', false, approvedChecksum ? 'no payload to verify against the approved checksum' : 'the release records no approved checksum')

  const items = frozen?.order ?? (await deps.exec(`SELECT type_name, object_id FROM release_items WHERE release_id = $1 ORDER BY type_name, object_id`, [input.releaseId])).map((r, i) => ({ id: '', typeName: String(r.type_name), objectId: String(r.object_id), position: i, fingerprint: null }))
  const missingTypes = [...new Set(items.filter((i) => !deps.tables[i.typeName]).map((i) => i.typeName))]
  check('TYPES', missingTypes.length === 0, missingTypes.length === 0 ? `${[...new Set(items.map((i) => i.typeName))].length} type(s) present` : `type(s) no longer in the schema: ${missingTypes.join(', ')}`)

  const extIds = frozen ? [...new Set(Object.values(frozen.frozen).flatMap((f) => f.ext.map((e) => String((e as Record<string, unknown>).extensionId ?? (e as Record<string, unknown>).extension_id))))].sort() : []
  const inactive: string[] = []
  for (const id of extIds) if (!(await (deps.extensionActive ?? defaultExtensionActive(deps.exec))(id, input.workspaceId))) inactive.push(id)
  check('EXTENSIONS', inactive.length === 0, extIds.length === 0 ? 'the payload carries no extension data' : inactive.length === 0 ? `active here: ${extIds.join(', ')}` : `not active in this workspace: ${inactive.join(', ')}`)

  const outcomes = new Map((await deps.exec(`SELECT type_name, object_id, apply_outcome FROM release_items WHERE release_id = $1`, [input.releaseId])).map((r) => [`${r.type_name}/${r.object_id}`, r.apply_outcome == null ? null : String(r.apply_outcome)]))
  const alreadyApplied: PreflightReport['alreadyApplied'] = []
  const pending: PreflightReport['pending'] = []
  const conflicts: string[] = []
  for (const item of items) {
    const outcome = outcomes.get(`${item.typeName}/${item.objectId}`)
    if (input.mode !== 'apply' && outcome && APPLIED_OUTCOMES.has(outcome)) { alreadyApplied.push({ typeName: item.typeName, objectId: item.objectId, outcome }); continue }
    pending.push({ typeName: item.typeName, objectId: item.objectId, position: item.position })
    const table = deps.tables[item.typeName]
    if (!table || !frozen || item.fingerprint === null) continue
    const now = fingerprintObject(await readObjectSource(deps.db, input.workspaceId, item.typeName, table, item.objectId))
    if (now !== item.fingerprint) conflicts.push(`${item.typeName}/${item.objectId}`)
  }
  check('DRAFT_CONFLICT', conflicts.length === 0, conflicts.length === 0 ? `${pending.length} draft(s) unchanged since approval` : `changed since approval: ${conflicts.join(', ')} - approve again to review the current draft`)
  for (const c of await (deps.providers?.({ workspaceId: input.workspaceId }) ?? Promise.resolve([]))) checks.push(c)
  return { ok: checks.every((c) => c.ok), checks, status, pending, alreadyApplied, frozen }
}

function defaultExtensionActive(exec: LifecycleExec): NonNullable<PreflightDeps['extensionActive']> {
  return async (extensionId, workspaceId) => {
    try {
      const rows = await exec(`SELECT 1 FROM workspace_installed_apps WHERE workspace_id = $1 AND app_id = $2 AND state = 'installed' AND enabled`, [workspaceId, extensionId])
      return rows.length > 0
    } catch { return false }   // cannot verify: not active, as far as this preflight can tell
  }
}
