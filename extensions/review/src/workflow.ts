/**
 * File Name: workflow.ts
 * Purpose: Pure workflow-definition logic shared by the server routes and
 *          the Workflow settings tab: input validation (min stages, the
 *          terminal-stage rule, names, colors), stable id assignment, and
 *          the reassignment plan for stages deleted while items are
 *          in-flight. Browser-safe.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The LAST stage is terminal. Renames/recolors are
 *          id-stable; deleting the terminal stage is refused server-side
 *          AND client-side through validateWorkflowInput. Deleted stages
 *          send their in-flight items to the nearest surviving PREVIOUS
 *          stage (fallback: the new first stage).
 */
import type { WorkflowStage } from './state'

/** The stage color palette (semantic badge tints the admin already ships). */
export const STAGE_COLORS = ['gray', 'blue', 'amber', 'violet', 'pink', 'teal', 'green', 'red'] as const
export type StageColor = (typeof STAGE_COLORS)[number]

export const MAX_STAGES = 6
export const MAX_STAGE_NAME = 40

/** Stable-enough id for an admin-created stage (persisted once, never regenerated). */
export function newStageId(): string {
  return `stg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export interface WorkflowStageInput {
  id?: string
  name?: unknown
  color?: unknown
}

export interface WorkflowInput {
  stages?: WorkflowStageInput[]
  coveredTypes?: unknown
}

export type WorkflowValidation =
  | { ok: true; stages: WorkflowStage[]; coveredTypes: string[] | null }
  | { ok: false; error: string }

/** null = all types; empty arrays collapse to null. */
export function normalizeCoveredTypes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const list = [...new Set(raw.map(String).filter(Boolean))]
  return list.length > 0 ? list : null
}

/** Most roles one stage may name - a guard rail, not a product limit. */
export const MAX_STAGE_ROLES = 20

/** Role slugs as the members API defines them (see routes/members/manage.ts). */
const ROLE_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/

/**
 * A stage's role restriction, normalized: `null` when the stage was never
 * restricted (absent or null), the list otherwise - INCLUDING an empty one,
 * which is a restriction that names nobody rather than an absent restriction.
 */
export function stageRoles(stage: { roles?: string[] | null } | null | undefined): string[] | null {
  const roles = stage?.roles
  return Array.isArray(roles) ? roles : null
}

/** Who is trying to act, as the route resolves them. */
export interface StageActor {
  /** Env-effective role; null for flows, API keys and roleless callers. */
  role: string | null
  /** Holds review:approve. Consulted ONLY on an unrestricted stage. */
  canApprove: boolean
  /**
   * The platform's always-allowed set (owner / superadmin). Routes read this
   * from `req.actAsRole([])` - an empty list admits nobody else, so a true
   * answer means "always allowed" without the extension having to know which
   * role slugs the platform privileges.
   */
  isOwner?: boolean
}

/**
 * May this actor advance or reject at this stage?
 *
 * 1. owner/superadmin - always (the permanent recovery path)
 * 2. unrestricted stage - yes if they hold review:approve (today's behavior)
 * 3. restricted stage - yes if their workspace role is listed
 *
 * Note what step 3 does NOT do: it never additionally requires
 * review:approve. Requiring both would make the natural action - adding a
 * role to a stage - silently do nothing whenever that role lacks the
 * capability, and a permission control that silently does nothing is worse
 * than one that refuses.
 *
 * A missing stage reads as unrestricted: this resolver must never be the
 * reason content cannot move.
 */
export function canActOnStage(
  stage: { roles?: string[] | null } | null | undefined,
  actor: StageActor,
): boolean {
  if (actor.isOwner) return true
  const roles = stageRoles(stage)
  if (roles === null) return actor.canApprove
  if (!actor.role) return false
  return roles.includes(actor.role)
}

/**
 * Validates one stage's role list. Returns `null` for "never restricted",
 * the cleaned list otherwise (trimmed, de-duplicated, order preserved, empty
 * preserved). `knownRoles` is the workspace's role slugs when the caller has
 * them - shape is always checked, existence only when they were supplied.
 */
function normalizeStageRoles(
  raw: unknown, stageName: string, knownRoles?: string[],
): { ok: true; roles: string[] | null } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: true, roles: null }
  const out: string[] = []
  for (const entry of raw) {
    const slug = typeof entry === 'string' ? entry.trim() : ''
    if (!slug) continue
    if (!ROLE_SLUG_RE.test(slug)) {
      return { ok: false, error: `"${slug}" is not a valid role for "${stageName}"` }
    }
    if (knownRoles && !knownRoles.includes(slug)) {
      return { ok: false, error: `"${slug}" is not a role in this workspace - "${stageName}" cannot require it` }
    }
    if (!out.includes(slug)) out.push(slug)
  }
  if (out.length > MAX_STAGE_ROLES) {
    return { ok: false, error: `A stage can name at most ${MAX_STAGE_ROLES} roles ("${stageName}")` }
  }
  return { ok: true, roles: out }
}

/**
 * Validates a workflow save against the currently stored stages.
 * Rules: 2..MAX_STAGES stages, non-empty unique names within MAX_STAGE_NAME,
 * colors from the palette (invalid -> 'blue'), ids unique (new stages get
 * ids assigned), and the current terminal stage cannot be deleted.
 */
export function validateWorkflowInput(
  prevStages: WorkflowStage[], input: WorkflowInput, opts?: { knownRoles?: string[] },
): WorkflowValidation {
  const rawStages = Array.isArray(input.stages) ? input.stages : []
  if (rawStages.length < 2) return { ok: false, error: 'A workflow needs at least 2 stages (the last one is the publish gate)' }
  if (rawStages.length > MAX_STAGES) return { ok: false, error: `A workflow can have at most ${MAX_STAGES} stages` }

  const stages: WorkflowStage[] = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  for (const raw of rawStages) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!name) return { ok: false, error: 'Every stage needs a name' }
    if (name.length > MAX_STAGE_NAME) return { ok: false, error: `Stage names are limited to ${MAX_STAGE_NAME} characters` }
    const nameKey = name.toLowerCase()
    if (seenNames.has(nameKey)) return { ok: false, error: `Duplicate stage name "${name}"` }
    seenNames.add(nameKey)
    const id = typeof raw.id === 'string' && raw.id ? raw.id : newStageId()
    if (seenIds.has(id)) return { ok: false, error: 'Duplicate stage id' }
    seenIds.add(id)
    const color = STAGE_COLORS.includes(raw.color as StageColor) ? (raw.color as StageColor) : 'blue'
    const roleResult = normalizeStageRoles((raw as { roles?: unknown }).roles, name, opts?.knownRoles)
    if (!roleResult.ok) return { ok: false, error: roleResult.error }
    stages.push({ id, name, color, roles: roleResult.roles })
  }

  const prevTerminal = prevStages[prevStages.length - 1]
  if (prevTerminal && !seenIds.has(prevTerminal.id)) {
    return { ok: false, error: `The terminal stage "${prevTerminal.name}" cannot be deleted` }
  }

  return { ok: true, stages, coveredTypes: normalizeCoveredTypes(input.coveredTypes) }
}

/**
 * Where each deleted stage's in-flight items go: the nearest PREVIOUS stage
 * (in the old order) that survives; items in a deleted first stage land on
 * the new first stage.
 */
export function planStageReassignments(prevStages: WorkflowStage[], nextStages: WorkflowStage[]): Record<string, string> {
  const surviving = new Set(nextStages.map((s) => s.id))
  const plan: Record<string, string> = {}
  prevStages.forEach((stage, idx) => {
    if (surviving.has(stage.id)) return
    let target: string | null = null
    for (let i = idx - 1; i >= 0; i--) {
      if (surviving.has(prevStages[i].id)) { target = prevStages[i].id; break }
    }
    plan[stage.id] = target ?? nextStages[0].id
  })
  return plan
}
