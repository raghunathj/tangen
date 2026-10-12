/**
 * File Name: transitions.ts
 * Purpose: The review state machine's transition core, shared VERBATIM by
 *          the admin routes (member actors) and the contributed Flow
 *          actions (byId null + actorLabel 'Flow: <name>'): advance one
 *          stage (entering the terminal stage freezes the content hash),
 *          approve through every remaining stage (one history entry per
 *          stage so the qualification snapshot stays complete), and
 *          assign. Plus the record/workflow accessors both surfaces need.
 *          There is deliberately NO publish-gate bypass here - these ARE
 *          the reviewer moves, whoever performs them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Extracted from server.ts so the flow actions
 *          (flow-actions.ts) can never drift from the routes. Runs with
 *          the REVIEW extension's ctx (store scoped to extension_data
 *          rows under 'review'; emits namespaced ext:review:*).
 */
import type { ExtensionServerCtx, TangenLocalClient } from '@tangen/types'
import { approvalMac, approvalMatches, type ApprovalSigner } from './hash'
import { coverageSettings } from './coverage'
import { canActOnStage, normalizeCoveredTypes, stageRoles } from './workflow'
import {
  WORKFLOWS_KEY, applyOptionCoverage, defaultWorkflow, migrateWorkflowSet,
  recordWorkflowId, resolveWorkflowForType, workflowById,
  type ReviewWorkflow, type WorkflowSet,
} from './workflows'
import {
  DEFAULT_STAGES, WORKFLOW_KEY,
  ALL_REVIEW_LABELS, REVIEW_LABELS, type ReviewLabelKey,
  isTerminal, migrateRecord, nextStage, pushHistory, terminalStage,
  type HistoryEntry, type ReviewRecord, type WorkflowDefinition, type WorkflowStage,
} from './state'

/** Transition notes (advance/assign/reject) are capped at this length. */
export const MAX_NOTE = 500

/** Who performed a transition: a member (byId) or a non-member actor (label). */
export interface ReviewActor {
  /** Acting member id - null for non-member actors (e.g. Flow actions). */
  byId: string | null
  /** History display label when byId is null, e.g. 'Flow: Auto-approve minor edits'. */
  actorLabel?: string
  /**
   * The actor's workspace role. null for flows and API keys, which hold
   * a capability but no role - so a role-restricted stage refuses them.
   */
  role?: string | null
  /** Platform always-allowed (owner/superadmin) - routes read req.actAsRole([]). */
  isOwner?: boolean
  /** Holds review:approve. Consulted ONLY on an unrestricted stage. */
  canApprove?: boolean
}

/** Event-bus actor options for an actor (member id when there is one). */
export function emitActorOpts(actor: ReviewActor) {
  return { actorId: actor.byId, actorType: actor.byId ? ('member' as const) : null }
}

/**
 * Error shaped like the platform's RequestError (duck-typed by name) so the
 * REST error middleware serves a clean status instead of a 500 - without the
 * extension importing core internals.
 */
export function reviewError(code: string, message: string, status = 422): Error {
  const err = new Error(message) as Error & { statusCode: number; code: string }
  err.name = 'RequestError'
  err.statusCode = status
  err.code = code
  return err
}

/**
 * The optional note riding a transition ({ note } from a route body or a flow
 * action config): trimmed, empty -> undefined, over MAX_NOTE characters -> 422.
 */
export function readNote(body: unknown): string | undefined {
  const { note } = (body ?? {}) as { note?: unknown }
  const trimmed = typeof note === 'string' ? note.trim() : ''
  if (!trimmed) return undefined
  if (trimmed.length > MAX_NOTE) {
    throw reviewError('VALIDATION_ERROR', `Notes are limited to ${MAX_NOTE} characters`)
  }
  return trimmed
}

export function requireTangen(ctx: ExtensionServerCtx): TangenLocalClient {
  if (!ctx.tangen) throw reviewError('REVIEW_UNAVAILABLE', 'Content client unavailable', 500)
  return ctx.tangen
}

/** Untyped objects() accessor - the extension covers arbitrary site types. */
export function objects(tangen: TangenLocalClient, typeName: string) {
  return (tangen as unknown as { objects: (t: string) => any }).objects(typeName)
}

/**
 * Refuses an assignee a stage would not let act. Assigning is coordination,
 * so it is not gated by the stage's roles for the ACTOR - but handing an item
 * to somebody the stage will refuse just parks it with a person who cannot
 * move it, which is the failure the picker already avoids in the UI.
 *
 * Skipped entirely when the host cannot report member roles (older platform,
 * test double): refusing every assignment because a capability is missing
 * would be a worse failure than allowing one we cannot verify.
 */
