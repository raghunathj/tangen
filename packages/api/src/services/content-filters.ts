/**
 * File Name: content-filters.ts
 * Purpose: The content filter points a write path applies (Extension Kernel
 *          K4.1): `content.beforeWrite@1` runs after content hooks and before
 *          pruning and validation, over the record about to be written, for
 *          the extensions ACTIVE in the workspace, each transform lent its
 *          own ctx lazily. Without extension wiring (tests, tools) the value
 *          passes through untouched.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { applyFilter, FilterRejected, FilterFailed, type ValidationFindings } from '../kernel/filters'
import { RequestError } from '../lib/errors'
import { extensionWiringDeps } from './extension-server'
import { listExtensionServerIds } from '../hooks/app-hooks-registry'

async function activeSet(workspaceId: string): Promise<ReadonlySet<string> | null> {
  const deps = extensionWiringDeps()
  if (!deps) return null
  if (deps.activeIds) return new Set(await deps.activeIds(workspaceId).catch(() => [] as string[]))
  const ids = listExtensionServerIds()
  const flags = await Promise.all(ids.map((id) => deps.isActive(id, workspaceId).catch(() => false)))
  return new Set(ids.filter((_, i) => flags[i]))
}

export interface BeforeWriteInput<T extends Record<string, unknown>> {
  workspaceId: string
  typeName: string
  operation: 'create' | 'update'
  /** The locale a localized update writes; null for the base row. */
  locale: string | null
  value: T
  /** What the transforms see besides the value: the hook context minus the storage handles. */
  context?: Record<string, unknown>
}

/** `content.beforeWrite@1` over the record; the returned object is what the write continues with. */
export async function applyContentBeforeWrite<T extends Record<string, unknown>>(input: BeforeWriteInput<T>): Promise<T> {
  const deps = extensionWiringDeps()
  const active = await activeSet(input.workspaceId)
  if (!deps || !active || active.size === 0) return input.value
  const r = await applyFilter<T>('content.beforeWrite@1', input.value, {
    workspaceId: input.workspaceId,
    activeIds: active,
    scope: { contentType: input.typeName, locale: input.locale ?? '' },
    context: { operation: input.operation, typeName: input.typeName, locale: input.locale, ...(input.context ?? {}) },
    ctxFor: (id) => deps.buildCtx(id, input.workspaceId),
  })
  return r.value
}

export interface ValidateInput {
  workspaceId: string
  typeName: string
  locale: string | null
  phase: 'save' | 'publish'
  /** The full record as it will be (create: title + values; update: prevData overlaid with the changes; publish: the row). */
  record: Record<string, unknown>
  context?: Record<string, unknown>
}

/** `content.validate@1`: every active extension's findings, merged; throws the platform's 422 when any remain. */
export async function applyContentValidate(input: ValidateInput): Promise<void> {
  const deps = extensionWiringDeps()
  const active = await activeSet(input.workspaceId)
  if (!deps || !active || active.size === 0) return
  const r = await applyFilter<Record<string, unknown>, Required<ValidationFindings>>('content.validate@1', input.record, {
    workspaceId: input.workspaceId,
    activeIds: active,
    scope: { contentType: input.typeName, locale: input.locale ?? '' },
    context: { phase: input.phase, typeName: input.typeName, locale: input.locale, ...(input.context ?? {}) },
    ctxFor: (id) => deps.buildCtx(id, input.workspaceId),
  })
  const findings = r.collected ?? { fields: {}, record: [] }
  const fieldErrors = findings.fields ?? {}
  const record = findings.record ?? []
  if (Object.keys(fieldErrors).length === 0 && record.length === 0) return
  const first = record[0] ?? Object.values(fieldErrors)[0]!
  throw new RequestError('VALIDATION_ERROR', first, 422, Object.keys(fieldErrors).length ? fieldErrors : undefined, { record, validatedBy: r.trace.filter((t) => t.outcome === 'applied').map((t) => t.extensionId) })
}

export interface PublishInput {
  workspaceId: string
  typeName: string
  /** The snapshot about to become the published values. */
  snapshot: Record<string, unknown>
  context?: Record<string, unknown>
}

