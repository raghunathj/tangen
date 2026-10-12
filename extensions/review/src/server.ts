/**
 * File Name: server.ts
 * Purpose: The Review workflow v2 server entry - a multi-stage review state
 *          machine in the extension store (submit/advance/reject/assign +
 *          an admin-configurable workflow definition; rejection RETURNS the
 *          item to its author and a resubmit defaults back to the rejecting
 *          reviewer - an author-reviewer loop), mirrored review:*
 *          labels, and the publish gate: a beforeChange hook that blocks
 *          EVERY publish path (admin, REST, bulk, scheduled, local client)
 *          unless the object sits in the TERMINAL stage AND the content
 *          still matches the hash frozen on entering it. The same
 *          comparison is surfaced PROACTIVELY as `stale` on the state and
 *          queue responses, so a post-approval edit shows up before anyone
 *          hits publish.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: State lives in extension_data keyed by objectId, so
 *          the admin routes (ctx.store) and the hooks (ctx.extensionData)
 *          share rows; the workflow definition shares the store under
 *          __workflow__. There is deliberately NO system bypass - scheduled
 *          publishes of unreviewed content stay scheduled and retry.
 *          v1 records migrate lazily + idempotently on read (state.ts).
 *          Coverage: an admin-saved workflow wins; the code option
 *          `requireReviewFor` seeds it and is the fallback (./coverage).
 *          Transitions (advance/approve-all/assign) live in transitions.ts,
 *          shared with the contributed Flow actions (flow-actions.ts) so a
 *          flow reviews through the SAME state machine as a member.
 */
import { defineExtensionServer } from '@tangen/cms'
import type { ExtensionServerCtx } from '@tangen/types'
import { approvalMatches, isLegacyApproval } from './hash'
import { governingWorkflowForHook, readWorkflowSetForHook, migrateOptionMirror } from './coverage'
import { canActOnStage, normalizeCoveredTypes, planStageReassignments } from './workflow'
import {
  WORKFLOWS_KEY, defaultWorkflow, recordWorkflowId, resolveWorkflowForType, typeOwners,
  validateWorkflowSet, workflowById, workflowForRecord,
  type ReviewWorkflow, type WorkflowSet,
} from './workflows'
import { reviewFlowActions } from './flow-actions'
import {
  advanceStage, asDefinition, assignReviewer, checkStaleApproval, clean, emitActorOpts,
  assertCanActOnStage, actorHistoryEntry, emitStageChanged, getRecord, knownRolesFor, objects, readNote,
  requireActive, requireObjectWorkflow,
  requireTangen, resolveObjectWorkflow, resolveWorkflow, resolveWorkflowSet,
  reviewError, setReviewLabel, type ReviewActor,
 isStageOverride, assertAssigneeCanAct,} from './transitions'
import {
  EXTENSION_ID, WORKFLOW_KEY, DEFAULT_STAGES,
  computeQualification, isReturned, isTerminal, lastRejectedBy, migrateRecord, pushHistory, terminalStage,
  type ReviewRecord, type WorkflowDefinition, type WorkflowStage,
 stageById,} from './state'

export const CLEAR_LABELS_TASK = `ext:${EXTENSION_ID}:clear-labels`

/** Exact gate messages - tests and docs reference these strings. */
export const MSG_NEEDS_APPROVAL = 'Needs approval before publishing - submit for review first'
export const MSG_STALE_APPROVAL = 'Content changed after approval - send it through review again'
/**
 * An approval the host cannot verify, as distinct from one that no longer
 * matches: either it was recorded before approvals were signed, or this
 * deployment cannot sign at all. Same remedy, but saying "content changed"
 * would send an editor looking for an edit that was never made.
 */
export const MSG_UNSIGNED_APPROVAL = 'This approval can no longer be verified - send it through review again'

/** How many completed cycles the queue's Done tab serves. */
export const DONE_LIMIT = 20

// Kept exported here - tests and older imports reference it off the server entry.
export { MAX_NOTE } from './transitions'

interface RouteReq {
  params: Record<string, string>
  query: Record<string, string>
  body?: unknown
  memberId?: string
  can?: (capability: string) => boolean
  /** Env-effective role (platform P1). */
  memberRole?: string | null
  /** Platform role-restriction check (platform P1). */
  actAsRole?: (roles: string[] | null) => boolean
}

/**
 * The calling member as a transition actor, carrying everything the stage
 * guard needs: their workspace role, whether they hold review:approve, and whether
 * the platform treats them as always-allowed (owner/superadmin).
 *
 * `can` is absent only in direct-handler unit tests; the real dispatch always
 * supplies it. Missing reads as "holds the capability" because every caller
 * that reaches these handlers through the mount has already passed whatever
 * route-level gate applies.
 */
function memberActor(req: RouteReq): ReviewActor {
  return {
    byId: req.memberId ?? null,
    role: req.memberRole ?? null,
    isOwner: req.actAsRole?.([]) ?? false,
    canApprove: req.can ? req.can('review:approve') : true,
  }
}

/**
 * Persists a validated workflow-set save and reconciles the in-flight
 * records it affects:
 *   - a DELETED stage sends its items to the previous surviving stage of the
 *     SAME workflow (history note 'Stage removed'),
 *   - a DELETED workflow resets its items out of review entirely with a
 *     System history entry - a removed workflow's stages no longer exist, so
 *     its approvals cannot be defended; the author resubmits.
 * Shared by the v3 set route and the v2-compatible single-workflow route.
 */
