/**
 * File Name: filters.ts
 * Purpose: Filters (Extension Kernel K4, tasks/plan-extension-kernel.md;
 *          proposal B.3): the transform primitive. A point is declared once
 *          - scope dimensions, `value` mode (return the next value) or
 *          `draft` mode (one clone, mutated in place), `skip` or `abort`
 *          isolation, sync, required grant. Extensions register transforms
 *          against `point@range` with a priority and a `when` scope, from the
 *          server entry (`filters: [...]`, the `filters@1` contribution
 *          point) or at runtime (`ctx.filters.register`, scoped to the
 *          workspace). `applyFilter` runs the compiled chain for a scope:
 *          priority asc, then contributor order, then registration order;
 *          a broken or slow transform is skipped (warned, attributed) on a
 *          `skip` point and fails an `abort` point; `Filters.STOP(value)`
 *          ends the chain, `Filters.REJECT(reason)` vetoes on an `abort`
 *          point. Chains are compiled per (point, workspace, scope) and reused
 *          until the registry changes - no per-call registry walk.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Rides on the contribution registry; the grant a
 *          registration needs is `filters:<point namespace>` (`filters:content`
 *          for `content.*`), checked from the contributor's manifest grants
 *          like every facility. Nothing runs at import.
 */
import { compileGrants, satisfiesVersion, grantNames } from '@tangen/types'
import { RequestError } from '../lib/errors'
import { contributions, contribute, noteContributionWarning, contributionsGeneration, type ContributionsOptions } from './contributions'
import { getExtensionManifest, listExtensionServerIds, registryGeneration, onExtensionRegistryReset } from '../hooks/app-hooks-registry'
import { qmRecordFilter } from '../lib/query-monitor'

export const FILTERS_POINT = 'filters@1'

export interface FilterPointDef {
  /** `content.beforeWrite`, `seo.structuredData` - namespaced by the owner. */
  id: string
  version: number
  /** The dimensions a registration may narrow with `when` (`contentType`, `locale`, `field`, ...). */
  scope?: string[]
  /**
   * `value`: a transform returns the next value (undefined = unchanged);
   * `draft`: one clone, mutated in place; `collect`: the value is a read-only
   * subject, every transform returns findings and the point's `merge` folds
   * them - results from many extensions are merged, never last-wins.
   */
  mode: 'value' | 'draft' | 'collect'
  /** `collect` mode: the accumulator to start from. */
  empty?: () => unknown
  /** `collect` mode: fold one transform's findings into the accumulator. */
  merge?: (acc: unknown, next: unknown) => unknown
  /** `skip`: a broken transform is skipped and the chain continues; `abort`: it fails the operation. */
  isolation: 'skip' | 'abort'
  /** A hot path: transforms must be synchronous; an async one is a failure. */
  sync?: boolean
  /** The facility grant a grants-declaring contributor needs; defaults to `filters:<namespace>`. */
  grant?: string
  description?: string
}

export interface FilterPoint extends FilterPointDef {
  owner: string
  grant: string
}

/** What an extension registers (server entry `filters: [...]`, or `ctx.filters.register`). */
export interface FilterRegistration<V = unknown, C = unknown> {
  /** `content.beforeWrite@^1` - the point with the range this transform is written against. */
  point: string
  /** Ascending; default 100. */
  priority?: number
  /** Every named dimension must equal the applied scope's value for the transform to run. */
  when?: Record<string, string>
  /** Default 1000 ms; a slower transform is a failure. */
  timeoutMs?: number
  /** Stricter than the point's isolation only (`abort` on a `skip` point); never more lenient. */
  isolation?: 'skip' | 'abort'
  transform: (value: V, context: C & FilterContext) => unknown
}

/** What every transform receives besides the caller's context. */
export interface FilterContext {
  extensionId: string
  point: string
  scope: Record<string, string>
  /** The contributor's own ctx, when the host lends one (lazy, memoised per apply). */
  ctx?: () => Promise<unknown>
}

export interface FilterTrace {
  extensionId: string
  priority: number
  ms: number
  outcome: 'applied' | 'unchanged' | 'skipped' | 'stopped' | 'rejected' | 'failed'
  reason?: string
}