/** `content.publish@1`: the snapshot after every transform; a REJECT throws the attributed 422 (FilterRejected). */
export async function applyContentPublish(input: PublishInput): Promise<Record<string, unknown>> {
  const deps = extensionWiringDeps()
  const active = await activeSet(input.workspaceId)
  if (!deps || !active || active.size === 0) return input.snapshot
  const r = await applyFilter<Record<string, unknown>>('content.publish@1', input.snapshot, {
    workspaceId: input.workspaceId,
    activeIds: active,
    scope: { contentType: input.typeName },
    context: { typeName: input.typeName, ...(input.context ?? {}) },
    ctxFor: (id) => deps.buildCtx(id, input.workspaceId),
  })
  return r.value
}

export interface SerializeInput {
  workspaceId: string
  typeName: string
  rows: Record<string, unknown>[]
  /** The status the read asked for (null = the caller's default), for the transforms. */
  status?: string | null
  context?: Record<string, unknown>
}

/**
 * `content.serialize@1` over the rows about to be returned. When no active
 * extension registers for the point the rows are returned as they are, with
 * no clone; otherwise the transforms mutate one clone of the array.
 */
export async function applyContentSerialize(input: SerializeInput): Promise<Record<string, unknown>[]> {
  if (input.rows.length === 0) return input.rows
  const deps = extensionWiringDeps()
  const active = await activeSet(input.workspaceId)
  if (!deps || !active || active.size === 0) return input.rows
  const r = await applyFilter<Record<string, unknown>[]>('content.serialize@1', input.rows, {
    workspaceId: input.workspaceId,
    activeIds: active,
    scope: { contentType: input.typeName },
    context: { typeName: input.typeName, status: input.status ?? null, ...(input.context ?? {}) },
    ctxFor: (id) => deps.buildCtx(id, input.workspaceId),
  })
  return r.value
}

export interface BeforeDeleteInput {
  workspaceId: string
  typeName: string
  id: string
  row: Record<string, unknown>
  context?: Record<string, unknown>
}

/** `content.beforeDelete@1`: a REJECT throws the attributed 422 (FilterRejected); otherwise the delete proceeds. */
export async function applyContentBeforeDelete(input: BeforeDeleteInput): Promise<void> {
  const deps = extensionWiringDeps()
  const active = await activeSet(input.workspaceId)
  if (!deps || !active || active.size === 0) return
  await applyFilter<Record<string, unknown>>('content.beforeDelete@1', input.row, {
    workspaceId: input.workspaceId,
    activeIds: active,
    scope: { contentType: input.typeName },
    context: { typeName: input.typeName, objectId: input.id, ...(input.context ?? {}) },
    ctxFor: (id) => deps.buildCtx(id, input.workspaceId),
  })
}

export interface PublishDryRunInput {
  workspaceId: string
  typeName: string
  row: Record<string, unknown>
  typeDef: { fields: Array<{ name: string }> }
  context?: Record<string, unknown>
}

/**
 * `content.publish@1` over the snapshot the row WOULD publish, without
 * publishing (K4.5): the transforms run over a clone with `dryRun: true` in
 * their context, and only a veto (or an abort-point failure) is reported,
 * attributed. The Admin's action projection shows it before the click.
 */
export async function dryRunContentPublish(input: PublishDryRunInput): Promise<{ extensionId: string; reason: string } | null> {
  const deps = extensionWiringDeps()
  const active = await activeSet(input.workspaceId)
  if (!deps || !active || active.size === 0) return null
  const snapshot: Record<string, unknown> = { title: input.row.title, slug: input.row.slug }
  for (const f of input.typeDef.fields) snapshot[f.name] = input.row[f.name]
  try {
    await applyFilter<Record<string, unknown>>('content.publish@1', snapshot, {
      workspaceId: input.workspaceId,
      activeIds: active,
      scope: { contentType: input.typeName },
      context: { typeName: input.typeName, objectId: input.row.id ?? null, row: input.row, dryRun: true, ...(input.context ?? {}) },
      ctxFor: (id) => deps.buildCtx(id, input.workspaceId),
    })
    return null
  } catch (err) {
    if (err instanceof FilterRejected) return { extensionId: err.extensionId, reason: err.reason }
    if (err instanceof FilterFailed) return { extensionId: err.extensionId, reason: err.message }
    throw err
  }
}