export async function assertAssigneeCanAct(
  ctx: ExtensionServerCtx,
  stage: { name?: string; roles?: string[] | null } | null | undefined,
  assigneeId: string | null | undefined,
): Promise<void> {
  const roles = stageRoles(stage)
  if (!assigneeId || roles === null) return
  const lookup = (ctx as { memberRoles?: (ids?: string[]) => Promise<Record<string, string>> }).memberRoles
  if (typeof lookup !== 'function') return

  let role: string | null = null
  try {
    const map = await lookup([assigneeId])
    role = map?.[assigneeId] ?? null
  } catch { return }
  if (!role) return   // unknown member - the assign itself will surface that

  if (canActOnStage(stage, {
    role,
    // An assignee is being asked to ACTION the stage, and a restricted stage
    // admits its roles regardless of review:approve - so the capability is
    // not the question here.
    canApprove: false,
    isOwner: role === 'owner' || role === 'superadmin',
  })) return

  const named = roles.length > 0 ? roles.join(' or ') : 'nobody but the workspace owner'
  throw reviewError('VALIDATION_ERROR',
    `That person cannot action "${stage?.name ?? 'this stage'}" - it is restricted to ${named}`, 422)
}

/**
 * The workspace's role slugs, for validating a stage's role restriction.
 * Returns undefined when the host cannot list them (older platform, or a
 * test double) - the validator then checks slug SHAPE only rather than
 * refusing every save it cannot verify.
 */
export async function knownRolesFor(ctx: ExtensionServerCtx): Promise<string[] | undefined> {
  const list = (ctx as { roles?: () => Promise<string[]> }).roles
  if (typeof list !== 'function') return undefined
  try {
    const slugs = await list()
    return Array.isArray(slugs) && slugs.length > 0 ? slugs : undefined
  } catch { return undefined }
}

/**
 * Reads one object with EVERY locale's translations attached as an `i18n`
 * map - the same shape the publish paths put in the snapshot, so an
 * approve-time hash covers translations and a later translation edit
 * invalidates the approval exactly like a base edit (L1). Clients without
 * .locale() degrade to a base-only read, which hashes as it always did.
 */
export function objectsAllLocales(tangen: TangenLocalClient, typeName: string) {
  const builder = objects(tangen, typeName)
  return typeof builder?.locale === 'function' ? builder.locale('all') : builder
}

/** Drops undefined members so store rows stay valid JSON. */
export function clean<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

/** Replace-set of the mirrored review label (other labels untouched). */
export async function setReviewLabel(
  tangen: TangenLocalClient, typeName: string, objectId: string, label: ReviewLabelKey | null,
): Promise<void> {
  const entity = `content:${typeName}`
  const keep = label ? REVIEW_LABELS[label] : null
  const drop = ALL_REVIEW_LABELS.filter((l) => l !== keep)
  await tangen.labels.remove(entity, objectId, drop).catch(() => {})
  if (keep) await tangen.labels.add(entity, objectId, [keep]).catch(() => {})
}

/** A set member as the v2-shaped definition the transitions/UI consume. */
export function asDefinition(workflow: ReviewWorkflow, configured: boolean): WorkflowDefinition {
  return {
    id: workflow.id, name: workflow.name,
    stages: workflow.stages, coveredTypes: workflow.coveredTypes, configured,
  }
}

/**
 * The workspace's PRIMARY workflow definition - the catch-all default, or
 * the first workflow when an admin removed the default. Kept for surfaces
 * that are not object-scoped (the v2-compatible workflow routes); anything
 * acting on a specific object resolves ITS OWN workflow instead, so
 * multi-workflow setups gate correctly.
 */
export async function resolveWorkflow(ctx: ExtensionServerCtx): Promise<WorkflowDefinition> {
  const set = await resolveWorkflowSet(ctx)
  return asDefinition(defaultWorkflow(set) ?? set.workflows[0], set.configured)
}

/**
 * The workflow governing a specific OBJECT: an existing record keeps the
 * workflow its cycle started under (so reassigning the type mid-flight never
 * rewrites a running review), otherwise the type resolves freshly. Returns
 * null when nothing governs the type - callers treat that as "not gated".
 */
