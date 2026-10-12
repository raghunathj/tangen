/**
 * File Name: lifecycle-actions.ts
 * Purpose: The lifecycle action policy (kernel plan §6, the schema review
 *          §11): the server decides which lifecycle actions exist for one
 *          object, whether each is available to THIS actor now, and why not
 *          when it is not; every surface projects that. One answer for a
 *          member, a key, an agent, a flow and a job.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Inputs, in order: the actor's policy (decide),
 *          base-locale rights, the status machine as the routes enforce it
 *          today, a validation dry run (the preflight this name deserves),
 *          the relation cascade, and every installed extension's publish
 *          policy MERGED (not first-wins), each blocker with its reason and
 *          the action the extension offers in its place. Unpublish and
 *          stage need the publish grant like publish and schedule do (K4;
 *          the framework review's §4b question, decided in the kernel plan).
 */
import type { ActorContext, ObjectStatus, ObjectTypeDefinition, SchemaDefinition } from '@tangen/types'
import { decide } from './policy'
import { publishValidationError } from '../services/field-validator'
import { disabledRelationPublishBlockers } from '../services/relation-integrity'
import { resolvePublishPlan, type RowLoader } from '../services/publish-cascade'
import { computeHasDraftChanges } from '../services/local-client'
import { customFieldTypeResolverFor } from '../hooks/app-hooks-registry'
import type { ResolvedPublishPolicy } from '../services/extension-server'

export type { LifecycleActionId, LifecycleBlockerCode, LifecycleBlocker, LifecycleAction, LifecycleActions } from '@tangen/types'
import type { LifecycleActionId, LifecycleBlocker, LifecycleAction, LifecycleActions } from '@tangen/types'

export interface LifecycleActionsDeps {
  schema: SchemaDefinition
  workspaceId: string
  /** The workspace's default locale (base-locale rights are checked against it). */
  defaultLocale: string | null | undefined
  loadRow: RowLoader
  /** Every installed extension's publish policy for the type (and object), in extension order. */
  publishPolicies: (input: { typeName: string; objectId?: string }) => Promise<ResolvedPublishPolicy[]>
  /**
   * K4.5: `content.publish@1` as a dry run over the row's would-be snapshot -
   * the veto a filter would raise at publish time, surfaced before the
   * click. Null when no transform vetoes. Optional: a minimal embedding
   * without the filter engine leaves it out.
   */
  publishDryRun?: (input: { typeName: string; objectId: string; row: Record<string, unknown> }) => Promise<{ extensionId: string; reason: string } | null>
}

const LABELS: Record<Exclude<LifecycleActionId, `ext:${string}`>, string> = {
  save: 'Save', publish: 'Publish', unpublish: 'Unpublish', schedule: 'Schedule', unschedule: 'Unschedule',
  stage: 'Stage', archive: 'Archive', restore: 'Restore',
}

/** The status machine as the routes enforce it: which statuses each transition leaves from. */
export const TRANSITIONS: Record<Exclude<LifecycleActionId, 'save' | `ext:${string}`>, { from: ObjectStatus[]; permission: 'write' | 'publish' | 'delete'; alsoWrite?: boolean }> = {
  publish: { from: ['draft', 'staged', 'scheduled'], permission: 'publish' },
  unpublish: { from: ['published', 'staged', 'scheduled'], permission: 'publish' },
  schedule: { from: ['draft', 'staged', 'published', 'scheduled'], permission: 'publish', alsoWrite: true },
  unschedule: { from: ['scheduled'], permission: 'write' },
  stage: { from: ['draft'], permission: 'publish' },
  archive: { from: ['draft', 'staged', 'published', 'scheduled'], permission: 'delete' },
  restore: { from: ['archived'], permission: 'write' },
}

function forbidden(reason: string): LifecycleBlocker { return { code: 'FORBIDDEN', reason } }

