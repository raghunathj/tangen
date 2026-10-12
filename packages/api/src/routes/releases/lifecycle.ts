/**
 * File Name: lifecycle.ts
 * Purpose: The review half of the release state machine over HTTP (closure
 *          plan Phase 5B, Unit 2): POST /api/v1/releases/:id/submit (draft
 *          -> in_review) and /withdraw (in_review -> draft). Approval,
 *          application, scheduling and retry follow in their units; there
 *          is no status setter and never will be.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `releases:review` (or admin) submits and withdraws.
 *          Every transition goes through transitionRelease, which refuses a
 *          step the current status does not allow with a 409 naming it.
 */
import type { PreflightCheck } from '../../services/release-preflight'
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { transitionRelease, lifecycleExecFromDb, readReleaseHistory, ReleaseStateError, type ReleaseAction } from '../../services/release-lifecycle'
import { approveRelease, unapproveRelease, ReleaseApprovalError } from '../../services/release-approval'
import { contentTables } from '@tangen/db/content-tables'
import { preflightRelease, type PreflightDeps } from '../../services/release-preflight'
import { scheduleRelease, unscheduleRelease, ReleaseScheduleError } from '../../services/release-scheduler'
import { wakeScheduler } from '../../runtime/process'

export async function runTransition(ctx: any, action: ReleaseAction, capability: 'releases:review' | 'releases:approve' | 'releases:apply', extra?: { set?: Record<string, unknown>; reason?: string | null }) {
  const { db, workspaceId, memberId, params } = ctx
  if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)
  requireCapability({ permissions: ctx.permissions, memberId }, capability)
  const exec = lifecycleExecFromDb(db)
  const [release] = await exec(`SELECT id FROM releases WHERE id = $1 AND workspace_id = $2`, [params.id, workspaceId])
  if (!release) throw new RequestError('NOT_FOUND', 'Release not found', 404)
  try {
    const t = await transitionRelease(exec, { releaseId: params.id, workspaceId, action, actor: memberId, set: extra?.set, reason: extra?.reason ?? null })
    return { data: { releaseId: params.id, from: t.from, to: t.to, historyId: t.historyId } }
  } catch (e) {
    if (e instanceof ReleaseStateError) throw new RequestError('CONFLICT', e.message, 409)
    throw e
  }
}

/** The preflight's dependencies as the routes bind them: the database, the lifecycle exec and the content tables. */
export function releasePreflightDeps(ctx: any): PreflightDeps {
  const { db } = ctx
  return { db, exec: lifecycleExecFromDb(db), tables: contentTables as Record<string, any> }
}

