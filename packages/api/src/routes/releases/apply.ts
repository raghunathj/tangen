/**
 * File Name: apply.ts
 * Purpose: POST /api/v1/releases/:id/apply and /retry - publish an approved
 *          Release in place through the runner: preflight, every pending item
 *          through the one publish path, history, event.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { runReleaseApply, type RunDeps } from '../../services/release-runner'
import { ReleaseStateError } from '../../services/release-lifecycle'
import { releasePreflightDeps } from './lifecycle'

export function releaseRunDeps(ctx: any): RunDeps {
  return {
    ...releasePreflightDeps(ctx),
    engine: { eventBus: ctx.eventBus, redis: ctx.redis, schema: ctx.schema, projects: (ctx.workspaceProjects ?? []) as never[] },
  }
}

async function attempt(ctx: any, action: 'apply' | 'retry') {
  const { workspaceId, memberId, params } = ctx
  if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)
  requireCapability({ permissions: ctx.permissions, memberId }, 'releases:apply')
  try {
    // K4: the publishes run with this session's current authority.
    const out = await runReleaseApply(releaseRunDeps(ctx), { releaseId: params.id, workspaceId, actor: memberId, action, authority: { memberRole: ctx.memberRole ?? null, permissions: ctx.permissions } })
    const results = out.stage === 'preflight' ? [] : out.results
    return {
      applied: out.ok, stage: out.stage, attempt: out.stage === 'preflight' ? null : out.attempt, historyId: out.historyId,
      preflight: out.stage === 'preflight' ? out.preflight : null,
      failure: out.stage === 'failed' ? out.failure : null,
      results,
      published: results.filter((r) => r.outcome === 'published').length,
      unchanged: results.filter((r) => r.outcome === 'unchanged').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
    }
  } catch (e) {
    if (e instanceof ReleaseStateError) throw new RequestError('CONFLICT', e.message, 409)
    throw e
  }
}

export const releaseApplyRoute = (app: Elysia) =>
  app
    .post('/api/v1/releases/:id/apply', (ctx: any) => attempt(ctx, 'apply'))
    .post('/api/v1/releases/:id/retry', (ctx: any) => attempt(ctx, 'retry'))