export async function lifecycleActions(
  deps: LifecycleActionsDeps,
  actor: ActorContext | null | undefined,
  input: { typeName: string; objectId?: string | null },
): Promise<LifecycleActions> {
  const typeDef = deps.schema.types.find((t) => t.name === input.typeName) as ObjectTypeDefinition | undefined
  if (!typeDef) throw new Error(`Type "${input.typeName}" not found in schema`)
  const objectId = input.objectId ?? null
  const row = objectId ? await deps.loadRow(input.typeName, objectId) : null
  const status = (row?.status as ObjectStatus | undefined) ?? null
  const state: LifecycleActions['state'] = {
    status,
    scheduledAt: row?.scheduledAt instanceof Date ? row.scheduledAt.toISOString() : typeof row?.scheduledAt === 'string' ? row.scheduledAt : null,
    hasDraftChanges: row ? computeHasDraftChanges(row, typeDef) : null,
  }

  // ── Policy, once per grant ────────────────────────────────────────────────
  const grant = (action: 'write' | 'publish' | 'delete') => decide(actor, { kind: 'object', action, type: input.typeName })
  const baseLocale = decide(actor, { kind: 'locale', action: 'write', locale: null, defaultLocale: deps.defaultLocale ?? null })
  const policyBlockers = (permission: 'write' | 'publish' | 'delete', alsoWrite = false): LifecycleBlocker[] => {
    const out: LifecycleBlocker[] = []
    const d = grant(permission)
    if (!d.allow) out.push(forbidden(d.reason ?? `Missing permission: objects:${permission}`))
    if (alsoWrite) { const w = grant('write'); if (!w.allow) out.push(forbidden(w.reason ?? 'Missing permission: objects:write')) }
    if (out.length === 0 && !baseLocale.allow) out.push(forbidden(baseLocale.reason ?? 'This action needs base-language rights'))
    return out
  }

  // ── The publish inputs: validation dry run, cascade, extension policies ───
  const publishBlockers: LifecycleBlocker[] = []
  let cascade: LifecycleAction['cascade'] | undefined
  if (row) {
    const validation = publishValidationError(typeDef, row, customFieldTypeResolverFor(deps.workspaceId))
      ?? Object.values(disabledRelationPublishBlockers(deps.schema, typeDef))[0] ?? null
    if (validation) publishBlockers.push({ code: 'VALIDATION', reason: String(validation) })
    const plan = await resolvePublishPlan({ schema: deps.schema, typeName: input.typeName, id: objectId!, loadRow: deps.loadRow })
    if (plan.blockers.length > 0) publishBlockers.push({ code: 'CASCADE', reason: 'One or more required related objects cannot be published', plan })
    else if (plan.dependencies.length > 0) cascade = { dependencies: plan.dependencies }
  }
  const policies = await deps.publishPolicies({ typeName: input.typeName, objectId: objectId ?? undefined })
  // K4.5: what content.publish@1 would say, as a POLICY blocker attributed to the vetoing extension.
  if (row && objectId && deps.publishDryRun) {
    const veto = await deps.publishDryRun({ typeName: input.typeName, objectId, row })
    if (veto) publishBlockers.push({ code: 'POLICY', reason: veto.reason, extensionId: veto.extensionId })
  }
  const replacements: LifecycleAction[] = []
  for (const p of policies) {
    if (!p.blocked) continue
    publishBlockers.push({ code: 'POLICY', reason: p.reason ?? 'Publishing is currently unavailable', ...(p.extensionId ? { extensionId: p.extensionId } : {}), ...(p.actionLabel ? { actionLabel: p.actionLabel } : {}) })
    if (p.action && p.extensionId) {
      const write = policyBlockers('write')
      replacements.push({
        id: `ext:${p.extensionId}:${p.action.path}`, label: p.action.label,
        available: write.length === 0 && !!objectId, blockers: objectId ? write : [{ code: 'NEW', reason: 'Save the object first' }],
        method: p.action.method ?? 'POST', path: `/admin/ext/${p.extensionId}/${p.action.path}`, body: p.action.body,
        replaces: 'publish', extensionId: p.extensionId,
      })
    }
  }

  // ── The actions ──────────────────────────────────────────────────────────
  const base = objectId ? `/objects/${input.typeName}/${objectId}` : `/objects/${input.typeName}`
  const actions: LifecycleAction[] = []
  const push = (id: Exclude<LifecycleActionId, `ext:${string}`>, blockers: LifecycleBlocker[], call: Pick<LifecycleAction, 'method' | 'path' | 'body'>, extra: Partial<LifecycleAction> = {}) => {
    actions.push({ id, label: LABELS[id], available: blockers.length === 0, blockers, ...call, ...extra })
  }

  // save: a write on the base row (a translation-only save is the locale's own decision)
  {
    const w = grant('write')
    push('save', w.allow ? [] : [forbidden(w.reason ?? 'Missing permission: objects:write')], objectId ? { method: 'PATCH', path: base } : { method: 'POST', path: `/objects/${input.typeName}` })
  }
  for (const [id, t] of Object.entries(TRANSITIONS) as Array<[Exclude<LifecycleActionId, 'save' | `ext:${string}`>, typeof TRANSITIONS[keyof typeof TRANSITIONS]]>) {
    const blockers = policyBlockers(t.permission, t.alsoWrite)
    if (!objectId) {
      if (id === 'publish') blockers.push(...publishBlockers.filter((b) => b.code === 'POLICY'))
      blockers.push({ code: 'NEW', reason: 'Save the object first' })
    } else if (status && !t.from.includes(status)) {
      blockers.push({ code: 'STATE', reason: `Cannot ${id} an object that is ${status}` })
    }
    if (objectId && (id === 'publish' || id === 'schedule')) blockers.push(...publishBlockers)
    const call: Pick<LifecycleAction, 'method' | 'path' | 'body'> =
      id === 'archive' ? { method: 'DELETE', path: base }
      : id === 'restore' ? { method: 'POST', path: '/objects/bulk-update', body: { type: input.typeName, ids: objectId ? [objectId] : [], fields: { status: 'draft' } } }
      : id === 'schedule' ? { method: 'POST', path: `/objects/${objectId ?? ''}/schedule?type=${input.typeName}`, body: { scheduledAt: null } }
      : id === 'unschedule' ? { method: 'DELETE', path: `/objects/${objectId ?? ''}/schedule?type=${input.typeName}` }
      : { method: 'POST', path: `${base}/${id}` }
    push(id, dedupe(blockers), call, id === 'publish' && cascade ? { cascade } : {})
  }
  actions.push(...replacements)
  return { type: input.typeName, id: objectId, state, actions }
}

function dedupe(blockers: LifecycleBlocker[]): LifecycleBlocker[] {
  const seen = new Set<string>()
  return blockers.filter((b) => { const k = `${b.code}:${b.reason}:${b.extensionId ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true })
}

/** The advisory shape the publish-policy route has always answered, projected from the action policy. */
export function publishPolicyOf(actions: LifecycleActions): ResolvedPublishPolicy {
  const publish = actions.actions.find((a) => a.id === 'publish')
  const policy = publish?.blockers.find((b) => b.code === 'POLICY')
  if (!policy) return { blocked: false }
  const replacement = actions.actions.find((a) => a.replaces === 'publish' && a.extensionId === policy.extensionId)
  return {
    blocked: true,
    ...(policy.reason ? { reason: policy.reason } : {}),
    actionLabel: policy.actionLabel ?? 'Save as draft',
    ...(replacement ? { action: { label: replacement.label, path: replacement.path.replace(`/admin/ext/${policy.extensionId}/`, ''), method: replacement.method as 'POST' | 'PATCH', ...(replacement.body ? { body: replacement.body } : {}) } } : {}),
    ...(policy.extensionId ? { extensionId: policy.extensionId } : {}),
  }
}
