/**
 * File Name: destructive-policy.ts
 * Purpose: The destructive-operation policy for `tangen push` (freeze review
 *          C2). Every destructive operation is individually and explicitly
 *          approved by a token that names it; an approval for one operation
 *          never authorises another; a production environment refuses
 *          destructive operations whatever approvals are supplied; and the
 *          report says, per operation, what would be lost and whether the
 *          loss is guarded.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Production is the DEPLOYMENT ROLE of the process running
 *          the push (TANGEN_DEPLOYMENT_ROLE, else NODE_ENV): a production
 *          deployment never destroys its schema in a normal push; elsewhere
 *          every destructive operation needs its exact approval token.
 */
import type { ChangeOperation, ChangePlan } from './types'
import { deploymentPolicy, type DeploymentRole } from '@tangen/types'
import { classifyOperation, planFlags } from './plan-ops'
import { destructionKey, type DestructionCount } from './migration-plan'

/** The approval token for a destructive operation; null for anything else. */
export function approvalToken(op: ChangeOperation): string | null {
  if (classifyOperation(op).risk !== 'destructive') return null
  switch (op.op) {
    case 'DROP_TYPE': return `drop-type:${op.name}`
    case 'DROP_FIELD': return `drop-field:${op.typeName ? `${op.typeName}.` : ''}${op.name}`
    case 'COMPONENT_FIELD_PURGE': return `purge-component-field:${op.component}.${op.key}`
    case 'PURGE_GUARDED': return `purge-guarded:${op.name}`
    case 'PURGE_EXTENSION': return `purge-extension:${op.extensionId}`
    default: return `${op.op.toLowerCase().replace(/_/g, '-')}`
  }
}

/**
 * Whether the policy treats an environment as production (Phase 5A): its
 * semantic ROLE is production, or its role is unknown - a null role (a
 * legacy environment nobody adopted) fails safe. Callers pass the role
 * they read from the database; one that passes none gets the slug rule
 * (`environmentRoleForSlug`), which is what a pre-0047 database offers.
 */
export function isProductionRole(role: DeploymentRole): boolean {
  return deploymentPolicy(role).destructiveSchemaChanges === 'approval-required'
}

/** @deprecated Phase 5A: the role decides; kept for callers that only have a name (the slug rule applies). */

/** One destructive operation, as the policy reports it. */
export interface DestructiveReport {
  token: string
  operation: ChangeOperation['op']
  type: string | null
  field: string | null
  /** The deployment role the policy was evaluated for. */
  role: DeploymentRole
  /** Rows that would lose a value; null when nothing is there to count. */
  rows: number | null
  label: string | null
  approved: boolean
  /** True when the loss is guarded (renamed aside, recoverable until purged) rather than immediate. */
  guarded: boolean
}

export interface PolicyInput {
  /** The deployment role of the process running the push: production fails closed on destruction. */
  role: DeploymentRole
  /** Tokens the caller supplied (`--approve <token>`, one per operation). */
  approvals: string[]
  counts?: DestructionCount[]
  /** Which operations a later unit makes guarded; default: none. */
  guardedTokens?: Set<string>
}

export interface PolicyResult {
  allowed: boolean
  report: DestructiveReport[]
  /** Approvals that name no destructive operation in this plan. */
  unknownApprovals: string[]
  /** Ready to print; empty when allowed. */
  message: string
}