export async function resolveObjectWorkflow(
  ctx: ExtensionServerCtx, objectId: string, typeName?: string,
): Promise<{ set: WorkflowSet; workflow: WorkflowDefinition | null }> {
  const set = await resolveWorkflowSet(ctx)
  const raw = await ctx.store.get(objectId).catch(() => undefined)
  const stored = raw as unknown as ReviewRecord | undefined
  const own = stored?.stageId !== undefined || stored?.workflowId
    ? workflowById(set, recordWorkflowId({ workflowId: stored?.workflowId, typeName: stored?.typeName ?? typeName ?? '' }, set))
    : null
  const workflow = own ?? (typeName ? resolveWorkflowForType(set, typeName) : null)
  return { set, workflow: workflow ? asDefinition(workflow, set.configured) : null }
}

/**
 * The workflow a TRANSITION route acts under: the record's own, falling back
 * to the primary definition when there is no record yet. It never throws for
 * a missing workflow - these routes operate on an existing cycle, so the
 * honest error for "nothing here" is requireActive's 404 (submit first),
 * not a coverage complaint. Only submit refuses on missing coverage.
 */
export async function requireObjectWorkflow(
  ctx: ExtensionServerCtx, objectId: string, typeName?: string,
): Promise<{ set: WorkflowSet; workflow: WorkflowDefinition }> {
  const { set, workflow } = await resolveObjectWorkflow(ctx, objectId, typeName)
  return {
    set,
    workflow: workflow ?? asDefinition(defaultWorkflow(set) ?? set.workflows[0], set.configured),
  }
}

/**
 * The effective WORKFLOW SET (v3): the stored `__workflows__` row, lazily
 * migrated from v2's single `__workflow__` row (or seeded) and persisted
 * exactly once. While unconfigured, the single seeded workflow's coverage
 * tracks the code option live - the v2 behavior.
 */
export async function resolveWorkflowSet(ctx: ExtensionServerCtx): Promise<WorkflowSet> {
  const options = await coverageSettings(ctx)
  const rawSet = await ctx.store.get(WORKFLOWS_KEY)
  // Only read the legacy row when there is no usable v3 set to migrate from.
  const rawLegacy = Array.isArray(rawSet?.workflows) && (rawSet!.workflows as unknown[]).length > 0
    ? undefined
    : await ctx.store.get(WORKFLOW_KEY).catch(() => undefined)
  const { set, changed } = migrateWorkflowSet(rawSet, rawLegacy)
  if (changed) await ctx.store.put(WORKFLOWS_KEY, clean(set))
  return applyOptionCoverage(set, options.requireReviewFor)
}

/**
 * Whether a terminal-stage approval has gone stale: the object's current
 * draft content no longer verifies against the MAC frozen on entering the
 * terminal stage. EXACTLY the publish gate's comparison - surfaced
 * proactively instead of only as a publish-time 422. Never stale off the
 * terminal stage, without a record, or without a draft row to compare
 * against.
 *
 * `sign` is the host's MAC (`ctx.sign`). Without it nothing can be verified,
 * and the answer is "stale" - which is both the fail-closed direction and the
 * truth: an approval nobody can verify has to be given again. The same goes
 * for one recorded before approvals were signed.
 */
export function isStaleApproval(
  wf: Pick<WorkflowDefinition, 'stages'>,
  record: Pick<ReviewRecord, 'stageId' | 'approvedHash'> | null | undefined,
  draftRow: Record<string, unknown> | null | undefined,
  sign: ApprovalSigner | undefined,
): boolean {
  if (!record || !isTerminal(wf, record.stageId)) return false
  if (!draftRow) return false
  return !approvalMatches(sign, record.approvedHash, draftRow)
}

/**
 * Route-side staleness check: fetches the object's current draft and applies
 * isStaleApproval. Non-terminal records short-circuit to false without a
 * read; a missing object, missing content client, or any read failure also
 * reads as not stale (the gate still decides at publish time).
 */
export async function checkStaleApproval(
  ctx: ExtensionServerCtx, wf: Pick<WorkflowDefinition, 'stages'>,
  objectId: string, record: ReviewRecord | null,
): Promise<boolean> {
  if (!record || !isTerminal(wf, record.stageId) || !record.typeName) return false
  if (!ctx.tangen) return false
  try {
    const { data: row } = await objectsAllLocales(ctx.tangen, record.typeName).find(objectId)
    return isStaleApproval(wf, record, row as Record<string, unknown>, ctx.sign)
  } catch {
    return false
  }
}