export const releaseLifecycleRoutes = (app: Elysia) =>
  app
    .post('/api/v1/releases/:id/submit', (ctx: any) => runTransition(ctx, 'submit', 'releases:review', { set: { submitted_at: new Date(), submitted_by: ctx.memberId ?? null } }))
    .post('/api/v1/releases/:id/withdraw', (ctx: any) => runTransition(ctx, 'withdraw', 'releases:review', { reason: typeof ctx.body?.reason === 'string' ? ctx.body.reason : null }))
    // APPROVE freezes the payload (Unit 3): what is reviewed is what will be applied.
    .post('/api/v1/releases/:id/approve', async (ctx: any) => {
      const { db, workspaceId, memberId, params } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)
      requireCapability({ permissions: ctx.permissions, memberId }, 'releases:approve')
      try {
        const r = await approveRelease({ db, exec: lifecycleExecFromDb(db), tables: contentTables as Record<string, any> }, { releaseId: params.id, workspaceId, actor: memberId })
        return { data: { releaseId: params.id, status: 'approved', checksum: r.checksum, items: r.items, historyId: r.historyId } }
      } catch (e) {
        if (e instanceof ReleaseApprovalError) throw new RequestError(e.status === 404 ? 'NOT_FOUND' : e.status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', e.message, e.status)
        if (e instanceof ReleaseStateError) throw new RequestError('CONFLICT', e.message, 409)
        throw e
      }
    })
    // HISTORY (Unit 9): every transition, refused preflight and schedule, oldest first.
    .get('/api/v1/releases/:id/history', async (ctx: any) => {
      const { db, workspaceId, memberId, params } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)
      const exec = lifecycleExecFromDb(db)
      const [release] = await exec(`SELECT id FROM releases WHERE id = $1 AND workspace_id = $2`, [params.id, workspaceId])
      if (!release) throw new RequestError('NOT_FOUND', 'Release not found', 404)
      return { data: await readReleaseHistory(exec, params.id, workspaceId) }
    })
    // PREFLIGHT (Unit 5): the report the apply would act on, read-only.
    .post('/api/v1/releases/:id/preflight', async (ctx: any) => {
      const { db, workspaceId, memberId, params } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)
      requireCapability({ permissions: ctx.permissions, memberId }, 'releases:review')
      const report = await preflightRelease(releasePreflightDeps(ctx), { releaseId: params.id, workspaceId, mode: 'inspect' })
      if (report.status === null) throw new RequestError('NOT_FOUND', 'Release not found', 404)
      const { frozen: _frozen, ...rest } = report
      return { data: rest }
    })
    // SCHEDULE (Unit 8): an approved release applies itself at a time, through the Phase 3 scheduler.
    .post('/api/v1/releases/:id/schedule', async (ctx: any) => {
      const { db, workspaceId, memberId, params } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)
      requireCapability({ permissions: ctx.permissions, memberId }, 'releases:apply')
      const raw = ctx.body?.scheduledAt
      if (typeof raw !== 'string') throw new RequestError('VALIDATION_ERROR', 'Missing required field: scheduledAt', 422)
      try {
        const pf = releasePreflightDeps(ctx)
        const r = await scheduleRelease({ exec: pf.exec, preflight: (releaseId, ws) => preflightRelease(pf, { releaseId, workspaceId: ws, mode: 'apply' }) }, { releaseId: params.id, workspaceId, actor: memberId, at: new Date(raw) })
        // Persisted demand just appeared: a process whose scheduler was idle wakes it now.
        void wakeScheduler().catch(() => {})
        return { data: { releaseId: params.id, status: 'approved', scheduledAt: r.scheduledAt.toISOString(), historyId: r.historyId } }
      } catch (e) {
        if (e instanceof ReleaseScheduleError) throw new RequestError(e.status === 404 ? 'NOT_FOUND' : e.status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', e.message, e.status, undefined, e.preflight ? { preflight: e.preflight } : undefined)
        if (e instanceof ReleaseStateError) throw new RequestError('CONFLICT', e.message, 409)
        throw e
      }
    })
    .post('/api/v1/releases/:id/unschedule', async (ctx: any) => {
      const { db, workspaceId, memberId, params } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)
      requireCapability({ permissions: ctx.permissions, memberId }, 'releases:apply')
      try {
        const r = await unscheduleRelease({ exec: lifecycleExecFromDb(db) }, { releaseId: params.id, workspaceId, actor: memberId, reason: typeof ctx.body?.reason === 'string' ? ctx.body.reason : null })
        return { data: { releaseId: params.id, scheduledAt: null, historyId: r.historyId } }
      } catch (e) {
        if (e instanceof ReleaseScheduleError) throw new RequestError('CONFLICT', e.message, 409)
        throw e
      }
    })
    .post('/api/v1/releases/:id/unapprove', async (ctx: any) => {
      const { db, workspaceId, memberId, params } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)
      requireCapability({ permissions: ctx.permissions, memberId }, 'releases:approve')
      try {
        const r = await unapproveRelease({ exec: lifecycleExecFromDb(db) }, { releaseId: params.id, workspaceId, actor: memberId, reason: typeof ctx.body?.reason === 'string' ? ctx.body.reason : null })
        return { data: { releaseId: params.id, status: 'draft', historyId: r.historyId } }
      } catch (e) {
        if (e instanceof ReleaseStateError) throw new RequestError('CONFLICT', e.message, 409)
        throw e
      }
    })