async function persistWorkflowSet(
  ctx: ExtensionServerCtx, prevSet: WorkflowSet,
  result: { set: WorkflowSet; removed: ReviewWorkflow[] }, actor: ReviewActor,
): Promise<void> {
  const now = new Date().toISOString()
  const removedNames = new Map(result.removed.map((w) => [w.id, w.name]))
  const plans = new Map<string, Record<string, string>>()
  for (const next of result.set.workflows) {
    const prevWf = workflowById(prevSet, next.id)
    if (!prevWf) continue
    const plan = planStageReassignments(prevWf.stages, next.stages)
    if (Object.keys(plan).length > 0) plans.set(next.id, plan)
  }

  if (plans.size > 0 || removedNames.size > 0) {
    const rows = await ctx.store.list('')
    for (const { key, data } of rows) {
      if (key.startsWith('__')) continue
      const owningId = recordWorkflowId(data as unknown as ReviewRecord, prevSet)
      const owning = workflowById(prevSet, owningId) ?? prevSet.workflows[0]
      const { record } = migrateRecord(data, owning)
      if (!record?.stageId) continue

      if (owningId && removedNames.has(owningId)) {
        const reset: ReviewRecord = {
          ...record, stageId: null, approvedHash: undefined, updatedAt: now,
          history: pushHistory(record.history, {
            from: record.stageId, to: null, byId: null, actorLabel: 'System', at: now,
            note: `Workflow "${removedNames.get(owningId)}" was deleted - submit again`,
          }),
        }
        await ctx.store.put(key, clean(reset))
        emitStageChanged(ctx, { byId: null, actorLabel: 'System' }, key, reset, record.stageId, null)
        continue
      }

      const plan = owningId ? plans.get(owningId) : undefined
      if (!plan || !(record.stageId in plan)) continue
      const target = plan[record.stageId]
      const nextWf = workflowById(result.set, owningId)!
      const moved: ReviewRecord = {
        ...record, stageId: target, updatedAt: now,
        // A stale hash must never survive a forced move.
        approvedHash: target === nextWf.stages[nextWf.stages.length - 1].id ? record.approvedHash : undefined,
        history: pushHistory(record.history, {
          from: record.stageId, to: target, byId: actor.byId, at: now, note: 'Stage removed',
        }),
      }
      await ctx.store.put(key, clean(moved))
      emitStageChanged(ctx, actor, key, moved, record.stageId, target)
    }
  }

  await ctx.store.put(WORKFLOWS_KEY, clean(result.set))
}

/** One workflow as the whole-set validator expects it. */
interface WorkflowInputEntry {
  id?: string
  name?: string
  stages?: unknown
  coveredTypes?: string[] | null
}

/** An already-stored workflow, unchanged, as a validator input entry. */
function asInputEntry(w: ReviewWorkflow): WorkflowInputEntry {
  return { id: w.id, name: w.name, stages: w.stages, coveredTypes: w.coveredTypes }
}

/**
 * Validates a whole candidate set, throwing the first problem as a 422.
 * Shared by the per-workflow routes: they each edit ONE workflow, but type
 * disjointness and the single catch-all default are properties of the SET,
 * so the check can only ever run against all of it.
 */
async function validateSetOrThrow(
  ctx: ExtensionServerCtx, prevSet: WorkflowSet, input: { workflows: WorkflowInputEntry[] },
) {
  const result = validateWorkflowSet(prevSet, input as never, { knownRoles: await knownRolesFor(ctx) })
  if (!result.ok) throw reviewError('VALIDATION_ERROR', result.error)
  return result
}