/** Reads + lazily migrates one record; persists a migration exactly once. */
export async function getRecord(ctx: ExtensionServerCtx, objectId: string, wf: WorkflowDefinition): Promise<ReviewRecord | null> {
  const raw = await ctx.store.get(objectId)
  const { record, changed } = migrateRecord(raw, wf)
  if (changed && record) await ctx.store.put(objectId, clean(record))
  return record
}

/** A record that is actively in review (stageId set) - 404 otherwise. */
export function requireActive(record: ReviewRecord | null): ReviewRecord & { stageId: string } {
  if (!record || !record.stageId) {
    throw reviewError('NOT_FOUND', 'No active review for this object - submit it for review first', 404)
  }
  return record as ReviewRecord & { stageId: string }
}

/** A history entry stamped with the actor (byId, and actorLabel when non-member). */
export function actorHistoryEntry(
  entry: Omit<HistoryEntry, 'byId' | 'actorLabel'>, actor: ReviewActor,
  /** The stage acted ON, so an owner-only move can be marked as an override. */
  stage?: { roles?: string[] | null } | null,
): HistoryEntry {
  return {
    ...entry,
    byId: actor.byId,
    ...(actor.actorLabel ? { actorLabel: actor.actorLabel } : {}),
    ...(actor.role ? { role: actor.role } : {}),
    ...(stage !== undefined && isStageOverride(stage, actor) ? { override: true } : {}),
  }
}

/**
 * Did this actor get in ONLY because they are the owner? True when the stage
 * would have refused them on their own role and capability. Drives the
 * `override` marker so an owner's move never reads as an ordinary sign-off.
 */
export function isStageOverride(
  stage: { roles?: string[] | null } | null | undefined, actor: ReviewActor,
): boolean {
  if (!actor.isOwner) return false
  return !canActOnStage(stage, {
    role: actor.role ?? null, canApprove: actor.canApprove ?? false, isOwner: false,
  })
}

/**
 * Guards a stage transition: may this actor advance or reject HERE? Lives in
 * the transition layer, not the route, so every caller is covered by
 * construction - the advance route, the review_advance flow action, and each
 * hop of approveToTerminal.
 */
export function assertCanActOnStage(
  wf: Pick<WorkflowDefinition, 'stages'>, stageId: string | null, actor: ReviewActor,
): void {
  const stage = wf.stages.find((s) => s.id === stageId)
  if (canActOnStage(stage, {
    role: actor.role ?? null, canApprove: actor.canApprove ?? false, isOwner: actor.isOwner,
  })) return
  const roles = stageRoles(stage) ?? []
  const who = roles.length > 0 ? `the ${roles.join(' or ')} role` : 'nobody but the workspace owner'
  throw reviewError('REVIEW_FORBIDDEN',
    `"${stage?.name ?? 'This stage'}" can only be actioned by ${who}`, 403)
}

/** The ext:review:stage-changed emit every transition sends. */
export function emitStageChanged(
  ctx: ExtensionServerCtx, actor: ReviewActor, objectId: string, rec: ReviewRecord,
  from: string | null, to: string | null,
): void {
  ctx.emit?.('stage-changed', {
    objectId, typeName: rec.typeName, title: rec.title ?? '',
    from, to, byId: actor.byId, assigneeId: rec.assigneeId ?? null,
    workflowId: rec.workflowId ?? null,
  }, emitActorOpts(actor))
}

/**
 * Advance one stage - an optional note lands on the history entry. Entering
 * the TERMINAL stage refreshes the title and freezes the current draft
 * content hash - editing after that invalidates the approval. Throws the
 * same errors the route always has: no active review (404), already terminal
 * or off-workflow stage (409).
 */
