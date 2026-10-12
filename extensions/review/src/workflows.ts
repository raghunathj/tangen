/**
 * File Name: workflows.ts
 * Purpose: The v3 MULTI-workflow model: the stored set (`__workflows__`),
 *          the lazy migration from v2's single `__workflow__` row, and the
 *          resolution rules - a type explicitly claimed by a workflow
 *          resolves to THAT workflow, everything else falls to the single
 *          catch-all default (coveredTypes null), and when no default
 *          exists the remaining types are simply not gated. Browser-safe
 *          (types + pure functions only).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A type may be claimed by at most ONE workflow - the
 *          disjointness is enforced at save time (see validateWorkflowSet)
 *          so "which gate applies" is never ambiguous. Records carry the
 *          workflowId they were submitted under, so an in-flight cycle
 *          completes under its own workflow even if the type is reassigned
 *          mid-flight (recordWorkflowId).
 */
import { validateWorkflowInput, type WorkflowStageInput } from './workflow'
import {
  DEFAULT_STAGES,
  type ReviewRecord, type WorkflowDefinition, type WorkflowStage,
} from './state'

/** Store key for the multi-workflow set (never collides with object-id keys). */
export const WORKFLOWS_KEY = '__workflows__'

/** The id v2's single workflow migrates to - records backfill to it. */
export const DEFAULT_WORKFLOW_ID = 'wf_default'
export const DEFAULT_WORKFLOW_NAME = 'Default'

export const MAX_WORKFLOW_NAME = 40

/** One named workflow: its own ordered stages and the types it governs. */
export interface ReviewWorkflow {
  /** Stable id - survives renames; records and history reference it. */
  id: string
  name: string
  /** Ordered; the LAST stage is terminal ("ready to publish"). Min 2. */
  stages: WorkflowStage[]
  /** Types this workflow governs; null marks THE catch-all default (one per set). */
  coveredTypes: string[] | null
  /**
   * Must a submit name a reviewer? Absent reads as TRUE: an item nobody owns
   * is an item nobody reviews. Teams working a shared pull queue set it
   * false explicitly and pick items up from "All in review".
   */
  requireAssignee?: boolean
  /**
   * Parked. A draft workflow governs NOTHING - not the types it lists, not as
   * the catch-all default - so its content is simply not reviewed until it
   * goes live again. This is how a workflow is switched off temporarily
   * without deleting it and losing its stages.
   */
  draft?: boolean
}

export interface WorkflowSet {
  workflows: ReviewWorkflow[]
  /** True once an admin saved - until then the default's coverage tracks the code option. */
  configured: boolean
}