export interface ApplyFilterOptions extends Pick<ContributionsOptions, 'workspaceId' | 'activeIds' | 'isActive'> {
  /** The values of the point's scope dimensions for this call. */
  scope?: Record<string, string>
  /** What the point hands its transforms besides the value (operation, prevData, exec, ...). */
  context?: Record<string, unknown>
  ctxFor?: (extensionId: string) => unknown | Promise<unknown>
}

const STOP = Symbol.for('tangen.filters.stop')
const REJECT = Symbol.for('tangen.filters.reject')

/** Short-circuits a transform may return. */
export const Filters = {
  /** End the chain here with this value. */
  STOP: <T>(value: T): { [STOP]: true; value: T } => ({ [STOP]: true, value }),
  /** Veto the operation (honoured on an `abort` point; ignored and warned on a `skip` point). */
  REJECT: (reason: string): { [REJECT]: true; reason: string } => ({ [REJECT]: true, reason }),
}

/** A transform vetoed the operation: 422, attributed to the extension. */
export class FilterRejected extends RequestError {
  readonly extensionId: string
  readonly point: string
  readonly reason: string
  constructor(extensionId: string, point: string, reason: string) {
    super('FILTER_REJECTED', reason, 422, undefined, { extensionId, point })
    this.name = 'FilterRejected'
    this.extensionId = extensionId
    this.point = point
    this.reason = reason
  }
}

