/**
 * File Name: release-runner.ts
 * Purpose: One apply or retry of a Release, end to end: preflight, the
 *          transition into applying, every pending item through the in-place
 *          publish, the outcome on each item, the transition to applied or
 *          failed with a history row, and the event. A failure stops at the
 *          item that failed and records what came before it; a retry skips
 *          what already applied.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { randomUUID } from 'node:crypto'
import { preflightRelease, type PreflightDeps, type PreflightReport } from './release-preflight'
import { transitionRelease, recordReleaseHistory, type ReleaseStatus } from './release-lifecycle'
import { applyReleaseItem, type EngineInput, type ReleaseItemResult } from './release-apply'
import { resolveMemberActor } from '../kernel/resolve-actor'
import { legacyIdentityOf } from '../kernel/actor'
import { memberActor } from '../kernel/actor'
import { createExecution } from '../kernel/execution'

export interface ReleaseFailure {
  stage: 'apply'
  attempt: number
  item: { typeName: string; objectId: string; position: number }
  error: string
  appliedBefore: number
  remaining: number
}

export type RunOutcome =
  | { stage: 'preflight'; ok: false; preflight: Omit<PreflightReport, 'frozen'>; historyId: string }
  | { stage: 'applied'; ok: true; attempt: number; results: ReleaseItemResult[]; skipped: number; historyId: string }
  | { stage: 'failed'; ok: false; attempt: number; results: ReleaseItemResult[]; failure: ReleaseFailure; historyId: string }

export interface RunDeps extends PreflightDeps {
  engine: Omit<EngineInput, 'db' | 'workspaceId' | 'releaseId' | 'tables' | 'memberId'>
  applyItem?: typeof applyReleaseItem
}

function counts(results: ReleaseItemResult[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of results) out[r.outcome] = (out[r.outcome] ?? 0) + 1
  return out
}

/** The applier's authority for the publishes: their session's (the route), re-resolved (the scheduler), or none recorded (a release scheduled before scheduled_by existed). */
export type ApplyAuthority = { memberRole: string | null; permissions: unknown } | null | undefined

