/**
 * File Name: flow-actions.ts
 * Purpose: Review's contributed Flow actions - Advance review stage,
 *          Approve for publishing, Assign reviewer. Each PARTICIPATES in
 *          the review state machine through the exact transition functions
 *          the admin routes use (transitions.ts) - the publish gate is
 *          untouched and there is no bypass: a flow qualifies stages the
 *          way a reviewer does, and entering the terminal stage freezes
 *          the content hash as usual. History entries carry byId null +
 *          actorLabel 'Flow: <flow name>' so timelines attribute every
 *          move honestly.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The Flows engine discovers these via the registry
 *          convention (server entry `flowActions`) and executes handlers
 *          with the CONTRIBUTOR's ctx - i.e. REVIEW's own store/emit -
 *          plus a meta third argument ({ flowId, flowName, trigger }).
 *          Handlers throw plain descriptive errors for the no-op cases
 *          (no review record, type not covered, already terminal); the
 *          executor logs them as failed steps in the flow run log - the
 *          worker never goes down.
 */
import type { ExtensionServerCtx } from '@tangen/types'
import { isTypeInList } from './coverage'
import { stageById, terminalStage, type WorkflowDefinition } from './state'
import {
  advanceStage, approveToTerminal, assignReviewer,
  getRecord, readNote, resolveWorkflow, type ReviewActor,
} from './transitions'

/** What the Flows engine passes as the handler's third argument. */
export interface ReviewFlowMeta {
  flowId?: string
  flowName?: string
  /** The run's trigger scope - actions default their target object from it. */
  trigger?: Record<string, unknown>
}

/** The acting "reviewer" a flow is: byId null + a 'Flow: <name>' label. */
export function flowActor(meta?: ReviewFlowMeta): ReviewActor {
  const name = typeof meta?.flowName === 'string' ? meta.flowName.trim() : ''
  // A flow holds the capability (the action declares it) but NO role, so a
  // role-restricted stage refuses it. That is deliberate: if a flow could
  // advance Legal review, anyone able to build a flow would route around
  // Legal, which is the bypass stage roles exist to close.
  return { byId: null, actorLabel: name ? `Flow: ${name}` : 'Flow', role: null, canApprove: true }
}

/** objectId/typeName off the trigger scope (review + platform content events). */
function triggerTarget(meta?: ReviewFlowMeta): { objectId?: string; typeName?: string } {
  const trig = (meta?.trigger ?? {}) as Record<string, unknown>
  const payload = (trig.payload ?? {}) as Record<string, unknown>
  const pick = (...vals: unknown[]) => {
    for (const v of vals) if (typeof v === 'string' && v) return v
    return undefined
  }
  return {
    objectId: pick(trig.objectId, payload.objectId),
    typeName: pick(trig.typeName, payload.typeName, payload.typeSlug),
  }
}

/** The target object: explicit config.objectId wins, else the triggering object. */
function resolveTarget(config: Record<string, unknown>, meta?: ReviewFlowMeta): { objectId: string; typeName?: string } {
  const t = triggerTarget(meta)
  const explicit = typeof config.objectId === 'string' ? config.objectId.trim() : ''
  const objectId = explicit || t.objectId
  if (!objectId) {
    throw new Error('No target object - use a content/review trigger or set objectId (e.g. {{trigger.objectId}})')
  }
  // The type is advisory (better error copy) - only trustworthy for the
  // triggering object itself, never for an explicit override id.
  return { objectId, typeName: explicit && explicit !== t.objectId ? undefined : t.typeName }
}

/**
 * Clearer copy for the commonest miss: nothing in review AND the type is not
 * covered. Everything else falls through to the transitions' own errors.
 */
async function explainMissingReview(
  ctx: ExtensionServerCtx, wf: WorkflowDefinition, objectId: string, typeName?: string,
): Promise<void> {
  const record = await getRecord(ctx, objectId, wf)
  if (!record?.stageId && typeName && !isTypeInList(typeName, wf.coveredTypes)) {
    throw new Error(`Content type '${typeName}' is not covered by the review workflow - nothing to review`)
  }
}

const NOTE_FIELD = { key: 'note', label: 'Note (optional)', kind: 'text' as const }
const OBJECT_FIELD = { key: 'objectId', label: 'Object id (defaults to the triggering object)', kind: 'text' as const }