/** Stable-enough id for an admin-created workflow (persisted once, never regenerated). */
export function newWorkflowId(): string {
  return `wf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function isUsableWorkflow(raw: unknown): raw is ReviewWorkflow {
  const w = raw as ReviewWorkflow | undefined
  return !!w && typeof w.id === 'string' && !!w.id &&
    Array.isArray(w.stages) && w.stages.length >= 2
}

/**
 * A stored workflow, cleaned. Rebuilt field by field rather than spread, so
 * junk in the store cannot leak into the model - which means every OPTIONAL
 * field has to be listed here too, or it is silently dropped on the way back
 * out (requireAssignee was, and the opt-out looked broken).
 */
function normalizeWorkflow(raw: ReviewWorkflow): ReviewWorkflow {
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : DEFAULT_WORKFLOW_NAME,
    stages: raw.stages,
    coveredTypes: Array.isArray(raw.coveredTypes)
      ? [...new Set(raw.coveredTypes.map(String).filter(Boolean))]
      : null,
    ...(raw.requireAssignee === false ? { requireAssignee: false } : {}),
    ...(raw.draft === true ? { draft: true } : {}),
  }
}

/**
 * Normalizes whatever is stored into a usable v3 set:
 *   1. a valid `__workflows__` set passes through unchanged (idempotent),
 *   2. otherwise a v2 `__workflow__` row becomes the single DEFAULT_WORKFLOW_ID
 *      workflow (stages + coverage + configured preserved),
 *   3. otherwise the seed - one default workflow with the default stages.
 * Callers persist when `changed`.
 */
export function migrateWorkflowSet(
  rawSet: Record<string, unknown> | undefined | null,
  rawLegacy: Record<string, unknown> | undefined | null,
): { set: WorkflowSet; changed: boolean } {
  const stored = rawSet?.workflows
  if (Array.isArray(stored)) {
    const usable = stored.filter(isUsableWorkflow).map(normalizeWorkflow)
    if (usable.length > 0) {
      return { set: { workflows: usable, configured: rawSet?.configured === true }, changed: false }
    }
  }

  if (rawLegacy && Array.isArray(rawLegacy.stages) && (rawLegacy.stages as WorkflowStage[]).length >= 2) {
    const legacy = rawLegacy as unknown as WorkflowDefinition
    return {
      set: {
        workflows: [normalizeWorkflow({
          id: DEFAULT_WORKFLOW_ID,
          name: DEFAULT_WORKFLOW_NAME,
          stages: legacy.stages,
          coveredTypes: (legacy.coveredTypes ?? null) as string[] | null,
        })],
        configured: legacy.configured === true,
      },
      changed: true,
    }
  }

  return {
    set: {
      workflows: [{
        id: DEFAULT_WORKFLOW_ID, name: DEFAULT_WORKFLOW_NAME,
        stages: [...DEFAULT_STAGES], coveredTypes: null,
      }],
      configured: false,
    },
    changed: true,
  }
}

/**
 * While a set is UNCONFIGURED (no admin ever saved) and holds exactly the
 * seeded single workflow, its coverage tracks the code option
 * (`requireReviewFor`) live - the v2 behavior. A configured set, or any set
 * an admin grew past one workflow, ignores the option entirely.
 */
export function applyOptionCoverage(set: WorkflowSet, optionCoveredTypes: string[] | null): WorkflowSet {
  if (set.configured || set.workflows.length !== 1) return set
  return {
    ...set,
    workflows: [{ ...set.workflows[0], coveredTypes: optionCoveredTypes }],
  }
}

/** Workflows that actually govern - drafts are parked and govern nothing. */
function liveWorkflows(set: WorkflowSet): ReviewWorkflow[] {
  return set.workflows.filter((w) => w.draft !== true)
}

/** The catch-all workflow (coveredTypes null), or null when none exists. */
export function defaultWorkflow(set: WorkflowSet): ReviewWorkflow | null {
  return liveWorkflows(set).find((w) => w.coveredTypes === null) ?? null
}

export function workflowById(set: WorkflowSet, id: string | null | undefined): ReviewWorkflow | null {
  if (!id) return null
  return set.workflows.find((w) => w.id === id) ?? null
}

/**
 * Which workflow governs a type: an explicit claim wins, otherwise the
 * catch-all default. Null when neither applies - that type is simply not
 * gated (matching v2's "not in requireReviewFor" semantics).
 */
export function resolveWorkflowForType(set: WorkflowSet, typeName: string): ReviewWorkflow | null {
  // Only LIVE workflows govern. A type claimed by a drafted workflow falls
  // through to the catch-all default if there is a live one, and is simply
  // not reviewed if there is not.
  const claimed = liveWorkflows(set).find((w) => w.coveredTypes !== null && w.coveredTypes.includes(typeName))
  return claimed ?? defaultWorkflow(set)
}

/** Claimed type -> owning workflow id (the settings UI disables foreign claims). */
export function typeOwners(set: WorkflowSet): Record<string, string> {
  const owners: Record<string, string> = {}
  for (const w of set.workflows) {
    for (const t of w.coveredTypes ?? []) owners[t] = w.id
  }
  return owners
}

/**
 * Types no workflow governs - surfaced in settings ("N types are not
 * reviewed"). Always empty while a catch-all default exists.
 */
export function uncoveredTypes(set: WorkflowSet, allTypes: string[]): string[] {
  if (defaultWorkflow(set)) return []
  const owners = typeOwners(set)
  return allTypes.filter((t) => !(t in owners))
}

/**
 * The workflow a record belongs to: its stored workflowId when set (an
 * in-flight cycle completes under the workflow it started in, even if the
 * type was reassigned since), else the v2 backfill - the migrated default
 * id when it still exists, else fresh type resolution. Null when nothing
 * governs it.
 */
export function recordWorkflowId(
  record: Pick<ReviewRecord, 'workflowId' | 'typeName'>, set: WorkflowSet,
): string | null {
  if (record.workflowId) return record.workflowId
  if (workflowById(set, DEFAULT_WORKFLOW_ID)) return DEFAULT_WORKFLOW_ID
  return resolveWorkflowForType(set, record.typeName)?.id ?? null
}

/**
 * The workflow object a record is governed by (recordWorkflowId resolved
 * against the set). Null when the workflow was deleted or nothing governs
 * the type - callers treat that as "not gated".
 */
export function workflowForRecord(
  record: Pick<ReviewRecord, 'workflowId' | 'typeName'>, set: WorkflowSet,
): ReviewWorkflow | null {
  return workflowById(set, recordWorkflowId(record, set))
}

// ── Save-time validation ─────────────────────────────────────────────────────

export interface WorkflowSetInput {
  workflows?: Array<{ id?: string; name?: unknown; stages?: WorkflowStageInput[]; coveredTypes?: unknown; requireAssignee?: unknown; draft?: unknown }>
}

export type WorkflowSetValidation =
  | { ok: true; set: WorkflowSet; removed: ReviewWorkflow[] }
  | { ok: false; error: string }

/**
 * Validates a whole-set save. Beyond the per-workflow stage rules
 * (validateWorkflowInput: 2..MAX_STAGES, names, the terminal stage of an
 * EXISTING workflow cannot be deleted), the set-level rules are:
 *   - at least one workflow must remain,
 *   - workflow names are non-empty and unique,
 *   - at most ONE catch-all default (coveredTypes null),
 *   - a type may be claimed by at most one workflow. The conflict message
 *     names the workflow that ALREADY owns the type (the previous owner
 *     when there is one, else the first claimant in the input) so the
 *     editor is told where to remove it.
 * Also reports which workflows disappeared, so the caller can reset their
 * in-flight cycles (a deleted workflow's approvals are not defensible).
 */
export function validateWorkflowSet(
  prev: WorkflowSet, input: WorkflowSetInput, opts?: { knownRoles?: string[] },
): WorkflowSetValidation {
  const raw = Array.isArray(input.workflows) ? input.workflows : []
  if (raw.length === 0) return { ok: false, error: 'Keep at least one workflow - review needs a set of stages to run' }

  const workflows: ReviewWorkflow[] = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  // type -> the workflow that claimed it, as claims are accepted
  const claimed = new Map<string, { id: string; name: string }>()
  const prevOwners = typeOwners(prev)
  let defaultName: string | null = null

  for (const rawWf of raw) {
    const name = typeof rawWf.name === 'string' ? rawWf.name.trim() : ''
    if (!name) return { ok: false, error: 'Every workflow needs a name' }
    if (name.length > MAX_WORKFLOW_NAME) {
      return { ok: false, error: `Workflow names are limited to ${MAX_WORKFLOW_NAME} characters` }
    }
    const nameKey = name.toLowerCase()
    if (seenNames.has(nameKey)) return { ok: false, error: `Duplicate workflow name "${name}"` }
    seenNames.add(nameKey)

    const id = typeof rawWf.id === 'string' && rawWf.id ? rawWf.id : newWorkflowId()
    if (seenIds.has(id)) return { ok: false, error: 'Duplicate workflow id' }
    seenIds.add(id)

    // Per-workflow stage rules, against THIS workflow's previous stages
    // (a brand new workflow has none, so no terminal-deletion check).
    const prevStages = workflowById(prev, rawWf.id)?.stages ?? []
    const stageResult = validateWorkflowInput(
      prevStages, { stages: rawWf.stages, coveredTypes: rawWf.coveredTypes }, opts,
    )
    if (!stageResult.ok) return { ok: false, error: stageResult.error }

    // v3 distinguishes "claims nothing" from "the catch-all default": an
    // explicit array stays an array even when empty (a workflow can exist
    // while an admin is still assigning types to it); only a null/absent
    // value marks the default. v2's normalizer collapsed [] to null.
    const coveredTypes = Array.isArray(rawWf.coveredTypes)
      ? [...new Set(rawWf.coveredTypes.map(String).filter(Boolean))]
      : null
    if (coveredTypes === null) {
      if (defaultName) {
        return {
          ok: false,
          error: `Only one workflow can cover all remaining content objects - "${defaultName}" already does`,
        }
      }
      defaultName = name
    } else {
      for (const type of coveredTypes) {
        const takenBy = claimed.get(type)
        if (takenBy) {
          // Name the workflow that ALREADY owned the type - the one the editor
          // must remove it from - independently of the input's order: when the
          // conflict involves the previous owner, name it; otherwise name
          // whichever claim was seen first.
          const owner = prevOwners[type] === id ? name : takenBy.name
          return { ok: false, error: `"${type}" already belongs to the "${owner}" workflow - remove it there first` }
        }
        claimed.set(type, { id, name })
      }
    }

    workflows.push({
      id, name, stages: stageResult.stages, coveredTypes,
      // Absent means required; only an explicit false opts out.
      ...(rawWf.requireAssignee === false ? { requireAssignee: false } : {}),
      ...(rawWf.draft === true ? { draft: true } : {}),
    })
  }

  const keptIds = new Set(workflows.map((w) => w.id))
  const removed = prev.workflows.filter((w) => !keptIds.has(w.id))
  return { ok: true, set: { workflows, configured: true }, removed }
}