export async function runReleaseApply(deps: RunDeps, input: { releaseId: string; workspaceId: string; actor: string; action: 'apply' | 'retry'; authority?: ApplyAuthority }): Promise<RunOutcome> {
  const report = await preflightRelease(deps, { releaseId: input.releaseId, workspaceId: input.workspaceId, mode: input.action })
  const { frozen, ...visible } = report
  if (!report.ok || !frozen) {
    const status = (report.status ?? 'draft') as ReleaseStatus
    const historyId = await recordReleaseHistory(deps.exec, {
      releaseId: input.releaseId, workspaceId: input.workspaceId, action: 'preflight-failed', from: status, to: status, actor: input.actor,
      errorSummary: report.checks.filter((c) => !c.ok).map((c) => `${c.code}: ${c.detail}`).join('; ').slice(0, 2000),
    })
    return { stage: 'preflight', ok: false, preflight: visible, historyId }
  }
  const [row] = await deps.exec(`SELECT attempts FROM releases WHERE id = $1`, [input.releaseId])
  const attempt = Number(row?.attempts ?? 0) + 1
  await transitionRelease(deps.exec, {
    releaseId: input.releaseId, workspaceId: input.workspaceId, action: input.action, actor: input.actor,
    set: { applying_started_at: new Date(), attempts: attempt, failure: null, failed_at: null },
    history: { attempt, checksum: frozen.checksum, counts: { pending: report.pending.length, alreadyApplied: report.alreadyApplied.length } },
  })
  // K4: the release publishes as the applying member with the authority they
  // hold NOW - the session's when a member clicks, re-resolved when the
  // scheduler applies; a member who lost it is refused on every item. A
  // release scheduled before scheduled_by existed (authority null) applies
  // once with no grant check, as it always did.
  let authorityLost: string | null = null
  let granted: { memberRole: string | null; permissions: unknown } | null = input.authority === null ? null : (input.authority ?? null)
  if (input.authority === undefined) {
    const resolved = await resolveMemberActor(deps.db, (deps.engine as { redis?: unknown }).redis ?? null, {
      workspaceId: input.workspaceId, memberId: input.actor,
      project: ((deps.engine as { projects?: any[] }).projects ?? []).find((p: any) => p.workspaceId === input.workspaceId),
    }).catch((e) => ({ ok: false as const, reason: e instanceof Error ? e.message : String(e) }))
    if (resolved.ok) { const id = legacyIdentityOf(resolved.actor); granted = { memberRole: id.memberRole, permissions: id.permissions } }
    else authorityLost = resolved.reason
  }
  const releaseActor = memberActor({ memberId: input.actor, role: granted?.memberRole ?? null, workspaceId: input.workspaceId, permissions: (granted?.permissions ?? {}) as never })
  const engine: EngineInput = {
    ...deps.engine, db: deps.db, workspaceId: input.workspaceId, releaseId: input.releaseId, tables: deps.tables, memberId: input.actor,
    ...(granted ? { memberRole: granted.memberRole, permissions: granted.permissions } : {}),
    // K5: every publish of this release rides one release execution.
    exec: createExecution({ kind: 'release', source: 'release', workspaceId: input.workspaceId, actor: releaseActor, correlationId: `release:${input.releaseId}` }),
  }
  const results: ReleaseItemResult[] = []
  const apply = deps.applyItem ?? applyReleaseItem
  for (const [i, item] of report.pending.entries()) {
    let result: ReleaseItemResult
    if (authorityLost) result = { objectId: item.objectId, outcome: 'failed', error: `AUTHORITY_LOST: ${authorityLost}` }
    else {
      try { result = await apply(engine, item, frozen.frozen[item.objectId]!) }
      catch (e) { result = { objectId: item.objectId, outcome: 'failed', error: e instanceof Error ? e.message : String(e) } }
    }
    results.push(result)
    await deps.exec(`UPDATE release_items SET apply_outcome = $1, applied_at = now(), apply_error = $2 WHERE release_id = $3 AND type_name = $4 AND object_id = $5`,
      [result.outcome, result.error ?? null, input.releaseId, item.typeName, item.objectId])
    if (result.outcome === 'failed') {
      const failure: ReleaseFailure = { stage: 'apply', attempt, item, error: result.error ?? 'failed', appliedBefore: i, remaining: report.pending.length - i - 1 }
      const t = await transitionRelease(deps.exec, {
        releaseId: input.releaseId, workspaceId: input.workspaceId, action: 'apply-failed', actor: input.actor,
        set: { failed_at: new Date(), failure: JSON.stringify(failure) },
        history: { attempt, checksum: frozen.checksum, counts: counts(results), errorSummary: `${item.typeName}/${item.objectId}: ${failure.error}`.slice(0, 2000) },
      })
      emit(deps, input, 'failed', results)
      return { stage: 'failed', ok: false, attempt, results, failure, historyId: t.historyId }
    }
  }
  const t = await transitionRelease(deps.exec, {
    releaseId: input.releaseId, workspaceId: input.workspaceId, action: 'applied', actor: input.actor,
    set: { applied_at: new Date(), applied_by: input.actor },
    history: { attempt, checksum: frozen.checksum, counts: { ...counts(results), skipped: report.alreadyApplied.length } },
  })
  emit(deps, input, 'applied', results)
  return { stage: 'applied', ok: true, attempt, results, skipped: report.alreadyApplied.length, historyId: t.historyId }
}

function emit(deps: RunDeps, input: { releaseId: string; workspaceId: string; actor: string }, status: 'applied' | 'failed', results: ReleaseItemResult[]) {
  deps.engine.eventBus?.emit({
    id: randomUUID(), type: 'release.published', workspaceId: input.workspaceId, timestamp: new Date().toISOString(), actorId: input.actor, actorType: 'member',
    payload: {
      releaseId: input.releaseId, status,
      published: results.filter((r) => r.outcome === 'published').length,
      unchanged: results.filter((r) => r.outcome === 'unchanged').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
    },
  })
}