/**
 * The contributed actions (server entry `flowActions`). Shapes follow the
 * Flows contribution contract (extensions/flows/src/contract.ts) without
 * importing it - the registry convention is duck-typed on purpose.
 */
export const reviewFlowActions = [
  {
    name: 'review_advance',
    label: 'Advance review stage',
    description: 'Moves the triggering object one review stage forward, exactly like a reviewer clicking Advance. Entering the final stage freezes the approval hash.',
    capability: 'review:approve',
    configFields: [NOTE_FIELD, OBJECT_FIELD],
    output: [
      { key: 'objectId', label: 'Object id' },
      { key: 'stageId', label: 'New stage id' },
      { key: 'stageName', label: 'New stage name' },
      { key: 'approved', label: 'Entered the terminal stage', type: 'boolean' as const },
    ],
    handler: async (config: Record<string, unknown>, ctx: ExtensionServerCtx, meta?: ReviewFlowMeta) => {
      requireReviewCtx(ctx)
      const wf = await resolveWorkflow(ctx)
      const { objectId, typeName } = resolveTarget(config, meta)
      await explainMissingReview(ctx, wf, objectId, typeName)
      const note = readNote(config)
      const { record, enteredTerminal } = await advanceStage(ctx, wf, objectId, flowActor(meta), note)
      return {
        objectId, stageId: record.stageId,
        stageName: stageById(wf, record.stageId)?.name ?? '',
        approved: enteredTerminal,
      }
    },
  },
  {
    name: 'review_approve',
    label: 'Approve for publishing',
    description: 'Advances the triggering object through every remaining review stage to the terminal one - one history entry per stage, so the publish qualification snapshot stays complete.',
    capability: 'review:approve',
    configFields: [NOTE_FIELD, OBJECT_FIELD],
    output: [
      { key: 'objectId', label: 'Object id' },
      { key: 'stageName', label: 'Terminal stage name' },
      { key: 'advanced', label: 'Stages advanced', type: 'number' as const },
    ],
    handler: async (config: Record<string, unknown>, ctx: ExtensionServerCtx, meta?: ReviewFlowMeta) => {
      requireReviewCtx(ctx)
      const wf = await resolveWorkflow(ctx)
      const { objectId, typeName } = resolveTarget(config, meta)
      await explainMissingReview(ctx, wf, objectId, typeName)
      const note = readNote(config)
      const { advanced } = await approveToTerminal(ctx, wf, objectId, flowActor(meta), note)
      return { objectId, stageName: terminalStage(wf).name, advanced }
    },
  },
  {
    name: 'review_assign',
    label: 'Assign reviewer',
    description: 'Sets the review assignee for the triggering object (a member id), with an optional note on the history entry.',
    capability: 'review:approve',
    configFields: [
      { key: 'assigneeId', label: 'Assignee (member id)', kind: 'text' as const },
      NOTE_FIELD, OBJECT_FIELD,
    ],
    output: [
      { key: 'objectId', label: 'Object id' },
      { key: 'assigneeId', label: 'Assignee member id' },
    ],
    handler: async (config: Record<string, unknown>, ctx: ExtensionServerCtx, meta?: ReviewFlowMeta) => {
      requireReviewCtx(ctx)
      const assigneeId = typeof config.assigneeId === 'string' ? config.assigneeId.trim() : ''
      if (!assigneeId) throw new Error('Assign reviewer needs an assigneeId (a member id)')
      const wf = await resolveWorkflow(ctx)
      const { objectId, typeName } = resolveTarget(config, meta)
      await explainMissingReview(ctx, wf, objectId, typeName)
      const note = readNote(config)
      const record = await assignReviewer(ctx, wf, objectId, flowActor(meta), assigneeId, note)
      return { objectId, assigneeId: record.assigneeId }
    },
  },
]

/**
 * Defense in depth: these handlers write review state, so they must run with
 * REVIEW's ctx (the Flows engine provides the contributor ctx via the
 * platform registry). A host that fell back to its own ctx would silently
 * write into the WRONG extension's store - refuse loudly instead.
 */
function requireReviewCtx(ctx: ExtensionServerCtx): void {
  if (ctx.extensionId !== 'review') {
    throw new Error(`Review flow actions need the review extension context (got '${ctx.extensionId}') - update the platform`)
  }
}