/** A transform on an `abort` point threw or timed out: the operation fails, attributed. */
export class FilterFailed extends Error {
  readonly code = 'FILTER_FAILED'
  constructor(readonly extensionId: string, readonly point: string, readonly cause: unknown) {
    super(`Filter of extension '${extensionId}' on ${point} failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'FilterFailed'
  }
}

/** What a `content.validate@1` transform returns: field errors by path and record-level errors. */
export interface ValidationFindings {
  fields?: Record<string, string>
  record?: string[]
}

/** The built-in points. Only points a core path applies are declared here. */
export const CORE_FILTER_POINTS: readonly FilterPointDef[] = [
  {
    id: 'content.beforeWrite', version: 1, scope: ['contentType', 'locale'], mode: 'draft', isolation: 'skip',
    description: 'The record about to be written (create: the values; update: the changed fields; localized update: that locale\'s fields), after content hooks, before pruning and validation',
  },
  {
    id: 'content.validate', version: 1, scope: ['contentType', 'locale'], mode: 'collect', isolation: 'abort',
    empty: () => ({ fields: {}, record: [] }),
    // First message per field wins; record messages accumulate. Never last-wins.
    merge: (acc, next) => {
      const a = acc as Required<ValidationFindings>
      const n = (next ?? {}) as ValidationFindings
      return { fields: { ...(n.fields ?? {}), ...a.fields }, record: [...a.record, ...(n.record ?? [])] }
    },
    description: 'The record on save (the full record after beforeWrite) and on publish; a transform returns { fields, record } findings; c.phase is save | publish',
  },
  {
    id: 'content.publish', version: 1, scope: ['contentType'], mode: 'draft', isolation: 'abort',
    description: 'The snapshot about to be published, after validation; mutate it, or Filters.REJECT(reason) to veto the publish',
  },
  {
    id: 'content.serialize', version: 1, scope: ['contentType'], mode: 'draft', isolation: 'skip',
    description: 'The rows about to be returned by a read (REST get/query/by-slug, the local client and therefore GraphQL, MCP and custom routes), after masks; mutate them - add a computed field, redact - never a veto',
  },
  {
    id: 'content.beforeDelete', version: 1, scope: ['contentType'], mode: 'value', isolation: 'abort',
    description: 'The row about to be archived by a delete; Filters.REJECT(reason) vetoes it',
  },
]

const points = new Map<string, FilterPoint>()
interface CompiledStep { extensionId: string; registration: FilterRegistration; priority: number }
const chains = new Map<string, { generation: number; steps: CompiledStep[] }>()
const stats = { compiled: 0 }
let ready = false

function ensure(): void {
  if (ready) return
  ready = true
  for (const def of CORE_FILTER_POINTS) points.set(`${def.id}@${def.version}`, { ...def, owner: 'tangen', grant: def.grant ?? `filters:${def.id.split('.')[0]}` })
  onExtensionRegistryReset(() => {
    chains.clear()
    for (const [ref, p] of points) if (p.owner !== 'tangen') points.delete(ref)
  })
}

/** Declare a point. Idempotent for the same shape and owner; a different shape or owner under the same ref is refused. */
export function declareFilterPoint(def: FilterPointDef, owner = 'tangen'): FilterPoint {
  ensure()
  const ref = `${def.id}@${def.version}`
  const next: FilterPoint = { ...def, owner, grant: def.grant ?? `filters:${def.id.split('.')[0]}` }
  const existing = points.get(ref)
  if (existing) {
    const same = existing.owner === owner && existing.mode === next.mode && existing.isolation === next.isolation && !!existing.sync === !!next.sync
      && existing.grant === next.grant && JSON.stringify(existing.scope ?? []) === JSON.stringify(next.scope ?? [])
    if (!same) throw new Error(`Filter point ${ref} is already declared by '${existing.owner}' with a different shape`)
    return existing
  }
  points.set(ref, next)
  chains.clear()
  return next
}

export function filterPoint(ref: string): FilterPoint | undefined {
  ensure()
  return points.get(ref)
}

export function listFilterPoints(): FilterPoint[] {
  ensure()
  return [...points.values()]
}

/** Register a transform at runtime, scoped to a workspace when given; the handle withdraws. */
export function registerFilter(extensionId: string, registration: FilterRegistration<never, never>, opts: { workspaceId?: string } = {}): () => void {
  ensure()
  const off = contribute(extensionId, FILTERS_POINT, [registration], opts)
  chains.clear()
  return () => { off(); chains.clear() }
}

/**
 * Whether a contributor may fill a filter point: only with the point's grant
 * declared. This matches `holdsGrant` in contributions.ts exactly (E.14: an
 * undeclared extension holds nothing).
 *
 * It used to return TRUE here for a manifest with no `grants.required`, as a
 * back-compat path for an extension registered without one. That made
 * omitting `grants` a way to opt OUT of the grant system and still hook
 * content.beforeWrite, validate, publish, serialize and beforeDelete - every
 * content write, publish and delete in the workspace - while holding nothing
 * at any other contribution point. No bundled extension registers a filter
 * and none declares a `filters:*` grant, so the path had no beneficiary.
 */
function holdsGrant(extensionId: string, point: FilterPoint): boolean {
  const required = getExtensionManifest(extensionId)?.grants?.required
  if (!Array.isArray(required)) return false
  const facilities = compileGrants(grantNames(required)).facilities
  return facilities.has(point.grant) || facilities.has('filters:*') || facilities.has('filters:any')
}

function scopeKey(point: FilterPoint, scope: Record<string, string>): string {
  return (point.scope ?? []).map((dim) => `${dim}=${scope[dim] ?? ''}`).join('|')
}

/** Every registration a scope sees (a diagnostic: `inspect` lists them). */
export function listFilterRegistrations(opts: Pick<ContributionsOptions, 'workspaceId' | 'activeIds' | 'isActive'> = {}): Array<{ extensionId: string; point: string; priority: number; when?: Record<string, string> }> {
  ensure()
  return contributions<FilterRegistration>(FILTERS_POINT, opts)
    .filter((c) => c.item && typeof c.item === 'object' && typeof c.item.point === 'string')
    .map((c) => ({ extensionId: c.extensionId, point: c.item.point, priority: c.item.priority ?? 100, ...(c.item.when ? { when: c.item.when } : {}) }))
}

function compile(ref: string, point: FilterPoint, opts: ApplyFilterOptions): CompiledStep[] {
  const scope = opts.scope ?? {}
  const order = listExtensionServerIds()
  const steps: CompiledStep[] = []
  const contributed = contributions<FilterRegistration>(FILTERS_POINT, { workspaceId: opts.workspaceId, activeIds: opts.activeIds, isActive: opts.isActive })
  contributed.forEach((c, index) => {
    const reg = c.item
    if (!reg || typeof reg !== 'object' || typeof reg.point !== 'string' || typeof reg.transform !== 'function') {
      noteContributionWarning(`extension '${c.extensionId}' registered a filter without a point or transform; dropped`)
      return
    }
    const at = reg.point.lastIndexOf('@')
    if (at <= 0) { noteContributionWarning(`extension '${c.extensionId}' registered a filter against '${reg.point}' without a range; dropped`); return }
    const id = reg.point.slice(0, at)
    const range = reg.point.slice(at + 1)
    if (id !== point.id) return
    if (!satisfiesVersion(`${point.version}.0.0`, range)) {
      noteContributionWarning(`extension '${c.extensionId}' registered a filter against ${reg.point}, which ${ref} does not satisfy; ignored`)
      return
    }
    if (!holdsGrant(c.extensionId, point)) {
      noteContributionWarning(`extension '${c.extensionId}' registers a filter on ${ref} without the ${point.grant} grant; ignored`)
      return
    }
    if (reg.when && Object.entries(reg.when).some(([dim, want]) => scope[dim] !== want)) return
    steps.push({ extensionId: c.extensionId, registration: reg, priority: reg.priority ?? 100, ...( { index } as object) } as CompiledStep & { index: number })
  })
  const contributorRank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i }
  steps.sort((a, b) => a.priority - b.priority
    || contributorRank(a.extensionId) - contributorRank(b.extensionId)
    || ((a as { index?: number }).index ?? 0) - ((b as { index?: number }).index ?? 0))
  stats.compiled++
  return steps
}

function chainFor(ref: string, point: FilterPoint, opts: ApplyFilterOptions): CompiledStep[] {
  const generation = contributionsGeneration() + registryGeneration()
  const active = opts.activeIds ? [...opts.activeIds].sort().join(',') : opts.isActive ? '?' : '*'
  const key = `${ref}|${opts.workspaceId ?? ''}|${scopeKey(point, opts.scope ?? {})}|${active}`
  const hit = chains.get(key)
  if (hit && hit.generation === generation && !opts.isActive) return hit.steps
  const steps = compile(ref, point, opts)
  if (chains.size > 2000) chains.clear()
  if (!opts.isActive) chains.set(key, { generation, steps })
  return steps
}

const isStop = (v: unknown): v is { value: unknown } => !!v && typeof v === 'object' && (v as Record<symbol, unknown>)[STOP] === true
const isReject = (v: unknown): v is { reason: string } => !!v && typeof v === 'object' && (v as Record<symbol, unknown>)[REJECT] === true

async function withTimeout<T>(run: () => T | Promise<T>, ms: number, sync: boolean): Promise<T> {
  const result = run()
  if (sync && result && typeof (result as Promise<T>).then === 'function') throw new Error('a synchronous point received an async transform')
  if (!result || typeof (result as Promise<T>).then !== 'function') return result as T
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      result as Promise<T>,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms) }),
    ])
  } finally { if (timer) clearTimeout(timer) }
}

/** Points where several extensions transform the same scope - worth an operator's eye (K4.3). */
export function filterContention(opts: Pick<ContributionsOptions, 'workspaceId' | 'activeIds' | 'isActive'> = {}): Array<{ point: string; when?: Record<string, string>; extensionIds: string[] }> {
  const groups = new Map<string, { point: string; when?: Record<string, string>; extensionIds: string[] }>()
  for (const r of listFilterRegistrations(opts)) {
    const key = `${r.point}|${JSON.stringify(r.when ?? {})}`
    const g = groups.get(key) ?? { point: r.point, ...(r.when ? { when: r.when } : {}), extensionIds: [] }
    if (!g.extensionIds.includes(r.extensionId)) g.extensionIds.push(r.extensionId)
    groups.set(key, g)
  }
  return [...groups.values()].filter((g) => g.extensionIds.length > 1)
}

/** What `inspect` shows for one extension: its registrations, and the contention it is part of. */
export function inspectExtensionFilters(extensionId: string, opts: Pick<ContributionsOptions, 'workspaceId' | 'activeIds' | 'isActive'> = {}): {
  registrations: Array<{ point: string; priority: number; when?: Record<string, string> }>
  contention: Array<{ point: string; when?: Record<string, string>; extensionIds: string[] }>
} {
  return {
    registrations: listFilterRegistrations(opts).filter((r) => r.extensionId === extensionId).map(({ point, priority, when }) => ({ point, priority, ...(when ? { when } : {}) })),
    contention: filterContention(opts).filter((g) => g.extensionIds.includes(extensionId)),
  }
}

/** The engine's counters (tests, the Performance Monitor). */
export function filterEngineStats(): { compiled: number; cached: number } {
  return { compiled: stats.compiled, cached: chains.size }
}

/**
 * Run a point's chain over a value for one scope. Returns the final value
 * and a trace of every step. Throws FilterRejected / FilterFailed only on
 * `abort` semantics; a `skip` point always returns.
 */
export async function applyFilter<T, R = unknown>(ref: string, value: T, opts: ApplyFilterOptions = {}): Promise<{ value: T; collected?: R; trace: FilterTrace[] }> {
  ensure()
  const point = points.get(ref)
  if (!point) throw new Error(`Unknown filter point '${ref}'`)
  const steps = chainFor(ref, point, opts)
  const trace: FilterTrace[] = []
  const collect = point.mode === 'collect'
  let collected: unknown = collect ? (point.empty ? point.empty() : {}) : undefined
  if (steps.length === 0) return collect ? { value, collected: collected as R, trace } : { value, trace }
  let current: T = point.mode === 'draft' ? structuredClone(value) : value
  const scope = opts.scope ?? {}
  const lenders = new Map<string, Promise<unknown>>()
  const lend = (id: string) => () => {
    let p = lenders.get(id)
    if (!p) { p = Promise.resolve(opts.ctxFor!(id)); lenders.set(id, p) }
    return p
  }
  for (const step of steps) {
    const { extensionId, registration, priority } = step
    const isolation = registration.isolation === 'abort' ? 'abort' : point.isolation
    const context: FilterContext & Record<string, unknown> = { ...(opts.context ?? {}), extensionId, point: ref, scope, ...(opts.ctxFor ? { ctx: lend(extensionId) } : {}) }
    const started = performance.now()
    const done = (outcome: FilterTrace['outcome'], reason?: string) => {
      const ms = Math.round((performance.now() - started) * 10) / 10
      trace.push({ extensionId, priority, ms, outcome, ...(reason ? { reason } : {}) })
      // K4.3: the span lands in the request's Query Monitor entry, where the Performance Monitor reads it.
      qmRecordFilter({ point: ref, extensionId, scope: scopeKey(point, scope), ms, outcome })
    }
    let result: unknown
    try {
      result = await withTimeout(() => (registration.transform as (v: unknown, c: unknown) => unknown)(current, context), registration.timeoutMs ?? 1000, !!point.sync)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isolation === 'abort') { done('failed', message); throw new FilterFailed(extensionId, ref, err) }
      noteContributionWarning(`filter of extension '${extensionId}' on ${ref} skipped: ${message}`)
      done('skipped', message)
      continue
    }
    if (isReject(result)) {
      if (isolation === 'abort') { done('rejected', result.reason); throw new FilterRejected(extensionId, ref, result.reason) }
      noteContributionWarning(`filter of extension '${extensionId}' on ${ref} returned REJECT on a skip point; ignored`)
      done('rejected', result.reason)
      continue
    }
    if (isStop(result)) {
      if (point.mode === 'value' && result.value !== undefined) current = result.value as T
      done('stopped')
      break
    }
    if (collect) {
      if (result === undefined || result === null) { done('unchanged'); continue }
      collected = point.merge ? point.merge(collected, result) : { ...(collected as object), ...(result as object) }
      done('applied')
      continue
    }
    if (point.mode === 'value') {
      if (result === undefined) { done('unchanged'); continue }
      current = result as T
    }
    done('applied')
  }
  return collect ? { value: current, collected: collected as R, trace } : { value: current, trace }
}
