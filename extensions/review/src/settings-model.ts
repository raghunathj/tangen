/**
 * File Name: settings-model.ts
 * Purpose: The pure model behind the multi-workflow settings tab: the
 *          editable draft shape, conversion to and from the save payload,
 *          which workflow already claims a type (so the UI disables the card
 *          rather than failing the save), the uncovered-types warning, and a
 *          client-side mirror of the server's validation rules. Browser-safe
 *          and React-free so it can be unit-tested without a DOM.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The SERVER re-validates everything (workflows.ts
 *          validateWorkflowSet) - this only keeps honest people honest and
 *          gives immediate feedback. `coveredAll` maps to coveredTypes null
 *          (the catch-all default); a workflow with an empty claim list is a
 *          real state (it governs nothing) and must not collapse to null.
 */
import { MAX_STAGES } from './workflow'
import { MAX_WORKFLOW_NAME, type ReviewWorkflow } from './workflows'

/** A stage row being edited - new stages carry no id until the server assigns one. */
export interface DraftStage {
  key: string
  id?: string
  name: string
  color: string
  /**
   * Roles allowed to act on this stage; null = unrestricted. Carried through
   * the draft even before the picker exists (R3), because a save round-trips
   * the whole stage - dropping it here would silently WIPE restrictions the
   * API or a later slice had set.
   */
  roles: string[] | null
}

/** A workflow being edited. */
export interface DraftWorkflow {
  key: string
  id?: string
  name: string
  stages: DraftStage[]
  /** True = the catch-all default (coveredTypes null). */
  coveredAll: boolean
  covered: Set<string>
  /** Parked: governs nothing until it goes live. */
  draft: boolean
}

let seq = 0
export const draftKey = (prefix = 'draft') => `${prefix}_${++seq}`

export function draftsFromWorkflows(workflows: ReviewWorkflow[]): DraftWorkflow[] {
  return workflows.map((w) => ({
    key: draftKey('wf'),
    id: w.id,
    name: w.name,
    stages: w.stages.map((s) => ({ key: s.id, id: s.id, name: s.name, color: s.color, roles: s.roles ?? null })),
    coveredAll: w.coveredTypes === null,
    covered: new Set(w.coveredTypes ?? []),
    draft: w.draft === true,
  }))
}

export interface WorkflowSaveInput {
  workflows: Array<{
    id?: string; name: string; coveredTypes: string[] | null
    stages: Array<{ id?: string; name: string; color: string; roles: string[] | null }>
    draft?: boolean
  }>
}

export function setInputFromDrafts(drafts: DraftWorkflow[]): WorkflowSaveInput {
  return {
    workflows: drafts.map((w) => ({
      ...(w.id ? { id: w.id } : {}),
      name: w.name.trim(),
      stages: w.stages.map((s) => ({ ...(s.id ? { id: s.id } : {}), name: s.name.trim(), color: s.color, roles: s.roles ?? null })),
      coveredTypes: w.coveredAll ? null : [...w.covered],
      ...(w.draft ? { draft: true } : {}),
    })),
  }
}

/**
 * The NAME of another workflow that already claims `typeName`, or null when
 * the type is free (or claimed by this same workflow). The catch-all default
 * claims nothing explicitly, so it never blocks a specific claim.
 */
export function claimOwner(drafts: DraftWorkflow[], key: string, typeName: string): string | null {
  const other = drafts.find((w) => w.key !== key && !w.coveredAll && w.covered.has(typeName))
  return other ? other.name.trim() || 'another workflow' : null
}

/** Types no workflow governs - empty while a catch-all default exists. */
export function uncoveredTypeNames(drafts: DraftWorkflow[], allTypes: string[]): string[] {
  // A parked workflow governs nothing, so the types it lists are unreviewed
  // exactly as if no workflow claimed them - which is the point of warning.
  const live = drafts.filter((w) => !w.draft)
  if (live.some((w) => w.coveredAll)) return []
  const claimed = new Set(live.flatMap((w) => [...w.covered]))
  return allTypes.filter((t) => !claimed.has(t))
}