export default defineExtensionServer({
  /**
   * Tells a surface, BEFORE it offers the button, that this type cannot be
   * published directly. The gate below is still what refuses; this only stops
   * the editor offering an action that would always fail - which is how a new
   * object of a reviewed type ended up with a Publish button that could never
   * work, and a scheduled publish that was accepted and then silently never
   * ran.
   */
  publishPolicy: async (ctx, { typeName, objectId }) => {
    const set = await resolveWorkflowSet(ctx)
    const governing = resolveWorkflowForType(set, typeName)
    if (!governing) return { blocked: false }          // type is not reviewed

    const wf = asDefinition(governing, set.configured)
    // No object yet (creating), or no record: it has not been through review.
    if (!objectId) {
      return {
        blocked: true,
        reason: 'This content type goes through review, so it cannot be published directly. Save it as a draft and submit it for review.',
        actionLabel: 'Save as draft',
      }
    }
    const record = await getRecord(ctx, objectId, wf)
    if (record?.stageId && isTerminal(wf, record.stageId)) {
      // Approved. Staleness is the gate's call at publish time, not a reason
      // to hide the button - the editor already warns about a stale approval.
      return { blocked: false }
    }
    return {
      blocked: true,
      reason: record?.stageId
        ? `Waiting on "${stageById(wf, record.stageId)?.name ?? 'review'}" - it can be published once review completes.`
        : 'Not approved yet. Submit it for review before publishing.',
      actionLabel: 'Save as draft',
      // Offered in place of Publish. Without it a blocked publish is a dead
      // end - the editor can say why, but the thing that unblocks it lives
      // in a panel the user has to go and find.
      ...(record?.stageId ? {} : {
        action: { label: 'Submit for review', path: `submit/${objectId}`, method: 'POST' as const, body: { typeName } },
      }),
    }
  },

  // ── The gate + post-publish cleanup ─────────────────────────────────────
  contentHooks: {
    /**
     * Blocks the draft -> published transition for covered types unless the
     * object sits in the TERMINAL stage and is unchanged since it entered
     * it. Never throws for plain saves, autosaves, non-publish transitions,
     * or uncovered types. No system bypass: the scheduler's auto-publish
     * hits this too and leaves blocked rows scheduled for a later tick.
     */
    beforeChange: async (ctx) => {
      if (ctx.statusChange?.to !== 'published') return
      // Coverage is a property of the TYPE: no governing workflow means the
      // type is not reviewed at all.
      const { set, governing } = await governingWorkflowForHook(ctx)
      if (!governing) return
      const raw = await ctx.extensionData.get(EXTENSION_ID, ctx.objectId)
      const stored = raw as unknown as ReviewRecord | undefined
      // The TERMINAL stage comes from the record's OWN workflow - an
      // in-flight cycle completes under the workflow it started in, even if
      // the type was reassigned since.
      const own = stored ? workflowForRecord({ workflowId: stored.workflowId, typeName: stored.typeName ?? ctx.typeName }, set) : null
      const stages = (own ?? governing).stages
      const { record, changed } = migrateRecord(raw, { stages })
      if (changed && record) await ctx.extensionData.set(EXTENSION_ID, ctx.objectId, clean(record))
      if (!record || record.stageId !== terminalStage({ stages }).id) {
        throw reviewError('REVIEW_REQUIRED', MSG_NEEDS_APPROVAL)
      }
      // The record lives in extension_data, which the Admin's panel-data route
      // writes under ordinary content-write permission, so the stored value is
      // a MAC and not a bare hash: a member can still write the row, but
      // cannot fill it with something that verifies.
      if (isLegacyApproval(record.approvedHash)) {
        throw reviewError('REVIEW_STALE', MSG_UNSIGNED_APPROVAL)
      }
      if (!approvalMatches(ctx.sign, record.approvedHash, ctx.nextData as Record<string, unknown>)) {
        throw reviewError('REVIEW_STALE', ctx.sign ? MSG_STALE_APPROVAL : MSG_UNSIGNED_APPROVAL)
      }
    },

    /**
     * A successful publish completes the cycle: the record resets to
     * stageId null (kept for the queue's Done tab) with a history entry
     * carrying the per-stage qualification snapshot of that cycle (who
     * qualified each stage, and whether the chain was complete - mid-cycle
     * workflow edits can leave gaps).
     */
    afterChange: async (ctx) => {
      if (ctx.statusChange?.to !== 'published') return
      const raw = await ctx.extensionData.get(EXTENSION_ID, ctx.objectId)
      const stored = raw as unknown as ReviewRecord | undefined
      const set = await readWorkflowSetForHook(ctx)
      // The qualification snapshot is proof about THIS cycle, so it is built
      // against the workflow the cycle actually ran under.
      const own = stored ? workflowForRecord({ workflowId: stored.workflowId, typeName: stored.typeName ?? ctx.typeName }, set) : null
      const governing = own ?? resolveWorkflowForType(set, ctx.typeName)
      const stages = governing?.stages ?? DEFAULT_STAGES
      const { record } = migrateRecord(raw, { stages })
      if (!record) return
      const now = new Date().toISOString()
      const completed: ReviewRecord = {
        ...record,
        stageId: null, assigneeId: null,
        approvedHash: undefined, rejectedNote: undefined,
        updatedAt: now,
        history: pushHistory(record.history, {
          from: record.stageId, to: null,
          byId: ctx.actor?.memberId ?? null, at: now, note: 'Published',
          qualification: computeQualification(record.history, { stages, id: governing?.id, name: governing?.name }),
        }),
      }
      await ctx.extensionData.set(EXTENSION_ID, ctx.objectId, clean(completed))
      // Label cleanup needs the content client - hooks don't carry one, so it
      // rides the queue (best-effort UI metadata, not gate state).
      await ctx.enqueue?.(CLEAR_LABELS_TASK, { objectId: ctx.objectId, typeName: ctx.typeName })
    },

    /** Archiving/deleting an object retires its review record entirely. */
    afterDelete: async (ctx) => {
      const raw = await ctx.extensionData.get(EXTENSION_ID, ctx.objectId)
      if (!raw || Object.keys(raw).length === 0) return
      await ctx.extensionData.delete(EXTENSION_ID, ctx.objectId)
      await ctx.enqueue?.(CLEAR_LABELS_TASK, { objectId: ctx.objectId, typeName: ctx.typeName })
    },
  },


  // ── Queue tasks ─────────────────────────────────────────────────────────
  tasks: [{
    name: 'clear-labels',
    description: 'Removes the mirrored review:* labels after a publish completed the review cycle',
    handler: async (payload, ctx) => {
      const { objectId, typeName } = (payload ?? {}) as { objectId?: string; typeName?: string }
      if (!objectId || !typeName || !ctx.tangen) return
      await setReviewLabel(ctx.tangen, typeName, objectId, null)
    },
  }],

  // ── Flow triggers (the Flows builder's catalog, discovery convention) ───
  flowTriggers: [
    {
      type: `ext:${EXTENSION_ID}:submitted`, label: 'Review submitted',
      description: 'An editor submitted an object for review - notify the reviewers.',
      payloadFields: [
        { path: 'payload.objectId', label: 'Object id' },
        { path: 'payload.typeName', label: 'Content type' },
        { path: 'payload.title', label: 'Title' },
        { path: 'payload.actorMemberId', label: 'Submitted by (member id)' },
      ],
    },
    {
      type: `ext:${EXTENSION_ID}:stage-changed`, label: 'Review stage changed',
      description: 'A review item moved between workflow stages (or changed assignee).',
      payloadFields: [
        { path: 'payload.objectId', label: 'Object id' },
        { path: 'payload.typeName', label: 'Content type' },
        { path: 'payload.title', label: 'Title' },
        { path: 'payload.from', label: 'From stage id' },
        { path: 'payload.to', label: 'To stage id' },
        { path: 'payload.byId', label: 'Moved by (member id)' },
        { path: 'payload.assigneeId', label: 'Assignee (member id)' },
        { path: 'payload.workflowId', label: 'Workflow id' },
      ],
    },
    {
      type: `ext:${EXTENSION_ID}:approved`, label: 'Review approved',
      description: 'An item entered the terminal stage - it is ready to publish.',
      payloadFields: [
        { path: 'payload.objectId', label: 'Object id' },
        { path: 'payload.typeName', label: 'Content type' },
        { path: 'payload.title', label: 'Title' },
        { path: 'payload.actorMemberId', label: 'Approved by (member id)' },
      ],
    },
    {
      type: `ext:${EXTENSION_ID}:rejected`, label: 'Review rejected',
      description: 'A reviewer rejected an item back to the author (note required).',
      payloadFields: [
        { path: 'payload.objectId', label: 'Object id' },
        { path: 'payload.typeName', label: 'Content type' },
        { path: 'payload.title', label: 'Title' },
        { path: 'payload.reason', label: 'Reason' },
        { path: 'payload.actorMemberId', label: 'Rejected by (member id)' },
      ],
    },
    {
      type: `ext:${EXTENSION_ID}:withdrawn`, label: 'Review withdrawn',
      description: 'The author pulled their own item back out of review. Not a rejection - nobody judged it.',
      payloadFields: [
        { path: 'payload.objectId', label: 'Object id' },
        { path: 'payload.typeName', label: 'Content type' },
        { path: 'payload.title', label: 'Title' },
        { path: 'payload.note', label: 'Note (optional)' },
        { path: 'payload.actorMemberId', label: 'Withdrawn by (member id)' },
      ],
    },
  ],

  // ── Flow actions (flow-as-reviewer; same discovery convention) ──────────
  // Advance / Approve-for-publishing / Assign, executed by the Flows engine
  // with REVIEW's ctx and attributed as 'Flow: <name>' in the history. They
  // ride the exact transitions the routes use - never a gate bypass.
  flowActions: reviewFlowActions,

  // ── Custom webhook triggers (webhooks + flows can subscribe) ────────────
  webhookTriggers: [
    {
      name: 'submitted', label: 'Review submitted',
      description: 'An editor submitted an object for review.',
      payloadFields: [
        { path: 'objectId', label: 'Object id' },
        { path: 'typeName', label: 'Content type' },
        { path: 'title', label: 'Title' },
        { path: 'actorMemberId', label: 'Submitted by (member id)' },
      ],
    },
    {
      name: 'stage-changed', label: 'Review stage changed',
      description: 'A review item moved between workflow stages (or changed assignee).',
      payloadFields: [
        { path: 'objectId', label: 'Object id' },
        { path: 'typeName', label: 'Content type' },
        { path: 'title', label: 'Title' },
        { path: 'from', label: 'From stage id' },
        { path: 'to', label: 'To stage id' },
        { path: 'byId', label: 'Moved by (member id)' },
        { path: 'assigneeId', label: 'Assignee (member id)' },
        { path: 'workflowId', label: 'Workflow id' },
      ],
    },
    {
      name: 'approved', label: 'Review approved',
      description: 'An item entered the terminal stage - it is ready to publish.',
      payloadFields: [
        { path: 'objectId', label: 'Object id' },
        { path: 'typeName', label: 'Content type' },
        { path: 'title', label: 'Title' },
        { path: 'actorMemberId', label: 'Approved by (member id)' },
      ],
    },
    {
      name: 'rejected', label: 'Review rejected',
      description: 'A reviewer rejected an item back to the author.',
      payloadFields: [
        { path: 'objectId', label: 'Object id' },
        { path: 'typeName', label: 'Content type' },
        { path: 'title', label: 'Title' },
        { path: 'reason', label: 'Reason' },
        { path: 'actorMemberId', label: 'Rejected by (member id)' },
      ],
    },
    {
      name: 'withdrawn', label: 'Review withdrawn',
      description: 'The author pulled their own item back out of review. Not a rejection - nobody judged it.',
      payloadFields: [
        { path: 'objectId', label: 'Object id' },
        { path: 'typeName', label: 'Content type' },
        { path: 'title', label: 'Title' },
        { path: 'note', label: 'Note (optional)' },
        { path: 'actorMemberId', label: 'Withdrawn by (member id)' },
      ],
    },
  ],

  // ── The workflow API (member sessions; act/manage RBAC-gated) ───────────
  // START (E.7): carry the old option mirror into the settings seed, once.
  onStart: async (ctx) => {
    if (await migrateOptionMirror(ctx)) ctx.log('carried the requireReviewFor mirror into the settings seed')
  },

  adminRoutes: [
    {
      // Editor panel bootstrap: record + workflow + coverage + caller rights.
      // `stale` surfaces the publish gate's approval-vs-current-draft
      // comparison proactively: true only for a TERMINAL-stage record whose
      // draft changed after the approval froze the hash (one extra draft
      // read in that case; false without a read otherwise).
      method: 'GET', path: 'state/:objectId',
      handler: async (req, ctx) => {
        const typeQuery = req.query.type ? String(req.query.type) : undefined
        const { set, workflow } = await resolveObjectWorkflow(ctx, req.params.objectId, typeQuery)
        // Without a governing workflow the object is simply not reviewed -
        // the panel renders its "not covered" state.
        const wf = workflow ?? asDefinition(defaultWorkflow(set) ?? set.workflows[0], set.configured)
        const record = await getRecord(ctx, req.params.objectId, wf)
        const stale = await checkStaleApproval(ctx, wf, req.params.objectId, record)
        const actor = memberActor(req)
        return {
          data: {
            record,
            stale,
            covered: workflow !== null,
            canApprove: req.can?.('review:approve') ?? false,
            canManage: req.can?.('review:manage') ?? false,
            // Whether THIS caller can act on the stage the item is actually
            // in. review:approve is not the answer once a stage names roles:
            // it admits people the stage refuses, and refuses people the
            // stage admits. Without it the panel offered an Advance that the
            // server then 403'd.
            canAct: record?.stageId
              ? canActOnStage(
                  wf.stages.find((st) => st.id === record.stageId),
                  { role: actor.role ?? null, canApprove: actor.canApprove ?? false, isOwner: actor.isOwner },
                )
              : false,
            // ...and whether they only get in because they are the owner, so
            // the panel can say so rather than looking like an ordinary turn.
            actingAsOverride: record?.stageId
              ? isStageOverride(wf.stages.find((st) => st.id === record.stageId), actor)
              : false,
            workflow: { id: wf.id, name: wf.name, stages: wf.stages, coveredTypes: wf.coveredTypes, configured: wf.configured },
            workflows: set.workflows,
          },
        }
      },
    },
    {
      // Submit for review - any member with editor access. Starts a cycle
      // from null; also restarts one from any stage (e.g. a stale terminal
      // approval) - restarting is never an approval, the gate stays shut.
      // A resubmit after a rejection DEFAULTS the assignee back to the
      // reviewer who rejected (an explicit assigneeId - including null -
      // always wins; a first-time submit has no default).
      method: 'POST', path: 'submit/:objectId',
      handler: async (req, ctx) => {
        const objectId = req.params.objectId
        const { typeName, assigneeId } = (req.body ?? {}) as { typeName?: string; assigneeId?: string | null }
        if (!typeName) throw reviewError('VALIDATION_ERROR', 'typeName is required')
        // A NEW cycle always resolves the workflow freshly from the type; an
        // in-flight one keeps its own (requireObjectWorkflow reads the record).
        const set = await resolveWorkflowSet(ctx)
        const fresh = resolveWorkflowForType(set, typeName)
        if (!fresh) {
          throw reviewError('REVIEW_NOT_COVERED',
            'There is no review workflow for this content type - add it to a workflow first', 422)
        }
        const wf = asDefinition(fresh, set.configured)
        const tangen = requireTangen(ctx)
        // Validates existence and snapshots the title for the queue.
        const { data: row } = await objects(tangen, typeName).find(objectId)
        const prev = await getRecord(ctx, objectId, wf)
        const defaultAssignee = assigneeId === undefined && isReturned(prev)
          ? lastRejectedBy(prev?.history) : null
        // An item nobody owns is an item nobody reviews. A resubmit after a
        // rejection satisfies this through defaultAssignee (it goes back to
        // the reviewer who rejected), so only a genuinely ownerless submit
        // is refused.
        const resolvedAssignee = assigneeId !== undefined ? (assigneeId ? String(assigneeId) : null) : defaultAssignee
        await assertAssigneeCanAct(ctx, wf.stages[0], resolvedAssignee)
        if (fresh.requireAssignee !== false && !resolvedAssignee) {
          throw reviewError('VALIDATION_ERROR',
            'Pick a reviewer before submitting - someone has to own this review', 422)
        }
        const first = wf.stages[0]
        const now = new Date().toISOString()
        const record: ReviewRecord = {
          stageId: first.id, typeName, workflowId: fresh.id,
          title: String(row?.title ?? ''),
          assigneeId: resolvedAssignee,
          submittedBy: req.memberId ?? '',
          submittedAt: now, updatedAt: now,
          history: pushHistory(prev?.history, {
            from: prev?.stageId ?? null, to: first.id, byId: req.memberId ?? null, at: now,
          }),
        }
        await ctx.store.put(objectId, clean(record))
        await setReviewLabel(tangen, typeName, objectId, 'pending')
        const actor = memberActor(req)
        ctx.emit?.('submitted', { objectId, typeName, title: record.title, actorMemberId: req.memberId ?? null }, emitActorOpts(actor))
        emitStageChanged(ctx, actor, objectId, record, prev?.stageId ?? null, first.id)
        return { data: record }
      },
    },
    {
      // Advance one stage - an optional note lands on the history entry.
      // Entering the TERMINAL stage freezes the current draft content hash -
      // editing after that invalidates the approval.
      // No static capability: a restricted stage must be able to admit a role
      // that does NOT hold review:approve, which a route-level gate would 403
      // before the handler ever ran. assertCanActOnStage (inside advanceStage)
      // is the authorization, and it still requires the capability on an
      // unrestricted stage - exactly the old behavior.
      method: 'POST', path: 'advance/:objectId',
      handler: async (req, ctx) => {
        const { workflow: wf } = await requireObjectWorkflow(ctx, req.params.objectId)
        const note = readNote(req.body)
        const { record } = await advanceStage(ctx, wf, req.params.objectId, memberActor(req), note)
        return { data: record }
      },
    },
    {
      // Reject from any stage back to the AUTHOR - a note is REQUIRED. The
      // item is returned, not dropped: the assignee becomes the cycle's
      // submitter (riding the history entry so the timeline reads "rejected
      // and returned to <author>") and the record stays visible in the
      // queue's active tabs until the author resubmits.
      // Authorized in the handler for the same reason as advance.
      method: 'POST', path: 'reject/:objectId',
      handler: async (req, ctx) => {
        const objectId = req.params.objectId
        const { workflow: wf } = await requireObjectWorkflow(ctx, objectId)
        const trimmed = readNote(req.body)
        if (!trimmed) throw reviewError('VALIDATION_ERROR', 'A note is required to reject - tell the author what to fix')
        const rec = requireActive(await getRecord(ctx, objectId, wf))
        const actorForGate = memberActor(req)
        // Rejecting out of a restricted stage is that stage's decision too:
        // an outsider must not be able to DESTROY a sign-off they could not
        // have granted. Withdraw (R5) is the author's escape hatch.
        assertCanActOnStage(wf, rec.stageId, actorForGate)
        const now = new Date().toISOString()
        const returnTo = rec.submittedBy || null
        const record: ReviewRecord = {
          ...rec, stageId: null, assigneeId: returnTo,
          approvedHash: undefined, rejectedNote: trimmed, updatedAt: now,
          history: pushHistory(rec.history, actorHistoryEntry(
            { from: rec.stageId, to: null, at: now, note: trimmed, assigneeId: returnTo },
            actorForGate, wf.stages.find((st) => st.id === rec.stageId),
          )),
        }
        await ctx.store.put(objectId, clean(record))
        await setReviewLabel(requireTangen(ctx), rec.typeName, objectId, 'rejected')
        const actor = memberActor(req)
        ctx.emit?.('rejected', {
          objectId, typeName: rec.typeName, title: rec.title ?? '',
          reason: trimmed, actorMemberId: req.memberId ?? null,
        }, emitActorOpts(actor))
        emitStageChanged(ctx, actor, objectId, record, rec.stageId, null)
        return { data: record }
      },
    },
    {
      // R5 - the author's escape hatch. Stage roles make advance and reject
      // the stage's decision, so without this a mistaken submission would sit
      // stuck in (say) Legal review until a role holder or the owner freed
      // it: reject is the only other way back out of a stage.
      //
      // Deliberately carries NO capability. Authors routinely hold none, and
      // requiring one would defeat the point - this is someone retracting
      // their OWN work, not a review decision.
      method: 'POST', path: 'withdraw/:objectId',
      handler: async (req, ctx) => {
        const objectId = req.params.objectId
        const { workflow: wf } = await requireObjectWorkflow(ctx, objectId)
        const rec = requireActive(await getRecord(ctx, objectId, wf))
        const actor = memberActor(req)
        const isSubmitter = !!req.memberId && rec.submittedBy === req.memberId
        if (!isSubmitter && !actor.isOwner) {
          throw reviewError('REVIEW_FORBIDDEN',
            'Only the person who submitted this item can withdraw it', 403)
        }
        const note = readNote(req.body)
        const now = new Date().toISOString()
        const record: ReviewRecord = {
          ...rec,
          stageId: null, assigneeId: null,
          // Withdrawing from the terminal stage discards the approval: the
          // item leaves review entirely and a resubmit restarts at stage one.
          approvedHash: undefined,
          // NOT a rejection - rejectedNote drives isReturned, the Returned
          // badge and the 'rejected' label, none of which apply here.
          rejectedNote: undefined,
          updatedAt: now,
          history: pushHistory(rec.history, actorHistoryEntry(
            { from: rec.stageId, to: null, at: now, withdrawn: true, ...(note ? { note } : {}) },
            actor,
          )),
        }
        await ctx.store.put(objectId, clean(record))
        // Label cleared outright: 'rejected' would misreport it in list
        // filters and the queue's counts.
        await setReviewLabel(requireTangen(ctx), rec.typeName, objectId, null)
        ctx.emit?.('withdrawn', {
          objectId, typeName: rec.typeName, title: rec.title ?? '',
          actorMemberId: req.memberId ?? null, note: note ?? null,
        }, emitActorOpts(actor))
        emitStageChanged(ctx, actor, objectId, record, rec.stageId, null)
        return { data: record }
      },
    },
    {
      // Set or clear the assignee at any stage - an optional note lands on
      // the history entry (e.g. "taking this one for legal").
      method: 'POST', path: 'assign/:objectId', capability: 'review:approve',
      handler: async (req, ctx) => {
        const { workflow: wf } = await requireObjectWorkflow(ctx, req.params.objectId)
        const { assigneeId } = (req.body ?? {}) as { assigneeId?: string | null }
        const note = readNote(req.body)
        // Against the stage the item is IN - that is who has to action it.
        const current = await getRecord(ctx, req.params.objectId, wf)
        await assertAssigneeCanAct(
          ctx, wf.stages.find((st) => st.id === current?.stageId),
          assigneeId ? String(assigneeId) : null,
        )
        const record = await assignReviewer(
          ctx, wf, req.params.objectId, memberActor(req), assigneeId ? String(assigneeId) : null, note,
        )
        return { data: record }
      },
    },
    {
      // The work queue - ?scope=all|mine|done (default all), ?stage, ?type,
      // ?limit / ?offset for paging. Active scopes include RETURNED records
      // (rejected, awaiting the author's resubmit - assignee = the author),
      // so "mine" is the author's fix-it list too; a ?stage filter excludes
      // them (they hold no stage). Done serves the last DONE_LIMIT completed
      // cycles (published or rejected), newest first - unchanged.
      method: 'GET', path: 'queue',
      handler: async (req, ctx) => {
        const set = await resolveWorkflowSet(ctx)
        // Rows can belong to DIFFERENT workflows: each record's own workflow
        // decides its stages, terminal stage and staleness. The primary
        // definition is only the fallback for a record whose workflow is gone.
        const primary = asDefinition(defaultWorkflow(set) ?? set.workflows[0], set.configured)
        const wfFor = (record: ReviewRecord) => {
          const own = workflowForRecord(record, set)
          return own ? asDefinition(own, set.configured) : primary
        }
        const scope = ['all', 'mine', 'done'].includes(String(req.query.scope)) ? String(req.query.scope) : 'all'
        const stage = req.query.stage ? String(req.query.stage) : null
        const type = req.query.type ? String(req.query.type) : null
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
        const offset = Math.max(Number(req.query.offset) || 0, 0)

        const rows = await ctx.store.list('')
        const records: Array<{ objectId: string; record: ReviewRecord }> = []
        for (const { key, data } of rows) {
          if (key.startsWith('__')) continue
          const { record, changed } = migrateRecord(data, wfFor(data as unknown as ReviewRecord))
          if (!record) continue
          if (changed) await ctx.store.put(key, clean(record)).catch(() => {})
          records.push({ objectId: key, record })
        }

        let filtered = records.filter(({ record }) => {
          if (scope === 'done') return record.stageId === null && record.history.length > 0
          if (record.stageId === null && !isReturned(record)) return false
          if (scope === 'mine' && record.assigneeId !== (req.memberId ?? '')) return false
          if (stage && record.stageId !== stage) return false
          return true
        })
        if (type) filtered = filtered.filter(({ record }) => record.typeName === type)

        filtered.sort((a, b) =>
          String(b.record.updatedAt ?? b.record.submittedAt ?? '')
            .localeCompare(String(a.record.updatedAt ?? a.record.submittedAt ?? '')))
        if (scope === 'done') filtered = filtered.slice(0, DONE_LIMIT)

        // Terminal-stage rows also carry `stale` - the gate's approval-vs-
        // current-draft comparison, surfaced before anyone hits publish.
        // Cost: one extra draft read per TERMINAL row on the returned page
        // (bounded by the page limit, and terminal rows are typically the
        // few ready-to-publish items). Non-terminal rows never read the
        // draft and omit the field entirely.
        // Each row also says whether THIS caller can act on the stage it sits
        // in, so the queue's modal offers what the server will accept rather
        // than what the capability alone suggests.
        const queueActor = memberActor(req)
        const rowRights = (record: ReviewRecord, rowWf: WorkflowDefinition) => {
          const st = rowWf.stages.find((x) => x.id === record.stageId)
          return {
            canAct: record.stageId
              ? canActOnStage(st, {
                  role: queueActor.role ?? null,
                  canApprove: queueActor.canApprove ?? false,
                  isOwner: queueActor.isOwner,
                })
              : false,
            actingAsOverride: record.stageId ? isStageOverride(st, queueActor) : false,
            stageRoles: st?.roles ?? null,
          }
        }
        const data = await Promise.all(
          filtered.slice(offset, offset + limit).map(async ({ objectId, record }) => {
            const rowWf = wfFor(record)
            return isTerminal(rowWf, record.stageId)
              ? { objectId, ...record, ...rowRights(record, rowWf), stale: await checkStaleApproval(ctx, rowWf, objectId, record) }
              : { objectId, ...record, ...rowRights(record, rowWf) }
          }),
        )
        return {
          data,
          meta: { total: filtered.length, limit, offset },
          // Primary definition kept for single-workflow clients; `workflows`
          // is what a multi-workflow queue renders from (per-row lookup).
          workflow: { id: primary.id, name: primary.name, stages: primary.stages, coveredTypes: primary.coveredTypes, configured: primary.configured },
          workflows: set.workflows,
        }
      },
    },
    {
      // The whole workflow SET (v3) - seeded, or migrated from the v2 row, on
      // first read. `typeOwners` lets the settings UI disable types another
      // workflow already claims instead of failing the save.
      method: 'GET', path: 'workflows',
      handler: async (req, ctx) => {
        const set = await resolveWorkflowSet(ctx)
        return {
          data: {
            workflows: set.workflows,
            configured: set.configured,
            typeOwners: typeOwners(set),
            canManage: req.can?.('review:manage') ?? false,
          },
        }
      },
    },
    {
      // Save the whole set: names, per-workflow stages, and the type claims.
      // A type may belong to at most ONE workflow (422 naming the owner);
      // exactly one workflow may be the catch-all default. Deleting a stage
      // reassigns its in-flight items within THAT workflow; deleting a whole
      // workflow resets its in-flight cycles (a removed workflow's approvals
      // are not defensible) - both leave history entries.
      method: 'PATCH', path: 'workflows', capability: 'review:manage',
      handler: async (req, ctx) => {
        const prevSet = await resolveWorkflowSet(ctx)
        const knownRoles = await knownRolesFor(ctx)
        const result = validateWorkflowSet(prevSet, (req.body ?? {}) as never, { knownRoles })
        if (!result.ok) throw reviewError('VALIDATION_ERROR', result.error)
        await persistWorkflowSet(ctx, prevSet, result, memberActor(req))
        return {
          data: {
            workflows: result.set.workflows,
            configured: true,
            typeOwners: typeOwners(result.set),
            canManage: true,
          },
        }
      },
    },
    {
      // W1 - the list/detail screens save ONE workflow at a time. The payload
      // shrinks to a single workflow, but validation stays whole-set: type
      // disjointness and the single catch-all default are properties of the
      // SET, so they can only be checked against all of it.
      //
      // These also make deletion explicit. The whole-set PATCH treats an
      // omitted workflow as deleted (resetting its in-flight cycles), so a
      // client that dropped one from the payload destroyed it silently.
      method: 'POST', path: 'workflows', capability: 'review:manage',
      handler: async (req, ctx) => {
        const prevSet = await resolveWorkflowSet(ctx)
        const body = (req.body ?? {}) as Partial<WorkflowInputEntry>
        const input = {
          workflows: [
            ...prevSet.workflows.map(asInputEntry),
            { name: body.name, stages: body.stages, coveredTypes: body.coveredTypes ?? [] },
          ],
        }
        const result = await validateSetOrThrow(ctx, prevSet, input)
        await persistWorkflowSet(ctx, prevSet, result, memberActor(req))
        // The new one is whatever the previous set did not already hold.
        const known = new Set(prevSet.workflows.map((w) => w.id))
        const created = result.set.workflows.find((w) => !known.has(w.id)) ?? result.set.workflows.at(-1)!
        return { data: { workflow: created, typeOwners: typeOwners(result.set) } }
      },
    },
    {
      method: 'PATCH', path: 'workflows/:workflowId', capability: 'review:manage',
      handler: async (req, ctx) => {
        const id = req.params.workflowId
        const prevSet = await resolveWorkflowSet(ctx)
        if (!workflowById(prevSet, id)) {
          throw reviewError('NOT_FOUND', 'That workflow no longer exists - reload and try again', 404)
        }
        const body = (req.body ?? {}) as Partial<WorkflowInputEntry>
        const input = {
          workflows: prevSet.workflows.map((w) => (w.id === id
            ? { id, name: body.name, stages: body.stages, coveredTypes: body.coveredTypes ?? null }
            : asInputEntry(w))),
        }
        const result = await validateSetOrThrow(ctx, prevSet, input)
        await persistWorkflowSet(ctx, prevSet, result, memberActor(req))
        return { data: { workflow: workflowById(result.set, id)!, typeOwners: typeOwners(result.set) } }
      },
    },
    {
      method: 'DELETE', path: 'workflows/:workflowId', capability: 'review:manage',
      handler: async (req, ctx) => {
        const id = req.params.workflowId
        const prevSet = await resolveWorkflowSet(ctx)
        if (!workflowById(prevSet, id)) {
          throw reviewError('NOT_FOUND', 'That workflow no longer exists - reload and try again', 404)
        }
        const input = { workflows: prevSet.workflows.filter((w) => w.id !== id).map(asInputEntry) }
        // persistWorkflowSet resets the deleted workflow's in-flight cycles.
        const result = await validateSetOrThrow(ctx, prevSet, input)
        await persistWorkflowSet(ctx, prevSet, result, memberActor(req))
        return { data: { deleted: id, typeOwners: typeOwners(result.set) } }
      },
    },
    {
      // The workflow definition (seeded with the default on first read).
      method: 'GET', path: 'workflow',
      handler: async (req, ctx) => {
        const wf = await resolveWorkflow(ctx)
        return {
          data: {
            workflow: { stages: wf.stages, coveredTypes: wf.coveredTypes, configured: wf.configured },
            canManage: req.can?.('review:manage') ?? false,
          },
        }
      },
    },
    {
      // v2-compatible single-workflow save: edits THE DEFAULT workflow inside
      // the set (older clients and the pre-v3 settings tab post here). Runs
      // through the same validation and record reconciliation as the set
      // route, so the two paths cannot drift.
      method: 'PATCH', path: 'workflow', capability: 'review:manage',
      handler: async (req, ctx) => {
        const prevSet = await resolveWorkflowSet(ctx)
        const target = defaultWorkflow(prevSet) ?? prevSet.workflows[0]
        const body = (req.body ?? {}) as { stages?: unknown; coveredTypes?: unknown }
        // v2 semantics: an empty coveredTypes list meant "every type", which
        // in v3 is the catch-all default (null). Translate before validating
        // so an older client cannot accidentally un-gate the workspace.
        const v2Covered = 'coveredTypes' in body ? normalizeCoveredTypes(body.coveredTypes) : undefined
        const input = {
          workflows: prevSet.workflows.map((w) => (w.id === target.id
            ? {
                id: w.id, name: w.name, stages: body.stages,
                coveredTypes: v2Covered !== undefined ? v2Covered : w.coveredTypes,
              }
            : { id: w.id, name: w.name, stages: w.stages, coveredTypes: w.coveredTypes })),
        }
        const result = validateWorkflowSet(prevSet, input as never, { knownRoles: await knownRolesFor(ctx) })
        if (!result.ok) throw reviewError('VALIDATION_ERROR', result.error)
        await persistWorkflowSet(ctx, prevSet, result, memberActor(req))
        const saved = workflowById(result.set, target.id)!
        return { data: { workflow: { stages: saved.stages, coveredTypes: saved.coveredTypes, configured: true } } }
      },
    },
  ],
})