function reportFor(op: ChangeOperation, input: PolicyInput): DestructiveReport {
  const token = approvalToken(op)!
  const count = (input.counts ?? []).find((c) => c.key === (op.op === 'PURGE_GUARDED' ? `PURGE_GUARDED:${op.name}` : op.op === 'PURGE_EXTENSION' ? `PURGE_EXTENSION:${op.extensionId}` : destructionKey(op)))
  return {
    token,
    operation: op.op,
    type: op.op === 'DROP_TYPE' ? op.name : op.op === 'DROP_FIELD' ? op.typeName ?? null : op.op === 'COMPONENT_FIELD_PURGE' ? op.component : op.op === 'PURGE_GUARDED' ? op.table : op.op === 'PURGE_EXTENSION' ? op.extensionId : null,
    field: op.op === 'DROP_FIELD' ? op.name : op.op === 'COMPONENT_FIELD_PURGE' ? op.key : op.op === 'PURGE_GUARDED' ? op.name : null,
    role: input.role,
    rows: count?.rows ?? null,
    label: count?.label ?? null,
    approved: input.approvals.includes(token),
    // A column or table drop is guarded by construction (renamed aside, recoverable until purged);
    // a component purge and a guarded purge are the physical deletions themselves.
    guarded: input.guardedTokens?.has(token) ?? (op.op === 'DROP_TYPE' || op.op === 'DROP_FIELD'),
  }
}

const scaleOf = (r: DestructiveReport) =>
  r.rows === null ? (r.label ? '  (nothing stored yet)' : '') : `  (${r.rows.toLocaleString()} ${r.label ?? 'rows'})`

/**
 * Evaluates the policy for a plan. Allowed only when the environment is not
 * production, every destructive operation carries its exact approval, and
 * every approval names an operation in this plan.
 */
export function evaluateDestructivePolicy(plan: ChangePlan, input: PolicyInput): PolicyResult {
  const destructive = plan.operations.filter((op) => classifyOperation(op).risk === 'destructive')
  const report = destructive.map((op) => reportFor(op, input))
  const tokens = new Set(report.map((r) => r.token))
  const unknownApprovals = [...new Set(input.approvals)].filter((a) => !tokens.has(a))
  const production = isProductionRole(input.role)

  if (destructive.length === 0 && unknownApprovals.length === 0) return { allowed: true, report, unknownApprovals, message: '' }

  const lines: string[] = []
  if (destructive.length > 0) {
    lines.push(production
      ? '\nRefused: this is a production deployment (TANGEN_DEPLOYMENT_ROLE=production), and a normal push never destroys its schema.'
      : '\nThese operations destroy data:')
    for (const r of report) {
      const what = classifyOperation(destructive[report.indexOf(r)]!).reason
      lines.push(`  - ${what}${scaleOf(r)}${r.guarded ? '  [guarded: recoverable until purged]' : ''}${!production && r.approved ? '  [approved]' : ''}`)
    }
  }
  if (unknownApprovals.length > 0) {
    lines.push('', `Approval${unknownApprovals.length === 1 ? '' : 's'} naming no destructive operation in this plan: ${unknownApprovals.join(', ')}`,
      'An approval authorises exactly the operation it names; remove the ones that do not apply.')
  }
  if (production) {
    lines.push('', 'Nothing was applied. To change a production schema destructively, run the migration as a',
      'reviewed operation outside the normal push, with a verified backup - see docs/architecture/database-safety.md.')
    return { allowed: false, report, unknownApprovals, message: lines.join('\n') }
  }
  const missing = report.filter((r) => !r.approved)
  if (missing.length > 0) {
    lines.push('', 'Approve each operation you mean, one flag per operation:')
    for (const r of missing) lines.push(`  --approve ${r.token}`)
    lines.push('Everything else in the plan applies either way.')
  }
  const allowed = missing.length === 0 && unknownApprovals.length === 0
  return { allowed, report, unknownApprovals, message: allowed ? '' : lines.join('\n') }
}

/**
 * The operations a push applies: safe always, destructive only when its own
 * token is approved AND the environment is not production, ambiguous never.
 * Not a duplicate of the gate: a caller that skipped the gate still cannot
 * apply an operation the policy would refuse.
 */
export function filterApprovedOps(plan: ChangePlan, approvals: string[], role: DeploymentRole): ChangePlan {
  const production = isProductionRole(role)
  const operations = plan.operations.filter((op) => {
    const { risk } = classifyOperation(op)
    if (risk === 'ambiguous') return false
    if (risk === 'destructive') return !production && approvals.includes(approvalToken(op)!)
    return true
  })
  return { ...plan, operations, ...planFlags(operations) }
}