/** Client-side mirror of validateWorkflowSet - first problem is shown inline. */
export function workflowProblems(drafts: DraftWorkflow[]): string[] {
  const out: string[] = []
  if (drafts.length === 0) {
    out.push('Keep at least one workflow - review needs a set of stages to run.')
    return out
  }

  const names = new Set<string>()
  let defaultName: string | null = null
  const claimed = new Map<string, string>()

  for (const w of drafts) {
    const name = w.name.trim()
    if (!name) { out.push('Every workflow needs a name.'); continue }
    if (name.length > MAX_WORKFLOW_NAME) out.push(`Workflow names are limited to ${MAX_WORKFLOW_NAME} characters.`)
    const key = name.toLowerCase()
    if (names.has(key)) out.push(`Duplicate workflow name "${name}".`)
    names.add(key)

    if (w.stages.length < 2) out.push(`"${name}" needs at least 2 stages.`)
    if (w.stages.length > MAX_STAGES) out.push(`"${name}" can have at most ${MAX_STAGES} stages.`)
    if (w.stages.some((s) => !s.name.trim())) out.push(`Every stage needs a name ("${name}").`)

    if (w.coveredAll) {
      if (defaultName) out.push(`Only one workflow can cover all remaining content objects - "${defaultName}" already does.`)
      else defaultName = name
    } else {
      for (const type of w.covered) {
        const owner = claimed.get(type)
        if (owner) out.push(`"${type}" is claimed by both "${owner}" and "${name}" - a type belongs to one workflow.`)
        else claimed.set(type, name)
      }
    }
  }
  return out
}


// ── W2: list -> detail ───────────────────────────────────────────────────────

/** One row of the Workflows list. */
export interface WorkflowListRow {
  id: string
  name: string
  stageCount: number
  /** The publish gate - the last stage. Worth seeing without opening it. */
  terminalStageName: string
  /** Human coverage summary, never a raw array. */
  coverage: string
  /** The catch-all default (coveredTypes null). */
  isDefault: boolean
  /** Parked - listed but governing nothing. */
  draft: boolean
}

/** Summarises the stored workflows for the list screen. */
export function workflowListRows(workflows: ReviewWorkflow[], allTypes: string[]): WorkflowListRow[] {
  return workflows.map((w) => ({
    id: w.id,
    name: w.name,
    stageCount: w.stages.length,
    terminalStageName: w.stages[w.stages.length - 1]?.name ?? '',
    isDefault: w.coveredTypes === null,
    draft: w.draft === true,
    coverage: w.draft === true
      ? 'Draft - reviews nothing until it goes live'
      : describeCoverage(w.coveredTypes, allTypes),
  }))
}

/** "All remaining content objects" / "post, page" / "Nothing yet". */
function describeCoverage(coveredTypes: string[] | null, allTypes: string[]): string {
  if (coveredTypes === null) return 'All remaining content objects'
  if (coveredTypes.length === 0) return 'Nothing yet - this workflow reviews no content'
  if (coveredTypes.length === allTypes.length && allTypes.length > 0) return 'Every content object'
  const shown = coveredTypes.slice(0, 3).join(', ')
  return coveredTypes.length > 3 ? `${shown} and ${coveredTypes.length - 3} more` : shown
}

/** The PATCH/POST body for ONE workflow - a detail screen saves only itself. */
export function oneWorkflowInput(draft: DraftWorkflow): WorkflowSaveInput['workflows'][number] {
  const [only] = setInputFromDrafts([draft]).workflows
  // The id travels in the URL, not the body, on the per-workflow routes.
  const { id: _id, ...rest } = only
  return rest as WorkflowSaveInput['workflows'][number]
}

/**
 * Client-side problems visible from ONE workflow's screen. Deliberately does
 * NOT check duplicate names or claimed types: those are properties of the
 * whole SET, which a detail screen cannot see. The server validates the set
 * on every per-workflow save and its 422 names the other workflow.
 */
export function draftProblems(draft: DraftWorkflow): string[] {
  const out: string[] = []
  const name = draft.name.trim()
  if (!name) out.push('This workflow needs a name.')
  else if (name.length > MAX_WORKFLOW_NAME) out.push(`Workflow names are limited to ${MAX_WORKFLOW_NAME} characters.`)
  if (draft.stages.length < 2) out.push('A workflow needs at least 2 stages - the last one is the publish gate.')
  if (draft.stages.length > MAX_STAGES) out.push(`A workflow can have at most ${MAX_STAGES} stages.`)
  if (draft.stages.some((s) => !s.name.trim())) out.push('Every stage needs a name.')
  return out
}