export async function advanceStage(
  ctx: ExtensionServerCtx, wf: WorkflowDefinition, objectId: string,
  actor: ReviewActor, note?: string,
): Promise<{ record: ReviewRecord; enteredTerminal: boolean }> {
  const rec = requireActive(await getRecord(ctx, objectId, wf))
  // R2: acting on a stage is gated by THAT stage's roles. Here rather than in
  // the route so flows and approveToTerminal hops are covered too.
  assertCanActOnStage(wf, rec.stageId, actor)
  const next = nextStage(wf, rec.stageId)
  if (!next) {
    const known = wf.stages.some((s) => s.id === rec.stageId)
    throw reviewError('REVIEW_CONFLICT', known
      ? `Already at "${terminalStage(wf).name}" - this item is ready to publish`
      : 'This item sits in a stage that no longer exists - reload and try again', 409)
  }
  const entersTerminal = next.id === terminalStage(wf).id
  const now = new Date().toISOString()
  let title = rec.title
  let approvedHash = rec.approvedHash
  const tangen = requireTangen(ctx)
  if (entersTerminal) {
    const { data: row } = await objectsAllLocales(tangen, rec.typeName).find(objectId)
    title = String(row?.title ?? rec.title ?? '')
    // Fail closed rather than record an approval the gate can never verify:
    // an unsigned value would be refused at publish with no way to fix it
    // except approving again, which is a worse place to learn about it.
    approvedHash = approvalMac(ctx.sign, row as Record<string, unknown>) ?? undefined
    if (!approvedHash) {
      throw reviewError('REVIEW_UNAVAILABLE',
        'This deployment cannot sign approvals - upgrade the platform and try again', 500)
    }
  }
  const record: ReviewRecord = {
    ...rec, stageId: next.id, title, updatedAt: now,
    approvedHash: entersTerminal ? approvedHash : undefined,
    rejectedNote: undefined,
    history: pushHistory(rec.history, actorHistoryEntry(
      { from: rec.stageId, to: next.id, at: now, note }, actor,
      wf.stages.find((s) => s.id === rec.stageId),
    )),
  }
  await ctx.store.put(objectId, clean(record))
  await setReviewLabel(tangen, rec.typeName, objectId, entersTerminal ? 'approved' : 'pending')
  emitStageChanged(ctx, actor, objectId, record, rec.stageId, next.id)
  if (entersTerminal) {
    ctx.emit?.('approved', { objectId, typeName: rec.typeName, title, actorMemberId: actor.byId }, emitActorOpts(actor))
  }
  return { record, enteredTerminal: entersTerminal }
}

/**
 * Approve for publishing: advance through EVERY remaining stage to the
 * terminal one, one real advanceStage per hop - one history entry per stage,
 * so the publish qualification snapshot stays complete and honest. The
 * optional note lands on the terminal-entering entry only. Already-terminal
 * items 409 like a plain advance would.
 */
export async function approveToTerminal(
  ctx: ExtensionServerCtx, wf: WorkflowDefinition, objectId: string,
  actor: ReviewActor, note?: string,
): Promise<{ record: ReviewRecord; advanced: number }> {
  let out: { record: ReviewRecord; enteredTerminal: boolean } = {
    record: requireActive(await getRecord(ctx, objectId, wf)), enteredTerminal: false,
  }
  // Pre-flight EVERY remaining stage: advanceStage would refuse mid-walk and
  // leave the item parked between stages, having already written the hops it
  // did clear. Fail before touching anything instead.
  const startIdx = wf.stages.findIndex((s) => s.id === out.record.stageId)
  if (startIdx >= 0) {
    for (const stage of wf.stages.slice(startIdx, wf.stages.length - 1)) {
      assertCanActOnStage(wf, stage.id, actor)
    }
  }
  let advanced = 0
  // Bounded by the workflow depth; advanceStage 409s on terminal/off-workflow.
  for (let hops = 0; hops < wf.stages.length && !out.enteredTerminal; hops++) {
    const peek = nextStage(wf, out.record.stageId ?? '')
    const isFinalHop = peek?.id === terminalStage(wf).id
    out = await advanceStage(ctx, wf, objectId, actor, isFinalHop ? note : undefined)
    advanced++
  }
  if (!out.enteredTerminal) {
    throw reviewError('REVIEW_CONFLICT', 'Could not reach the terminal stage - the workflow changed mid-approval', 409)
  }
  return { record: out.record, advanced }
}

/**
 * Set or clear the assignee at any stage - an optional note lands on the
 * history entry (from === to marks it as an assignment).
 */
export async function assignReviewer(
  ctx: ExtensionServerCtx, wf: WorkflowDefinition, objectId: string,
  actor: ReviewActor, assigneeId: string | null, note?: string,
): Promise<ReviewRecord> {
  const rec = requireActive(await getRecord(ctx, objectId, wf))
  const now = new Date().toISOString()
  const nextAssignee = assigneeId ? String(assigneeId) : null
  const record: ReviewRecord = {
    ...rec, assigneeId: nextAssignee, updatedAt: now,
    history: pushHistory(rec.history, actorHistoryEntry({
      from: rec.stageId, to: rec.stageId, at: now, assigneeId: nextAssignee, note,
    }, actor)),
  }
  await ctx.store.put(objectId, clean(record))
  emitStageChanged(ctx, actor, objectId, record, rec.stageId, rec.stageId)
  return record
}
