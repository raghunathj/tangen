/**
 * File Name: server.ts
 * Purpose: The Flows server entry - the whole automation product wired
 *          through the generic extension surface: platform events feed the
 *          trigger tap, execution rides the durable queue as
 *          ext:flows:execute, flow definitions and run logs live in the
 *          extension store (no tables, no migrations), and the builder UI
 *          talks to adminRoutes under /api/v1/admin/ext/flows/.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Trigger payloads are the platform's typed events;
 *          object triggers hydrate {{trigger.data.*}} from the live row at
 *          execute time (best effort). Runs are pruned to the newest 50
 *          per flow. Writes require manage:settings.
 */
import { defineExtensionServer } from '@tangen/cms'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { pauseFlowsForRemovedNodes } from './engine/dangling'
import { RouteError } from '@tangen/types'
import type { ExtensionServerCtx, ExtensionStore } from '@tangen/types'
import type { FlowDef, FlowCondition, FlowScope } from './engine/types'
import { executeFlow } from './engine/executor'
import { migrateFlow } from './engine/migrate'
import { compileFlow } from './engine/compile'
import { runnableState, type RunnableState } from './engine/runnable'
import { evaluateConditions } from './engine/conditions'
import { nextRun, type FlowSchedule } from './engine/schedule'
import type { ActionCtx } from './engine/actions'
import { buildCatalog, contributedActions, contributedPresets, presetsFor } from './catalog'
import { flowOrigin } from './provenance'
import type { ExecutionContext } from '@tangen/types'

export const FLOW_PREFIX = 'flow:'
export const RUN_PREFIX = 'run:'
/** Tiny latest-run pointer per flow - the list reads THESE, never the full run rows. */
export const RUNMETA_PREFIX = 'runmeta:'
export const EXECUTE_TASK = 'ext:flows:execute'
export const SCHEDULE_TASK = 'ext:flows:schedule'
export const SCHED_PREFIX = 'sched:'
export const FAIL_PREFIX = 'fail:'
/** Consecutive failures that trip the breaker → auto-disable (options.failureThreshold overrides). */
const FAILURE_THRESHOLD = 5
/** Re-check cadence for a scheduled flow (also the max delay we ever arm). */
const SCHED_HEARTBEAT = 3600
const RUNS_KEPT_PER_FLOW = 300

/** Event types flows can trigger on (the builder's trigger catalog). */
export const TRIGGER_TYPES = [
  'object.created', 'object.updated', 'object.published',
  'object.unpublished', 'object.deleted', 'object.scheduled',
  'media.uploaded',
  'member.invited', 'member.created', 'member.updated',
  'site_user.registered', 'site_user.login',
] as const

const newId = () => `fl_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`

/** Max nesting for "Run flow" composition - a cycle (A→B→A) trips this. */
const MAX_FLOW_DEPTH = 5

/** The running flow's identity - rides into contributed handlers as meta. */
interface FlowIdentity { flowId?: string; flowName?: string }

/** ActionCtx + contributed-action dispatch + flow composition (depth-guarded). */
function contributedCtx(ctx: ExtensionServerCtx, contributed: ReturnType<typeof contributedActions>, depth = 0, flow?: FlowIdentity, allowPrivate = false): ActionCtx {
  const base = actionCtx(ctx, allowPrivate)
  return {
    ...base,
    runContributed: async (name: string, config: Record<string, unknown>, extra?: { trigger?: Record<string, unknown>; idempotencyKey?: string; attempt?: number }) => {
      const entry = contributed.get(name)
      if (!entry) throw new Error(`Unknown contributed action '${name}'`)
      // Extension contributions run with the CONTRIBUTOR's ctx (their store/
      // identity/emit - the registry provides a lazy builder); site helpers
      // (and registries without one) run with the flows ctx as before.
      // K7: a contributor's store and identity, but the FLOW's execution -
      // the action does what the flow's run-as actor may, never more. Site
      // helpers (and registries without a builder) get the flows ctx, which
      // the run already bound.
      const contributorCtx = entry.ctx ? await entry.ctx() : null
      const handlerCtx = contributorCtx
        ? (ctx.exec ? { ...contributorCtx, exec: ctx.exec, tangen: contributorCtx.clientFor ? contributorCtx.clientFor(ctx.exec) : ctx.tangen } : contributorCtx)
        : ctx
      // The execution identity travels in `meta` so a CONTRIBUTED action can
      // deduplicate a retried delivery - it is the action most likely to reach
      // an external system, and the least able to ask for the key otherwise.
      return entry.def.handler(config, handlerCtx, {
        ...flow, trigger: extra?.trigger,
        idempotencyKey: extra?.idempotencyKey, attempt: extra?.attempt,
      })
    },
    runFlow: async (flowId: string, input: Record<string, unknown>, ropts?: { dryRun?: boolean; testMode?: boolean }) => {
      if (depth + 1 > MAX_FLOW_DEPTH) throw new Error(`Flow call depth exceeded (${MAX_FLOW_DEPTH}) - possible recursion`)
      const target = await ctx.store.get(`${FLOW_PREFIX}${flowId}`)
      if (!target) throw new Error(`Run flow: flow '${flowId}' not found`)
      const result = await executeFlow(
        target as never,
        { type: 'flow', payload: input ?? {} },
        // Sub-flow steps attribute to the SUB-flow's name, not the parent's.
        contributedCtx(ctx, contributed, depth + 1, { flowId, flowName: String((target as { name?: unknown }).name ?? '') || undefined }, allowPrivate),
        { extraActions: [...contributed.keys()], dryRun: ropts?.dryRun, testMode: ropts?.testMode },
      )
      if (result.status === 'waiting') throw new Error(`Sub-flow '${flowId}' has a wait step - not supported when called as a sub-flow`)
      if (result.status === 'error') {
        const failed = result.log.find((l) => !l.ok)
        throw new Error(`Sub-flow '${flowId}' failed at ${failed?.step}: ${failed?.error}`)
      }
      return { status: result.status, output: result.output ?? {} }
    },
  } as ActionCtx
}

/** The kernel's outbound http (network grants); a ctx without it cannot run an http step and says so. */
function httpOf(ctx: ExtensionServerCtx): NonNullable<ExtensionServerCtx['http']> {
  if (!ctx.http) throw new Error('Flows: this ctx carries no http; the http action needs the network:any grant of the manifest')
  return ctx.http
}

/**
 * E.15: the Allow private networks setting, permission-aware. The settings
 * service answers false whatever is stored unless the installation holds
 * `network:private`, so this can never imply authority the extension lacks.
 */
async function allowPrivateOf(ctx: ExtensionServerCtx): Promise<boolean> {
  const values = await ctx.settings?.get().catch(() => undefined)
  return (values as { allowPrivateNetworks?: unknown } | undefined)?.allowPrivateNetworks === true
}

function actionCtx(ctx: ExtensionServerCtx, allowPrivate: boolean): ActionCtx {
  return {
    tangen: ctx.tangen as ActionCtx['tangen'],
    // E.10: every outbound call goes through ctx.http (network:any, named in the manifest); no bare fetch.
    fetcher: (url, init) => httpOf(ctx)(url, init),
    log: (message) => ctx.log(message),
    // SSRF guard stays on unless the permission-aware setting lifts it (E.15)
    allowPrivate,
  }
}

/**
 * The effective trigger for match-time. v1 flows carry it on `flow.trigger`;
 * v2 (canvas) flows carry it on the single `trigger` node - without this, v2
 * flows never match a real event. Also surfaces the trigger's optional
 * conditions (a "only run when…" pre-filter).
 */
function resolveTrigger(flow: Record<string, unknown>): { type?: string; typeName?: string; conditions?: FlowCondition[]; schedule?: FlowSchedule; secret?: string } {
  const legacy = (flow as { trigger?: { type?: string; typeName?: string; conditions?: FlowCondition[] } }).trigger
  if (legacy?.type) return legacy
  const node = (flow as { nodes?: Array<{ kind: string; data: Record<string, unknown> }> }).nodes
    ?.find((n) => n.kind === 'trigger')
  if (!node) return {}
  return {
    type: node.data.type as string | undefined,
    typeName: node.data.typeName as string | undefined,
    conditions: node.data.conditions as FlowCondition[] | undefined,
    schedule: node.data.schedule as FlowSchedule | undefined,
    secret: node.data.secret as string | undefined,
  }
}

/** Where the per-workspace webhook signing secret lives in the extension store (E.10). */
const WEBHOOK_SECRET_KEY = '__webhook_secret__'
const SIG_HEX_LENGTH = 64

/** The workspace's webhook signing secret: minted into the extension's own store on first use, never the platform's JWT_SECRET. */
async function webhookSecretOf(ctx: ExtensionServerCtx): Promise<string> {
  const stored = (await ctx.store.get(WEBHOOK_SECRET_KEY))?.secret
  if (typeof stored === 'string' && stored) return stored
  const minted = randomBytes(32).toString('hex')
  await ctx.store.put(WEBHOOK_SECRET_KEY, { secret: minted })
  return minted
}

/**
 * Mint the inbound-webhook token for a flow: base64url({ w, f }) followed by
 * a fixed-length HMAC-SHA256 hex. One unpunctuated segment, so the access log
 * scrubs it like any credential in a path.
 */
async function mintWebhookToken(ctx: ExtensionServerCtx, flowId: string): Promise<string> {
  const secret = await webhookSecretOf(ctx)
  const payloadB64 = Buffer.from(JSON.stringify({ w: ctx.workspaceId, f: flowId })).toString('base64url')
  const sig = new Bun.CryptoHasher('sha256', secret).update(payloadB64).digest('hex')
  return `${payloadB64}${sig}`
}

/** The claims of a token minted here, or null: wrong length, wrong signature, wrong workspace, or not ours. */
async function verifyWebhookToken(ctx: ExtensionServerCtx, token: string | undefined): Promise<{ w: string; f: string } | null> {
  if (!token || token.length <= SIG_HEX_LENGTH) return null
  const payloadB64 = token.slice(0, -SIG_HEX_LENGTH)
  const sig = token.slice(-SIG_HEX_LENGTH)
  const secret = await webhookSecretOf(ctx)
  const expected = new Bun.CryptoHasher('sha256', secret).update(payloadB64).digest('hex')
  const a = Buffer.from(sig); const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as { w?: string; f?: string }
    if (!claims.w || !claims.f || claims.w !== ctx.workspaceId) return null
    return { w: claims.w, f: claims.f }
  } catch { return null }
}

/** E.16: the record UPGRADE leaves when webhook URLs changed form; the URL route reports it per flow until the flow is saved again. */
const WEBHOOK_ROTATION_KEY = '__webhook_url_rotation__'
const RETIRED_WEBHOOK_FORM = '/api/v1/hooks/flows/<token>'
interface WebhookRotation { at: string; from: string; flows: string[] }

async function webhookRotationOf(ctx: ExtensionServerCtx): Promise<WebhookRotation | null> {
  const raw = await ctx.store.get(WEBHOOK_ROTATION_KEY).catch(() => undefined)
  return raw && Array.isArray(raw.flows) ? (raw as unknown as WebhookRotation) : null
}

const MAX_WEBHOOK_BODY = 256 * 1024
const jsonResponse = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * (Re)arm a flow's schedule chain. Bumps a generation counter so any in-flight
 * chain from a prior config becomes stale (single active chain per flow). When
 * the flow isn't an enabled schedule trigger, we just persist the bump so the
 * next wake of any stale task exits. Durable: the delayed task rides the queue.
 */
async function armSchedule(ctx: ExtensionServerCtx, flowId: string, flow: Record<string, unknown>): Promise<void> {
  const key = `${SCHED_PREFIX}${flowId}`
  const prev = (await ctx.store.get(key)) as { gen?: number } | undefined
  const gen = (prev?.gen ?? 0) + 1
  const trig = resolveTrigger(flow)
  if (!(flow as { enabled?: boolean }).enabled || trig.type !== 'schedule' || !trig.schedule) {
    await ctx.store.put(key, { gen })
    return
  }
  const now = new Date()
  const nextDueAt = nextRun(trig.schedule, now).toISOString()
  await ctx.store.put(key, { gen, nextDueAt })
  const delay = Math.max(1, Math.min(SCHED_HEARTBEAT, Math.round((Date.parse(nextDueAt) - now.getTime()) / 1000)))
  await ctx.enqueue(SCHEDULE_TASK, { flowKey: `${FLOW_PREFIX}${flowId}`, gen }, { delaySeconds: delay })
}

/** Clear a flow's consecutive-failure counter (on success or re-enable). */
async function resetFailures(ctx: ExtensionServerCtx, flowId: string): Promise<void> {
  await ctx.store.remove(`${FAIL_PREFIX}${flowId}`)
}

/**
 * Circuit breaker: bump the consecutive-failure count; at the threshold, trip -
 * disable the flow, tear down its schedule chain, and record why. Returns true
 * when tripped (caller stops retrying). Manual "Run now" (force) runs never count.
 */
/** Who a run is (kernel K6): the owner's or the initiator's current authority, or the framework's where the host cannot resolve. */
async function resolveRunAs(
  ctx: ExtensionServerCtx,
  flow: FlowDef,
  event: Record<string, unknown>,
): Promise<{ ok: true; exec: ExecutionContext | null } | { ok: false; reason: string }> {
  const mode = (flow as { runAs?: 'owner' | 'initiator' | 'identity' }).runAs ?? 'owner'
  const owner = (flow as { owner?: string | null }).owner ?? (flow as { updatedBy?: string | null }).updatedBy ?? null
  const identityId = (flow as { identity?: string | null }).identity ?? null
  const eventActorKind = event.actorType === 'member' || event.actorType === 'api_key' ? (event.actorType as 'member' | 'api_key') : null
  const eventActorId = typeof event.actorId === 'string' && event.actorId ? event.actorId : null
  const initiator = eventActorKind && eventActorId ? { kind: eventActorKind, id: eventActorId } : null
  const correlationId = typeof event.correlationId === 'string' ? event.correlationId : null
  const causationId = typeof event.id === 'string' ? event.id : null
  if (!ctx.resolveActor) return { ok: true, exec: null }
  const asId = mode === 'initiator' ? initiator?.id ?? null : mode === 'identity' ? identityId : owner
  if (!asId) {
    if (mode === 'initiator') return { ok: false, reason: 'This flow runs as the initiator, but the event that triggered it has no member or key behind it' }
    if (mode === 'identity') return { ok: false, reason: 'This flow runs as an identity, but names none' }
    ctx.log('flow has no owner - running with the framework\'s authority (a flow saved before K6)')
    return { ok: true, exec: null }
  }
  // The execution has to come back MINTED from the kernel: a client's
  // authority is its execution, so one assembled here is refused. The
  // chaining this run needs is passed in rather than edited on afterwards,
  // because a copy loses the kernel's mark.
  const resolved = await ctx.resolveActor(asId, {
    kind: 'flow', source: 'flow', initiator,
    correlationId: correlationId ?? causationId ?? `flow:${asId}`, causationId,
    locale: { requested: null, enabled: false, default: null, read: { mode: 'base' }, write: null, invalid: null },
  })
  if (!resolved.ok) return { ok: false, reason: `AUTHORITY_LOST: ${resolved.reason}` }
  return { ok: true, exec: resolved.exec }
}

/**
 * K8: who a saved flow runs as, from its body: the mode and, for
 * `'identity'`, the service or agent identity - which must exist and be
 * active now (the run re-resolves it every time anyway).
 */
async function runAsOf(
  ctx: ExtensionServerCtx,
  b: { runAs?: unknown; identity?: unknown },
  existing?: { runAs?: string; identity?: string | null },
): Promise<{ runAs: 'owner' | 'initiator' | 'identity'; identity: string | null }> {
  const mode = b.runAs === 'initiator' || b.runAs === 'identity' || b.runAs === 'owner'
    ? b.runAs
    : existing?.runAs === 'initiator' || existing?.runAs === 'identity' ? existing.runAs : 'owner'
  if (mode !== 'identity') return { runAs: mode, identity: null }
  const identity = typeof b.identity === 'string' && b.identity ? b.identity : (existing?.identity ?? null)
  if (!identity) throw new RouteError(422, 'A flow that runs as an identity must name one (identity)')
  if (ctx.resolveActor && (b.identity !== undefined || existing?.identity !== identity)) {
    const resolved = await ctx.resolveActor(identity)
    if (!resolved.ok) throw new RouteError(422, `This flow cannot run as ${identity}: ${resolved.reason}`)
  }
  return { runAs: 'identity', identity }
}

async function bumpFailure(ctx: ExtensionServerCtx, flowKey: string, error: string): Promise<boolean> {
  const flowId = flowKey.slice(FLOW_PREFIX.length)
  const key = `${FAIL_PREFIX}${flowId}`
  const prev = (await ctx.store.get(key)) as { count?: number } | undefined
  const count = (prev?.count ?? 0) + 1
  const threshold = Number(ctx.options?.failureThreshold) || FAILURE_THRESHOLD
  if (count < threshold) {
    await ctx.store.put(key, { count, lastError: error })
    return false
  }
  const existing = (await ctx.store.get(flowKey)) as Record<string, unknown> | undefined
  const flow = existing && {
    ...existing,
    enabled: false,
    disabledReason: `Auto-disabled by the circuit breaker after ${count} consecutive failures. Last error: ${error}`,
    disabledAt: new Date().toISOString(),
  }
  if (flow) {
    await ctx.store.put(flowKey, flow)
    await armSchedule(ctx, flowId, flow)   // flow now disabled → schedule chain tears down
  }
  await ctx.store.remove(key)
  await recordRun(ctx, flowId, flow as { name?: string } | undefined, {
    status: 'error', ms: 0,
    log: [{ step: '-', action: 'circuit-breaker', ok: false, ms: 0, error: `Circuit opened: ${count} consecutive failures → flow disabled` }],
    triggerType: 'circuit-breaker',
  })
  return true
}

/**
 * Object triggers get the live row as trigger.data; a contributed trigger
 * (Forms' form.submitted) gets what its contributor hydrates (both best effort).
 *
 * Exported for tests: the shape downstream conditions and templates see is a
 * contract, and it is worth asserting directly rather than through a run.
 */
export async function hydrateTrigger(event: Record<string, unknown>, ctx: ExtensionServerCtx): Promise<Record<string, unknown>> {
  const payload = (event.payload ?? {}) as Record<string, unknown>
  // Which translation the write targeted, from the payload or the envelope;
  // empty for the base row. Always present as a path, so a condition can ask
  // `trigger.locale exists` without knowing whether this event carries one.
  const locale = typeof payload.locale === 'string' && payload.locale !== ''
    ? payload.locale
    : typeof event.locale === 'string' && event.locale !== '' ? event.locale : null
  const trigger: Record<string, unknown> = {
    ...event, typeName: payload.typeSlug, objectId: payload.objectId,
    locale,
    // Convenience alias for object.updated's changed field keys → conditions can
    // do `trigger.changed contains 'price'`. Empty for non-update events.
    changed: Array.isArray(payload.changedFields) ? payload.changedFields : [],
    // Old values of the changed fields (object.updated) → trigger.prev.<field>.
    prev: payload.prevData && typeof payload.prevData === 'object' ? payload.prevData : {},
  }
  // Test runs can carry pre-baked dummy data - use it verbatim instead of
  // looking up a (nonexistent) object. Real events never set event.data.
  if (event.data && typeof event.data === 'object' && !Array.isArray(event.data)) {
    trigger.data = event.data
    trigger.labels = Array.isArray((event as { labels?: unknown }).labels) ? (event as { labels?: unknown[] }).labels : []
    return trigger
  }
  // A contributed trigger may resolve what a matched flow reads of its event
  // (plan-core-slimming F1: Forms hands over the submission's values); Flows
  // never reaches into another extension's data itself.
  for (const { server, ctx: ctxFor } of ctx.registry?.() ?? []) {
    const trig = ((server as { flowTriggers?: Array<{ type: string; hydrate?: (e: Record<string, unknown>, c: ExtensionServerCtx) => Promise<Record<string, unknown>> | Record<string, unknown> }> }).flowTriggers ?? [])
      .find((t) => t.type === event.type && typeof t.hydrate === 'function')
    if (!trig) continue
    try {
      const extra = await trig.hydrate!(event, ctxFor ? await ctxFor() : ctx)
      Object.assign(trigger, extra)
    } catch { /* the contributor's store is down - the flow runs without it */ }
    return trigger
  }
  if (payload.typeSlug && payload.objectId && ctx.tangen) {
    try {
      // A LOCALIZED write is read in the locale it wrote, with the platform's
      // per-field fallback to the default. Otherwise a flow triggered by the
      // German translation would have sent the English title (the user,
      // 2026-09-19): `trigger.data` must be the row as THIS write sees it.
      const query = (ctx.tangen as any).objects(String(payload.typeSlug))
        .where({ id: { eq: String(payload.objectId) } }).limit(1)
      const res = await (locale && typeof query.locale === 'function' ? query.locale(locale) : query).get()
      if (res?.data?.[0]) trigger.data = res.data[0]
    } catch { /* deleted rows / non-object triggers have no data */ }
    try {
      // Operational labels of the triggering object → conditions can check them
      // (e.g. run-once: trigger.labels not_contains 'flow-welcomed').
      const labels = await (ctx.tangen as any).labels?.list(`content:${payload.typeSlug}`, String(payload.objectId))
      trigger.labels = Array.isArray(labels) ? labels : []
    } catch { trigger.labels = [] }
  }
  return trigger
}

/**
 * A stable fingerprint of the graph a run executed (Phase 9B, Unit 2).
 *
 * Only the parts that DECIDE behaviour: nodes, edges and the trigger. A
 * rename or a canvas drag does not change it, because neither changes what
 * ran - and a checksum that moves for cosmetic reasons tells an operator
 * nothing. Not a source-control system: enough to say "this history was
 * produced by a different graph than the one on screen".
 */
export function definitionChecksum(flow: unknown): string {
  const f = (flow ?? {}) as Record<string, unknown>
  const behaviour = {
    version: f.version ?? 1,
    trigger: f.trigger ?? null,
    conditions: f.conditions ?? null,
    steps: f.steps ?? null,
    nodes: Array.isArray(f.nodes)
      ? (f.nodes as Array<Record<string, unknown>>).map((n) => ({ id: n.id, kind: n.kind, data: n.data }))
      : null,
    edges: Array.isArray(f.edges)
      ? [...(f.edges as Array<Record<string, unknown>>)]
          .map((e) => ({ from: e.from, to: e.to, outlet: e.outlet ?? '' }))
          .sort((a, b) => `${a.from}|${a.outlet}|${a.to}`.localeCompare(`${b.from}|${b.outlet}|${b.to}`))
      : null,
  }
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(behaviour)).digest('hex').slice(0, 16)
}

/** Where a flow came from, when a preset built it (plan-connectors D1). */
export interface FlowSource {
  extensionId: string
  presetId: string
  /** The concrete thing it was added to, `<kind>:<id>` - e.g. 'form:frm_123'. */
  scope: string
}

/**
 * Runs a preset's `build` and returns the flow body to create, plus the
 * `source` to persist (plan-connectors D1).
 *
 * `build` is third-party code running inside an operator's request, so
 * everything it can get wrong is a 422 naming the preset rather than a 500:
 * an unknown id, a throw, or a graph that is not a graph. What it returns is
 * then created and compiled by the ORDINARY path, so a preset cannot enable a
 * flow this environment could not run.
 */
export function buildFromPreset(
  ctx: ExtensionServerCtx,
  input: { id?: unknown; config?: unknown; scope?: { kind?: unknown; id?: unknown } },
): { flow: Record<string, unknown>; source: FlowSource } {
  const presetId = String(input.id ?? '')
  const found = contributedPresets(ctx).get(presetId)
  if (!found) throw new RouteError(422, `No preset '${presetId}' is available here. The extension that offers it may not be active.`)
  const scope = { kind: String(input.scope?.kind ?? found.def.appliesTo.scope), id: String(input.scope?.id ?? '') }
  if (!scope.id) throw new RouteError(422, `Preset '${presetId}' needs the ${scope.kind} it is being added to.`)
  const config = (input.config ?? {}) as Record<string, unknown>
  let graph
  try {
    graph = found.def.build({ config, scope })
  } catch (e) {
    throw new RouteError(422, `Preset '${presetId}' could not be built: ${(e as Error).message}`)
  }
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length === 0) {
    throw new RouteError(422, `Preset '${presetId}' did not build a flow graph.`)
  }
  return {
    flow: {
      version: 2,
      name: graph.name ?? found.def.label,
      description: graph.description ?? found.def.description,
      nodes: graph.nodes, edges: graph.edges,
    },
    source: { extensionId: found.contributor, presetId, scope: `${scope.kind}:${scope.id}` },
  }
}

/**
 * Whether this flow can run in THIS workspace x environment right now.
 *
 * Derived on every ask from what the environment currently offers (Phase 9B,
 * Units 4 and 5). Nothing is stored: a persisted boolean would go on saying
 * "runnable" about a flow whose extension was uninstalled an hour ago.
 */
function runnableFor(ctx: ExtensionServerCtx, flow: unknown): RunnableState {
  try {
    const catalog = buildCatalog(ctx)
    return runnableState(flow as never, {
      actionNames: [...contributedActions(ctx).keys()],
      triggerTypes: catalog.triggers.map((t) => t.type),
    })
  } catch {
    // A catalogue we cannot build is not evidence that the flow is broken.
    return { runnable: true, issues: [] }
  }
}

/** A run that has stopped. `running` is the only state a later write may replace. */
const TERMINAL_RUN = new Set(['completed', 'error', 'cancelled', 'interrupted', 'skipped'])

/**
 * Latest-run pointer write. It only moves forward in time, EXCEPT that a
 * terminal status always replaces `running`.
 *
 * That exception is the fix for a defect the real acceptance run surfaced
 * (2026-09-19): the pointer and the run row were stamped from two separate
 * `new Date()` calls, so the pointer was frequently a millisecond ahead - and
 * the forward-only rule then dropped the terminal write. The flows list sat on
 * a spinner and "just now" for a run that had finished a minute earlier.
 * `openRun` now stamps both from one instant, and this rule means a finished
 * run can never be left looking unfinished however the clocks land.
 */
async function putRunMeta(
  store: ExtensionStore, flowId: string,
  meta: { status: unknown; startedAt: unknown },
): Promise<void> {
  const key = `${RUNMETA_PREFIX}${flowId}`
  const prev = await store.get(key) as { status?: string; startedAt?: string } | undefined
  const prevTs = Date.parse(String(prev?.startedAt ?? '')) || 0
  const nextTs = Date.parse(String(meta.startedAt ?? '')) || 0
  const finishes = prev?.status === 'running' && TERMINAL_RUN.has(String(meta.status))
  if (prev && prevTs > nextTs && !finishes) return
  await store.put(key, { status: meta.status, startedAt: meta.startedAt })
}

/** The pointer rule, for its own test. Not part of the extension's surface. */
export const putRunMetaForTest = putRunMeta

/** Marks every waiting run of a flow as cancelled (with the reason in its log). */
async function cancelWaitingRuns(ctx: ExtensionServerCtx, flowId: string, reason: string): Promise<number> {
  let cancelled = 0
  for (const run of await ctx.store.list(`${RUN_PREFIX}${flowId}:`)) {
    const rec = run.data as Record<string, unknown>
    // Both parked states: a run waiting for a Wait node and a run waiting for
    // a retry are equally "off means off" (Phase 9B, Unit 18).
    if (rec.status !== 'waiting' && rec.status !== 'waiting_retry') continue
    await ctx.store.put(run.key, {
      ...rec,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      log: [...(Array.isArray(rec.log) ? rec.log : []), { step: '-', action: 'cancelled', ok: false, ms: 0, error: reason }],
    })
    cancelled++
    await putRunMeta(ctx.store, flowId, { status: 'cancelled', startedAt: rec.startedAt })
  }
  return cancelled
}

/** The run key an execution owns. Deterministic, so a re-delivered job finds
 *  the record its first delivery left behind (Phase 9B, Unit 16). */
/** One id per execution, minted where the job is ENQUEUED so every delivery
 *  of that job - including a re-delivery after a crash - carries the same one. */
export function newExecutionId(): string {
  return `exec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function runKeyFor(flowId: string, executionId: string): string {
  return `${RUN_PREFIX}${flowId}:${executionId.replace(/^exec_/, '')}`
}

/**
 * Opens the run BEFORE any action runs, so an execution is visible while it is
 * happening and a crash leaves evidence instead of silence.
 *
 * Returns what the caller should do:
 *  - `run`         nothing was here, or this is a legitimate resume
 *  - `interrupted` a previous delivery started and never finished
 *  - `done`        it already reached a final state
 */
async function openRun(
  ctx: ExtensionServerCtx,
  flowId: string,
  executionId: string,
  seed: Record<string, unknown>,
): Promise<{ verdict: 'run' | 'interrupted' | 'done'; key: string; existing?: Record<string, unknown> }> {
  const key = runKeyFor(flowId, executionId)
  const existing = (await ctx.store.get(key)) as Record<string, unknown> | undefined
  if (!existing) {
    // ONE instant for both, or the pointer ends up ahead of the run it points
    // at and the forward-only rule drops the terminal write.
    const startedAt = new Date().toISOString()
    await ctx.store.put(key, { ...seed, status: 'running', startedAt })
    await putRunMeta(ctx.store, flowId, { status: 'running', startedAt })
    return { verdict: 'run', key }
  }
  const status = String(existing.status ?? '')
  if (status === 'waiting' || status === 'waiting_retry') return { verdict: 'run', key, existing }
  if (status === 'running') return { verdict: 'interrupted', key, existing }
  return { verdict: 'done', key, existing }
}

async function recordRun(
  ctx: ExtensionServerCtx,
  flowId: string,
  flow: { name?: string } | undefined,
  entry: Record<string, unknown>,
  existingKey?: string,
): Promise<string> {
  const store = ctx.store
  // A run that parked at a Wait resumes as the SAME run: merge the resumed
  // segment into the original record (status transitions waiting→final, logs
  // and paths concatenate, durations sum) instead of writing a second row.
  if (existingKey) {
    const prev = await store.get(existingKey) as Record<string, unknown> | undefined
    if (prev) {
      await store.put(existingKey, {
        ...prev,
        status: entry.status,
        ms: Number(prev.ms ?? 0) + Number(entry.ms ?? 0),
        log: [...(Array.isArray(prev.log) ? prev.log : []), ...(Array.isArray(entry.log) ? entry.log : [])],
        path: [...(Array.isArray(prev.path) ? prev.path : []), ...(Array.isArray(entry.path) ? entry.path : [])],
        resumedAt: new Date().toISOString(),
        // The resilience fields describe the run AS IT NOW STANDS, so the
        // resumed segment's values replace the parked ones rather than being
        // swallowed by the `...prev` spread (Phase 9B, Unit 19).
        attempts: Math.max(Number(prev.attempts ?? 1), Number(entry.attempts ?? 1)),
        nextRetryAt: entry.nextRetryAt ?? null,
        nextAttempt: entry.nextAttempt ?? null,
        failure: entry.failure ?? null,
        executionId: prev.executionId ?? entry.executionId,
        definition: prev.definition ?? entry.definition,
        // K6: who the run is, as it now stands.
        runAs: entry.runAs ?? prev.runAs ?? null,
        actor: entry.actor ?? prev.actor ?? null,
        initiator: entry.initiator ?? prev.initiator ?? null,
        correlationId: entry.correlationId ?? prev.correlationId ?? null,
      })
      await putRunMeta(store, flowId, { status: entry.status, startedAt: prev.startedAt })
      await sweepRuns(ctx, flowId)
      return existingKey
    }
    // record was pruned while waiting - fall through to a fresh row
  }
  const key = `${RUN_PREFIX}${flowId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const startedAt = new Date().toISOString()
  await store.put(key, { flowId, flowName: flow?.name ?? flowId, startedAt, ...entry })
  await putRunMeta(store, flowId, { status: entry.status, startedAt })
  await sweepRuns(ctx, flowId)
  return key
}

/**
 * Retention: age-based (30d default, `options.runRetentionDays` overrides) plus
 * a count cap. Runs on EVERY record write, not only when a fresh row is
 * created - since Phase 9B a run's row is opened before its actions, so the
 * "new row" path is no longer where most writes land.
 */
async function sweepRuns(ctx: ExtensionServerCtx, flowId: string): Promise<void> {
  const store = ctx.store
  const runs = await store.list(`${RUN_PREFIX}${flowId}:`)
  const retentionDays = Number(ctx.options?.runRetentionDays) || 30
  const cutoff = Date.now() - retentionDays * 86_400_000
  // Sort newest-first explicitly - the count cap must keep the NEWEST runs
  // regardless of the store's key ordering.
  const dated = runs
    .map((run) => ({ key: run.key, started: Date.parse(String((run.data as { startedAt?: string }).startedAt ?? '')) || 0 }))
    .sort((a, b) => b.started - a.started)
  for (const [i, run] of dated.entries()) {
    if (i >= RUNS_KEPT_PER_FLOW || run.started < cutoff) await store.remove(run.key)
  }
}

/**
 * The structured event seam (Phase 9B, Unit 20). Bounded operational metadata
 * only - ids, a status, a duration, a safe error CODE. Never node input or
 * output. Phase 9C owns sinks, sampling and retention; this owns nothing but
 * the shape, and it rides the platform's own bus.
 */
function emitFlowEvent(
  ctx: ExtensionServerCtx,
  name: string,
  data: { executionId?: string; flowId: string; nodeId?: string; attempt?: number; ms?: number; status?: string; code?: string; nextRetryAt?: string },
): void {
  try { ctx.emit?.(name, data as unknown as Record<string, unknown>) } catch { /* observation must never fail a run */ }
}

export default defineExtensionServer({
  // ── Trigger tap: matching enabled flows ride the durable queue ────────────
  events: [{
    types: '*',   // registry-driven: flows can trigger on custom:/ext: events too
    handler: async (event, ctx) => {
      const flows = await ctx.store.list(FLOW_PREFIX)
      const payload = ((event as unknown as Record<string, unknown>).payload ?? {}) as Record<string, unknown>
      // Hydrated lazily + reused: only flows with a condition filter pay for it,
      // and the live row is fetched at most once per event.
      let scope: FlowScope | undefined
      for (const { key, data } of flows) {
        const flow = data as unknown as Record<string, unknown>
        if (!(flow as { enabled?: boolean }).enabled) continue
        const trig = resolveTrigger(flow)
        if (trig.type !== event.type) continue
        if (trig.typeName && trig.typeName !== payload.typeSlug) continue
        if (trig.conditions?.length) {
          if (!scope) scope = { trigger: await hydrateTrigger(event as unknown as Record<string, unknown>, ctx), steps: [] }
          if (!evaluateConditions(trig.conditions, scope)) continue
        }
        // Revalidated HERE, not at save time: a flow valid yesterday can be
        // broken today because somebody disabled the extension that provides
        // one of its actions (Phase 9B, Unit 5). No execution starts on a
        // dependency that is not there.
        if (!runnableFor(ctx, flow).runnable) continue
        await ctx.enqueue(EXECUTE_TASK, { flowKey: key, event, executionId: newExecutionId() })
      }
    },
  }, {
    // K8.6: an uninstalled extension took its action and trigger names with it - pause the flows that used them.
    types: ['extension.uninstalled'],
    handler: async (event, ctx) => {
      const payload = ((event as unknown as Record<string, unknown>).payload ?? {}) as { extensionId?: unknown; contributions?: Record<string, string[]> }
      if (typeof payload.extensionId !== 'string') return
      const paused = await pauseFlowsForRemovedNodes(ctx.store as never, {
        extensionId: payload.extensionId,
        actions: payload.contributions?.['flow.actions@1'] ?? [],
        triggers: payload.contributions?.['flow.triggers@1'] ?? [],
      })
      if (paused.length) ctx.log(`paused ${paused.length} flow(s) that used nodes from the uninstalled extension '${payload.extensionId}'`)
    },

  }],

  // ── Execution (durable, retried, visible in Settings → Jobs → Runs) ──────
  tasks: [{
    name: 'execute',
    description: 'Executes one flow against one trigger event',
    handler: async (payload, ctx) => {
      const { flowKey, event, resumeNodeId, priorSteps, priorStepsById, force, runKey, flowSnapshot, attempt, executionId } = payload as {
        flowKey: string; event: Record<string, unknown>
        resumeNodeId?: string
        priorSteps?: Array<Record<string, unknown>>
        priorStepsById?: Record<string, { output: unknown }>
        force?: boolean   // manual "Run now" runs even while disabled
        runKey?: string   // resumed segment - merge into this run record
        flowSnapshot?: FlowDef   // version pin - a run finishes on the graph it started on
        attempt?: number        // which attempt the RESUMED node is on (Phase 9B)
        executionId?: string    // the stable half of every idempotency key (Phase 9B)
      }
      // Resumed segment: a cancelled run stays cancelled - even if the flow
      // was re-enabled in the meantime (off cancelled it; on applies to
      // FUTURE events, not parked remainders).
      if (runKey) {
        const rec = await ctx.store.get(runKey) as Record<string, unknown> | undefined
        // A cancelled run stays cancelled, and so does one an operator
        // cancelled while it was waiting for a retry (Phase 9B, Unit 18).
        if (!rec || rec.status === 'cancelled') return
        // A cancellation requested while the run was executing elsewhere takes
        // effect HERE, at the next boundary - which is what "cooperative" means.
        if (rec.cancelRequested === true) {
          await ctx.store.put(runKey, { ...rec, status: 'cancelled' })
          await putRunMeta(ctx.store, flowKey.slice(FLOW_PREFIX.length), { status: 'cancelled', startedAt: rec.startedAt })
          return
        }
      }
      const data = await ctx.store.get(flowKey)
      if (!data) return   // deleted between enqueue and run
      const flow = data as unknown as FlowDef
      if (!flow.enabled && !force) {
        // Disabled after parking but before the sweep caught it - close the
        // record out honestly rather than leaving it 'waiting' forever.
        if (runKey) await cancelWaitingRuns(ctx, flowKey.slice(FLOW_PREFIX.length), 'Flow was turned off while this run was waiting.')
        return
      }
      // The last revalidation boundary: between the queue accepting this job
      // and the first action running, a dependency can have gone away. A
      // deterministic refusal beats a compile error dressed as a step failure,
      // and it does not count against the circuit breaker (Phase 9B, Unit 5).
      const preflight = runnableFor(ctx, flowSnapshot ?? flow)
      if (!preflight.runnable) {
        const blocking = preflight.issues.filter((i) => i.level === 'error')
        await recordRun(ctx, flowKey.slice(FLOW_PREFIX.length), flow, {
          status: 'error', ms: 0, path: [], triggerType: String(event.type ?? ''),
          log: blocking.map((i) => ({ step: i.nodeId ?? '-', action: 'dependency', ok: false, ms: 0, error: i.message })),
          failure: { code: 'FLOW_NOT_RUNNABLE', message: blocking[0]?.message ?? 'This flow cannot run here.', retryable: 'non_retryable' },
          issues: blocking,
        }, runKey)
        return
      }

      // K6: whose authority this run uses. `owner` (the default): the flow's
      // owner's CURRENT authority, re-resolved now; `initiator`: the member or
      // key whose event triggered it. A host without the resolver (a minimal
      // embedding, the unit tests) runs the flow with the framework's
      // authority, as before K6. An owner who lost their authority is refused
      // ONCE: recorded, counted by the breaker, never retried.
      const runAs = await resolveRunAs(ctx, flow, event)
      if (!runAs.ok) {
        await bumpFailure(ctx, flowKey, runAs.reason)
        await recordRun(ctx, flowKey.slice(FLOW_PREFIX.length), flow, {
          status: 'error', ms: 0, path: [], triggerType: String(event.type ?? ''),
          log: [{ step: '-', action: 'run-as', ok: false, ms: 0, error: runAs.reason }],
          failure: { code: 'AUTHORITY_LOST', message: runAs.reason, retryable: 'non_retryable' },
          runAs: (flow as { runAs?: string }).runAs ?? 'owner', actor: null,
        }, runKey)
        return
      }
      const runCtx: ExtensionServerCtx = runAs.exec ? { ...ctx, exec: runAs.exec, tangen: ctx.clientFor ? ctx.clientFor(runAs.exec) : ctx.tangen } : ctx

      const trigger = await hydrateTrigger(event, ctx)
      const contributed = contributedActions(runCtx)
      // Version pin: a resumed run executes the graph it PARKED with, not the
      // live (possibly edited) one - edits apply to future runs only. The live
      // flow still governs lifecycle (enabled/cancelled checks above).
      const effective = resumeNodeId && flowSnapshot ? flowSnapshot : flow
      const flowId0 = flowKey.slice(FLOW_PREFIX.length)
      const flowMeta = { flowId: flowId0, flowName: flow.name }
      // One identity for the whole execution, minted on the first segment and
      // carried by the queue through every wait and every retry. It is half of
      // every idempotency key an action sees.
      const execId = executionId ?? `exec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const checksum = definitionChecksum(effective)

      // Open the run BEFORE the first action, so a worker that dies leaves
      // evidence rather than silence (Phase 9B, Unit 16).
      const opened = await openRun(ctx, flowId0, execId, {
        flowId: flowId0, flowName: flow.name, executionId: execId,
        definition: { checksum, version: (effective as { version?: number }).version ?? 1 },
        triggerType: String(event.type ?? ''), attempts: attempt ?? 1, log: [], path: [], ms: 0,
      })
      if (opened.verdict === 'done') return
      if (opened.verdict === 'interrupted') {
        // A previous delivery of this job started and never finished. Tangen
        // cannot know how far it got, so it does not repeat it: an action that
        // already sent an email would send a second one, and nothing here can
        // tell whether it did. The operator decides.
        await ctx.store.put(opened.key, {
          ...(opened.existing ?? {}),
          status: 'error',
          failure: {
            code: 'FLOW_INTERRUPTED',
            message: 'This run started and did not finish - the worker stopped part-way through. Tangen cannot know which actions had already run, so it has not repeated them. Review what happened and retry it if that is safe.',
            retryable: 'non_retryable',
          },
          interruptedAt: new Date().toISOString(),
          log: [...(Array.isArray(opened.existing?.log) ? opened.existing!.log as unknown[] : []),
            { step: '-', action: 'recovery', ok: false, ms: 0, error: 'Interrupted: the worker stopped part-way through this run.' }],
        })
        await putRunMeta(ctx.store, flowId0, { status: 'error', startedAt: opened.existing?.startedAt })
        emitFlowEvent(ctx, 'execution.failed', { executionId: execId, flowId: flowId0, code: 'FLOW_INTERRUPTED' })
        return
      }
      emitFlowEvent(ctx, 'execution.started', { executionId: execId, flowId: flowId0, attempt: attempt ?? 1 })

      const result = await executeFlow(effective, trigger, contributedCtx(runCtx, contributed, 0, flowMeta, await allowPrivateOf(runCtx)), {
        resumeNodeId, priorSteps, priorStepsById, extraActions: [...contributed.keys()],
        attempt, executionId: execId,
      })
      const attempts = Math.max(attempt ?? 1, result.nextAttempt ? result.nextAttempt - 1 : (attempt ?? 1))
      const recordedKey = await recordRun(ctx, flowId0, flow, {
        status: result.status, ms: result.ms, log: result.log, path: result.path,
        triggerType: String(event.type ?? ''),
        // What ran, on which graph, and how far into its attempts (Unit 19).
        executionId: execId,
        // K6: who the run was, on the record.
        runAs: (flow as { runAs?: string }).runAs ?? 'owner',
        actor: runAs.exec ? { kind: runAs.exec.actor.identity.kind, id: runAs.exec.actor.identity.id } : null,
        initiator: runAs.exec?.initiator ?? null,
        correlationId: runAs.exec?.correlationId ?? null,
        definition: { checksum, version: (effective as { version?: number }).version ?? 1 },
        attempts,
        ...(result.failure ? { failure: result.failure } : {}),
        ...(result.status === 'waiting_retry'
          ? { nextRetryAt: new Date(Date.now() + (result.delaySeconds ?? 0) * 1000).toISOString(), nextAttempt: result.nextAttempt }
          : { nextRetryAt: null, nextAttempt: null }),
      }, runKey ?? opened.key)
      if (result.status === 'waiting_retry') {
        // The retry rides the SAME durable queue the wait node uses - nothing
        // sleeps, and the backoff survives a restart because the queue holds
        // it, not this process (Phase 9B, Unit 9).
        emitFlowEvent(ctx, 'node.retry_scheduled', {
          executionId: execId, flowId: flowId0, nodeId: result.resumeNodeId, attempt: result.nextAttempt,
          code: result.failure?.code, nextRetryAt: new Date(Date.now() + (result.delaySeconds ?? 0) * 1000).toISOString(),
        })
        await ctx.enqueue(EXECUTE_TASK, {
          flowKey, event, resumeNodeId: result.resumeNodeId,
          priorSteps: result.priorSteps, priorStepsById: result.priorStepsById,
          runKey: recordedKey, attempt: result.nextAttempt, executionId: execId,
          flowSnapshot: flowSnapshot ?? flow,
          force,
        }, { delaySeconds: result.delaySeconds })
        return
      }
      if (result.status === 'waiting') {
        // The remainder rides the queue with a delay - nothing sleeps. The
        // run record's key rides along so the resumed segment merges into
        // the SAME run (waiting → completed, one row).
        await ctx.enqueue(EXECUTE_TASK, {
          flowKey, event, resumeNodeId: result.resumeNodeId,
          priorSteps: result.priorSteps, priorStepsById: result.priorStepsById,
          runKey: recordedKey, executionId: execId,
          // Pin the graph this run started on (chained waits carry it forward)
          flowSnapshot: flowSnapshot ?? flow,
        }, { delaySeconds: result.delaySeconds })
        return
      }
      const flowId = flowId0
      if (result.status === 'completed' || result.status === 'skipped') {
        await resetFailures(ctx, flowId)   // a clean run clears the breaker
        emitFlowEvent(ctx, 'execution.succeeded', { executionId: execId, flowId, status: result.status, ms: result.ms })
      }
      if (result.status === 'error') {
        const failed = result.log.find((l) => !l.ok)
        emitFlowEvent(ctx, 'execution.failed', {
          executionId: execId, flowId, nodeId: result.failure?.nodeId, attempt: attempts,
          ms: result.ms, code: result.failure?.code,
        })
        // Manual "Run now" (force) failures are intentional testing → never trip the breaker.
        if (!force) {
          const tripped = await bumpFailure(ctx, flowKey, `${failed?.step}: ${failed?.error}`)
          if (tripped) return   // circuit opened - flow disabled, stop retrying
        }
        throw new Error(`flow "${flow.name}" failed at ${failed?.step}: ${failed?.error}`)
      }
    },
  }, {
    // ── Schedule trigger: a durable self-rescheduling chain (no platform cron
    //    needed). Each wake fires if due, then re-arms; a generation guard keeps
    //    exactly one chain per flow even across edits/enable toggles.
    name: 'schedule',
    description: 'Fires a scheduled flow when due, then re-arms the next occurrence',
    handler: async (payload, ctx) => {
      const { flowKey, gen } = payload as { flowKey: string; gen: number }
      const flowId = flowKey.slice(FLOW_PREFIX.length)
      const key = `${SCHED_PREFIX}${flowId}`
      const state = (await ctx.store.get(key)) as { gen?: number; nextDueAt?: string } | undefined
      if (!state || state.gen !== gen) return   // stale chain (re-armed / disabled)

      const flow = (await ctx.store.get(flowKey)) as Record<string, unknown> | undefined
      const trig = flow ? resolveTrigger(flow) : {}
      if (!flow || !(flow as { enabled?: boolean }).enabled || trig.type !== 'schedule' || !trig.schedule) {
        await ctx.store.remove(key)   // no longer a scheduled flow → let the chain die
        return
      }

      const now = new Date()
      let nextDueAt = state.nextDueAt ?? nextRun(trig.schedule, now).toISOString()
      if (Date.parse(nextDueAt) <= now.getTime()) {
        const event = {
          type: 'schedule', workspaceId: ctx.workspaceId, payload: { scheduledAt: now.toISOString(), timezone: trig.schedule.timezone || 'UTC' },
        }
        await ctx.enqueue(EXECUTE_TASK, { flowKey, event, executionId: newExecutionId() })
        nextDueAt = nextRun(trig.schedule, now).toISOString()
        await ctx.store.put(key, { gen, nextDueAt })
      }
      const delay = Math.max(1, Math.min(SCHED_HEARTBEAT, Math.round((Date.parse(nextDueAt) - now.getTime()) / 1000)))
      await ctx.enqueue(SCHEDULE_TASK, { flowKey, gen }, { delaySeconds: delay })
    },
  }],

  // ── The builder's API (member auth; writes need manage:settings) ─────────
  // UPGRADE (E.16): the inbound webhook URL changed form in 0.1.148 (the
  // extension's own route, its own secret). URLs minted before answer 410 on
  // purpose; every enabled webhook flow is named here, and the Admin shows
  // the notice on the flow until it is saved again.
  onUpgrade: async (ctx, { from, to }) => {
    ctx.log(`upgraded ${from ?? 'unknown'} -> ${to}`)
    const rows = await ctx.store.list(FLOW_PREFIX)
    const affected = rows
      .filter(({ data }) => (data as { enabled?: boolean }).enabled === true && resolveTrigger(data as Record<string, unknown>).type === 'webhook')
      .map(({ key, data }) => ({ id: key.slice(FLOW_PREFIX.length), name: String((data as { name?: unknown }).name ?? '') }))
    if (affected.length === 0) return
    await ctx.store.put(WEBHOOK_ROTATION_KEY, { at: new Date().toISOString(), from: RETIRED_WEBHOOK_FORM, flows: affected.map((f) => f.id) } as never)
    for (const f of affected) ctx.log(`webhook URL changed for flow '${f.name}' (${f.id}): URLs under /api/v1/hooks/flows/ minted before Flows 0.1.148 answer 410 - open the flow and copy the new URL into the sender`)
  },

  adminRoutes: [
    {
      // E.10: the inbound webhook receiver, the extension's own public route
      // (it used to be a core route verifying with JWT_SECRET). The token in
      // the URL is the credential; a wrong or foreign one is a 404, never a
      // hint. An optional X-Tangen-Signature body HMAC guards the payload.
      method: 'POST', path: 'hooks/:token', auth: 'public',
      handler: async (req, ctx) => {
        const claims = await verifyWebhookToken(ctx, req.params.token)
        if (!claims) return jsonResponse(404, { error: 'Not found' })
        const flow = (await ctx.store.get(`${FLOW_PREFIX}${claims.f}`)) as Record<string, unknown> | undefined
        const trig = flow ? resolveTrigger(flow) : null
        if (!flow || !(flow as { enabled?: boolean }).enabled || trig?.type !== 'webhook') return jsonResponse(404, { error: 'Not found' })
        let bodyText = ''
        try { bodyText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}) } catch { bodyText = '' }
        if (bodyText.length > MAX_WEBHOOK_BODY) return jsonResponse(413, { error: 'Payload too large' })
        if (trig.secret) {
          const provided = Buffer.from(String((req.headers as Record<string, string> | undefined)?.['x-tangen-signature'] ?? ''))
          const expected = Buffer.from(`sha256=${new Bun.CryptoHasher('sha256', String(trig.secret)).update(bodyText).digest('hex')}`)
          if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return jsonResponse(401, { error: 'Bad signature' })
        }
        let payload: unknown = {}
        try { payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}) } catch { payload = {} }
        await ctx.enqueue(EXECUTE_TASK, { flowKey: `${FLOW_PREFIX}${claims.f}`, event: { type: 'webhook', workspaceId: ctx.workspaceId, payload } })
        return jsonResponse(202, { queued: true })
      },
    },
    {
      method: 'GET', path: 'flows', capability: 'read:flows',
      handler: async (req, ctx) => {
        const all = await ctx.store.list(FLOW_PREFIX)
        // D1: `?scope=form:frm_123` answers a host asking "which flows belong
        // to THIS form" - the destinations it offered, and no one else's.
        const wantScope = typeof req.query.scope === 'string' && req.query.scope !== '' ? req.query.scope : undefined
        const rows = wantScope
          ? all.filter(({ data }) => (data as { source?: { scope?: string } }).source?.scope === wantScope)
          : all
        // Latest run per flow from the tiny runmeta pointers - NOT the full
        // run rows (those carry complete step logs; at the 300-runs/flow cap
        // that would be megabytes per list view).
        let metaRows = await ctx.store.list(RUNMETA_PREFIX)
        if (metaRows.length === 0 && rows.length > 0) {
          // Self-heal for stores that predate runmeta: derive once, persist.
          const runRows = await ctx.store.list(RUN_PREFIX)
          const derived: Record<string, { status: unknown; startedAt: unknown }> = {}
          for (const { data } of runRows) {
            const r = data as Record<string, unknown>
            const fid = String(r.flowId ?? '')
            const t = Date.parse(String(r.startedAt ?? '')) || 0
            const cur = derived[fid]
            if (!cur || t > (Date.parse(String(cur.startedAt ?? '')) || 0)) derived[fid] = { status: r.status, startedAt: r.startedAt }
          }
          for (const [fid, meta] of Object.entries(derived)) await ctx.store.put(`${RUNMETA_PREFIX}${fid}`, meta)
          metaRows = await ctx.store.list(RUNMETA_PREFIX)
        }
        const lastByFlow: Record<string, { status: unknown; startedAt: unknown }> = {}
        for (const { key, data } of metaRows) {
          lastByFlow[key.slice(RUNMETA_PREFIX.length)] = data as { status: unknown; startedAt: unknown }
        }
        // Dependency check: a flow can break after it was enabled (e.g. a
        // contributed action's extension was removed). Surface the first
        // compile error so the list can flag it.
        return { data: rows.map(({ key, data }) => {
          const id = key.slice(FLOW_PREFIX.length)
          const state = runnableFor(ctx, data)
          const firstError = state.issues.find((i) => i.level === 'error')
          return {
            id, ...data, lastRun: lastByFlow[id] ?? null,
            // Derived on every read, so it cannot drift from the record.
            origin: flowOrigin(data),
            // `enabled` is the operator's INTENT; `runnable` is what this
            // environment can currently deliver. A list that showed only one
            // of them would show a broken flow as off (Phase 9B, Unit 21).
            runnable: state.runnable,
            issues: state.issues,
            broken: firstError?.message ?? null,
          }
        }) }
      },
    },
    {
      method: 'GET', path: 'flows/:id', capability: 'read:flows',
      handler: async (req, ctx) => {
        const data = await ctx.store.get(`${FLOW_PREFIX}${req.params.id}`)
        if (!data) throw new Error('Flow not found')
        const state = runnableFor(ctx, data)
        return { data: { id: req.params.id, ...data, runnable: state.runnable, issues: state.issues, origin: flowOrigin(data) } }
      },
    },
    {
      method: 'POST', path: 'flows', capability: 'manage:flows',
      handler: async (req, ctx) => {
        const b = (req.body ?? {}) as Partial<FlowDef>
        // D1: a preset builds the graph here, once, and the flow is then an
        // ordinary flow - same store, same create path, same `manage:flows`,
        // owned by the operator who added it. `source` records where it came
        // from so a host can list its own destinations.
        const presetInput = (req.body as { preset?: { id?: unknown; config?: unknown; scope?: { kind?: unknown; id?: unknown } } } | undefined)?.preset
        const built = presetInput ? buildFromPreset(ctx, presetInput) : null
        if (built) Object.assign(b as Record<string, unknown>, built.flow)
        if (!b.name) throw new Error('name is required')
        if ((b as Record<string, unknown>).version !== 2 && !b.trigger?.type) throw new Error('name and trigger.type are required')
        const id = newId()
        // ONE instant for created and updated: two `new Date()` calls would
        // make a brand-new flow look edited (the same defect the run pointer
        // had, 2026-09-19).
        const stampedAt = new Date().toISOString()
        const runAsFields = await runAsOf(ctx, b as never)
        const v2body = (b as unknown as Record<string, unknown>).version === 2
        const flow = v2body
          ? {
              version: 2, name: String(b.name), description: b.description,
              enabled: b.enabled ?? false,
              nodes: (b as unknown as { nodes?: unknown[] }).nodes ?? [],
              edges: (b as unknown as { edges?: unknown[] }).edges ?? [],
              updatedBy: req.memberId, updatedAt: stampedAt,
              // Provenance: when it was created and who by, so "a person has
              // edited this since the preset built it" is a fact rather than a
              // guess, and the list can tell a pack's flow from a drawn one.
              createdAt: stampedAt, createdBy: req.memberId ?? null,
              editedBy: { kind: 'member', id: req.memberId ?? null },
              // K6: the flow runs as its creator by default, with their authority re-resolved at every run.
              owner: req.memberId ?? null, ...runAsFields,
              ...(built ? { source: built.source } : {}),
            }
          : {
              version: 1, name: String(b.name), description: b.description,
              enabled: b.enabled ?? false,
              trigger: { type: b.trigger!.type, typeName: b.trigger!.typeName },
              conditions: b.conditions ?? [], steps: b.steps ?? [],
              updatedBy: req.memberId, updatedAt: stampedAt,
              createdAt: stampedAt, createdBy: req.memberId ?? null,
              editedBy: { kind: 'member', id: req.memberId ?? null },
              // K6: the flow runs as its creator by default, with their authority re-resolved at every run.
              owner: req.memberId ?? null, ...runAsFields,
            }
        if (flow.enabled) {
          const compiled = compileFlow(migrateFlow(flow as never), { extraActions: [...contributedActions(ctx).keys()] })
          if (compiled.errors.length) throw new RouteError(422, `Cannot enable: ${compiled.errors.join(' ')}`)
        }
        await ctx.store.put(`${FLOW_PREFIX}${id}`, flow as unknown as Record<string, unknown>)
        await armSchedule(ctx, id, flow as unknown as Record<string, unknown>)
        return { data: { id, ...flow } }
      },
    },
    {
      method: 'PATCH', path: 'flows/:id', capability: 'manage:flows',
      handler: async (req, ctx) => {
        const key = `${FLOW_PREFIX}${req.params.id}`
        const existing = await ctx.store.get(key)
        if (!existing) throw new Error('Flow not found')
        // E.16: saving the flow acknowledges a webhook URL rotation.
        const rotation = await webhookRotationOf(ctx)
        if (rotation?.flows.includes(req.params.id)) await ctx.store.put(WEBHOOK_ROTATION_KEY, { ...rotation, flows: rotation.flows.filter((f) => f !== req.params.id) })
        const b = (req.body ?? {}) as Partial<FlowDef>
        const bb = b as unknown as { nodes?: unknown[]; edges?: unknown[] }
        const runAsFields = await runAsOf(ctx, b as never, existing as never)
        const flow = {
          ...existing, ...b,
          trigger: b.trigger ?? existing.trigger,
          conditions: b.conditions ?? existing.conditions,
          steps: b.steps ?? existing.steps,
          nodes: bb.nodes ?? (existing as { nodes?: unknown[] }).nodes,
          edges: bb.edges ?? (existing as { edges?: unknown[] }).edges,
          updatedBy: req.memberId, updatedAt: new Date().toISOString(),
          // What made the change last. Created-by never moves; this does.
          editedBy: { kind: 'member', id: req.memberId ?? null },
          createdAt: (existing as { createdAt?: string }).createdAt,
          // K6: ownership survives an edit (a flow saved before K6 gets its last editor); reassigning it is an explicit field.
          owner: b.owner !== undefined ? b.owner : ((existing as { owner?: string | null }).owner ?? (existing as { updatedBy?: string | null }).updatedBy ?? req.memberId ?? null),
          ...runAsFields,
        }
        if ((flow as { enabled?: boolean }).enabled) {
          // Saving a broken flow is allowed - an author keeps unfinished work.
          // ENABLING one is not: it would sit there looking armed (Unit 3).
          const state = runnableFor(ctx, flow)
          if (!state.runnable) {
            throw new RouteError(422, `Cannot enable: ${state.issues.filter((i) => i.level === 'error').map((i) => i.message).join(' ')}`)
          }
          delete (flow as Record<string, unknown>).disabledReason   // fresh start
          delete (flow as Record<string, unknown>).disabledAt
        } else if ((existing as { enabled?: boolean }).enabled) {
          // Turning OFF cancels runs parked at a Wait - off means off (no
          // surprise email three days later). Cancellation is definitive:
          // the resume guard skips cancelled records even if re-enabled.
          await cancelWaitingRuns(ctx, req.params.id, 'Flow was turned off while this run was waiting.')
        }
        await ctx.store.put(key, flow)
        await armSchedule(ctx, req.params.id, flow as Record<string, unknown>)
        // Re-enabling clears any tripped breaker so it gets a fresh streak.
        if ((flow as { enabled?: boolean }).enabled) await resetFailures(ctx, req.params.id)
        const wasEnabled = (existing as { enabled?: boolean }).enabled === true
        const isEnabled = (flow as { enabled?: boolean }).enabled === true
        const activityEvent = isEnabled !== wasEnabled ? (isEnabled ? 'flow.enabled' : 'flow.disabled') : 'flow.updated'
        ctx.emit?.(activityEvent, { flowId: req.params.id, name: (flow as { name?: string }).name ?? req.params.id }, { actorId: req.memberId ?? null, actorType: req.memberId ? 'member' : null })
        return { data: { id: req.params.id, ...flow } }
      },
    },
    {
      method: 'DELETE', path: 'flows/:id', capability: 'manage:flows',
      handler: async (req, ctx) => {
        const existing = await ctx.store.get(`${FLOW_PREFIX}${req.params.id}`) as { name?: string } | undefined
        await ctx.store.remove(`${FLOW_PREFIX}${req.params.id}`)
        await ctx.store.remove(`${SCHED_PREFIX}${req.params.id}`)   // stops any schedule chain
        await ctx.store.remove(`${RUNMETA_PREFIX}${req.params.id}`)
        // Run history SURVIVES deletion (audit trail) - retention ages it out
        // via the expiry sweep in GET runs. Parked runs can never resume
        // (the flow is gone), so close them out honestly.
        await cancelWaitingRuns(ctx, req.params.id, 'Flow was deleted while this run was waiting.')
        ctx.emit?.('flow.deleted', { flowId: req.params.id, name: existing?.name ?? req.params.id }, { actorId: req.memberId ?? null, actorType: req.memberId ? 'member' : null })
        return { data: { deleted: true } }
      },
    },
    {
      // Test-run NOW with a sample payload - returns the step log inline
      method: 'POST', path: 'flows/:id/test', capability: 'manage:flows',
      handler: async (req, ctx) => {
        const data = await ctx.store.get(`${FLOW_PREFIX}${req.params.id}`)
        if (!data) throw new Error('Flow not found')
        const flow = data as unknown as FlowDef
        // v2 flows carry the trigger on a node; v1 on flow.trigger
        const triggerNode = (flow as unknown as { nodes?: Array<{ kind: string; data: Record<string, unknown> }> })
          .nodes?.find((n) => n.kind === 'trigger')
        const tType = String((flow as { trigger?: { type?: string } }).trigger?.type ?? triggerNode?.data.type ?? 'object.published')
        const tName = (flow as { trigger?: { typeName?: string } }).trigger?.typeName ?? (triggerNode?.data.typeName as string | undefined)
        // Optional dummy trigger from the builder's test dialog:
        // { trigger: { data?: {...}, payload?: {...}, labels?: [...] } }
        const body = (req.body ?? {}) as Record<string, unknown>
        const dummy = (body.trigger ?? {}) as Record<string, unknown>
        const dummyData = dummy.data && typeof dummy.data === 'object' ? dummy.data as Record<string, unknown> : undefined
        const sample = (body.event ?? {
          type: tType, workspaceId: ctx.workspaceId, payload: {
            objectId: (dummyData?.id as string) ?? 'test', typeSlug: tName ?? 'test', title: 'Test run',
            ...(dummy.payload && typeof dummy.payload === 'object' ? dummy.payload as Record<string, unknown> : {}),
          },
          ...(dummyData ? { data: dummyData } : {}),
          ...(Array.isArray(dummy.labels) ? { labels: dummy.labels } : {}),
        }) as Record<string, unknown>
        const trigger = await hydrateTrigger(sample, ctx)
        const contributed = contributedActions(ctx)
        // Dry run is the default - write-actions are simulated unless the
        // builder explicitly asks for a real test ({ dryRun: false }).
        const dryRun = body.dryRun !== false
        const result = await executeFlow(flow, trigger, contributedCtx(ctx, contributed, 0, { flowId: req.params.id, flowName: flow.name }, await allowPrivateOf(ctx)), { extraActions: [...contributed.keys()], testMode: true, dryRun })
        await recordRun(ctx, req.params.id, flow, {
          status: result.status, ms: result.ms, log: result.log, triggerType: 'test',
        })
        return { data: result }
      },
    },
    {
      // Manual "Run now" - enqueues a REAL run (durable, wait-capable, recorded
      // in Runs) with a synthetic manual event. `force` runs even while disabled
      // so you can invoke a flow you're still building.
      method: 'POST', path: 'flows/:id/run', capability: 'manage:flows',
      handler: async (req, ctx) => {
        const flowKey = `${FLOW_PREFIX}${req.params.id}`
        if (!(await ctx.store.get(flowKey))) throw new Error('Flow not found')
        const event = {
          type: 'manual', workspaceId: ctx.workspaceId, payload: ((req.body as Record<string, unknown>)?.payload ?? {}) as Record<string, unknown>,
        }
        await ctx.enqueue(EXECUTE_TASK, { flowKey, event, force: true, executionId: newExecutionId() })
        return { data: { queued: true } }
      },
    },
    {
      /**
       * RETRY: continue THIS execution from the node that failed, on the graph
       * it started on, with the outputs it had already produced. It is not a
       * rerun - the nodes that succeeded are not run again - and the phase
       * deliberately does not offer a "replay" button, because replaying from
       * the original trigger against the CURRENT graph is a different
       * operation with different risks and 9B does not implement it.
       */
      method: 'POST', path: 'flows/:id/runs/:runId/retry', capability: 'manage:flows',
      handler: async (req, ctx) => {
        const runKey = `${RUN_PREFIX}${req.params.id}:${req.params.runId}`
        const run = (await ctx.store.get(runKey)) as Record<string, unknown> | undefined
        if (!run) throw new Error('Run not found')
        if (run.status !== 'error') throw new Error(`Only a failed run can be retried (this one is ${String(run.status)}).`)

        const failed = (Array.isArray(run.log) ? run.log as Array<Record<string, unknown>> : []).find((l) => l.ok === false)
        const resumeNodeId = String(failed?.step ?? '')
        if (!resumeNodeId || resumeNodeId === '-') {
          throw new Error('This run did not fail at a node, so there is nothing to resume from. Run the flow again instead.')
        }

        const flowKey = `${FLOW_PREFIX}${req.params.id}`
        const flow = await ctx.store.get(flowKey)
        if (!flow) throw new Error('Flow not found')
        const state = runnableFor(ctx, flow)
        if (!state.runnable) {
          throw new Error(`This flow cannot run here: ${state.issues.find((i) => i.level === 'error')?.message ?? 'a dependency is missing'}`)
        }

        // The outputs the run already produced, exactly as the executor
        // recorded them. Loop-body entries (`node[i]`) are per-iteration and
        // are not part of the resumable scope.
        const priorStepsById: Record<string, { output: unknown }> = {}
        const priorSteps: Array<Record<string, unknown>> = []
        for (const line of (Array.isArray(run.log) ? run.log as Array<Record<string, unknown>> : [])) {
          const step = String(line.step ?? '')
          if (!step || step === '-' || step.includes('[') || line.ok === false) continue
          if (line.output === undefined) continue
          priorStepsById[step] = { output: line.output }
          priorSteps.push((line.output ?? {}) as Record<string, unknown>)
        }

        await ctx.store.put(runKey, {
          ...run, status: 'waiting_retry', failure: null,
          retriedBy: req.memberId ?? null, retriedAt: new Date().toISOString(),
        })
        await ctx.enqueue(EXECUTE_TASK, {
          flowKey,
          event: { type: String(run.triggerType ?? 'manual'), workspaceId: ctx.workspaceId, payload: {} },
          resumeNodeId, priorSteps, priorStepsById,
          runKey, executionId: String(run.executionId ?? ''),
          attempt: Number(run.attempts ?? 1) + 1,
          force: true,
        })
        return { data: { queued: true, resumeNodeId } }
      },
    },
    {
      /**
       * CANCEL. Honest about what it can do: a queued or parked run is stopped
       * before it does anything else, because the next delivery checks. A run
       * that is executing INSIDE another process right now cannot be stopped
       * from here - the request is recorded and takes effect at that run's
       * next boundary, and the response says which of the two happened.
       */
      method: 'POST', path: 'flows/:id/runs/:runId/cancel', capability: 'manage:flows',
      handler: async (req, ctx) => {
        const runKey = `${RUN_PREFIX}${req.params.id}:${req.params.runId}`
        const run = (await ctx.store.get(runKey)) as Record<string, unknown> | undefined
        if (!run) throw new Error('Run not found')
        const status = String(run.status ?? '')
        if (status === 'completed' || status === 'skipped' || status === 'error' || status === 'cancelled') {
          throw new Error(`This run has already finished (${status}).`)
        }
        const parked = status === 'waiting' || status === 'waiting_retry'
        await ctx.store.put(runKey, {
          ...run,
          status: parked ? 'cancelled' : status,
          cancelRequested: true,
          cancelledBy: req.memberId ?? null,
          cancelledAt: new Date().toISOString(),
          log: [...(Array.isArray(run.log) ? run.log as unknown[] : []),
            { step: '-', action: 'cancelled', ok: false, ms: 0, error: parked ? 'Cancelled by an operator before it resumed.' : 'Cancellation requested while the run was executing.' }],
        })
        if (parked) await putRunMeta(ctx.store, req.params.id, { status: 'cancelled', startedAt: run.startedAt })
        return { data: { cancelled: parked, requested: !parked, effect: parked ? 'stopped' : 'cooperative' } }
      },
    },
    {
      // Mint the inbound-webhook URL for a webhook-trigger flow (admin-only).
      method: 'GET', path: 'flows/:id/webhook', capability: 'manage:flows',
      handler: async (req, ctx) => {
        const flow = await ctx.store.get(`${FLOW_PREFIX}${req.params.id}`)
        if (!flow) throw new Error('Flow not found')
        const trig = resolveTrigger(flow as Record<string, unknown>)
        if (trig.type !== 'webhook') throw new Error('This flow does not use a webhook trigger')
        const token = await mintWebhookToken(ctx, req.params.id)
        const rotation = await webhookRotationOf(ctx)
        const rotated = rotation && rotation.flows.includes(req.params.id) ? { at: rotation.at, from: rotation.from } : undefined
        // The extension's own public route; the workspace rides the query because a webhook sender sets no headers.
        return { data: { path: `/api/v1/ext/flows/hooks/${token}?workspace=${encodeURIComponent(ctx.workspaceId)}`, hasSecret: Boolean(trig.secret), ...(rotated ? { rotated } : {}) } }
      },
    },
    {
      // The builder's trigger/action catalog, capability-filtered per member
      method: 'GET', path: 'catalog', capability: 'read:flows',
      handler: async (req, ctx) => ({ data: buildCatalog(ctx, req.can) }),
    },
    {
      /**
       * The presets a HOST may render (plan-connectors D1): "Add Google
       * Sheets" on a form. Filtered to the caller's own trigger and scope
       * kind, capability-filtered per member, and without `build` - the
       * builder function never crosses the wire.
       */
      method: 'GET', path: 'presets', capability: 'read:flows',
      handler: async (req, ctx) => ({
        data: presetsFor(ctx, {
          trigger: typeof req.query.trigger === 'string' ? req.query.trigger : undefined,
          scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
        }, req.can),
      }),
    },
    {
      method: 'GET', path: 'runs', capability: 'read:flows',
      handler: async (req, ctx) => {
        // Filters: ?flowId, ?status (completed|error|skipped|waiting),
        // ?from / ?to (ISO dates, inclusive). Pagination: ?limit (max 100),
        // ?offset.
        const prefix = req.query.flowId ? `${RUN_PREFIX}${req.query.flowId}:` : RUN_PREFIX
        const limit0 = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100)
        const offset0 = Math.max(Number(req.query.offset) || 0, 0)
        const unfiltered = !req.query.status && !req.query.from && !req.query.to

        // Fast path (the common view): page + order in SQL - run rows carry
        // full step logs, so shipping only one page matters at scale.
        if (unfiltered && typeof ctx.store.count === 'function') {
          const [pageRows, totalCount, flowRows] = await Promise.all([
            ctx.store.list(prefix, { orderByDataKey: 'startedAt', desc: true, limit: limit0, offset: offset0 }),
            ctx.store.count(prefix),
            ctx.store.list(FLOW_PREFIX, { limit: 1000 }),
          ])
          const liveIds = new Set(flowRows.map(({ key }) => key.slice(FLOW_PREFIX.length)))
          const data = pageRows.map(({ data }) => ({
            ...(data as Record<string, unknown>),
            flowDeleted: !liveIds.has(String((data as { flowId?: string }).flowId ?? '')),
          }))
          return { data, meta: { total: totalCount, limit: limit0, offset: offset0, retentionDays: Number(ctx.options?.runRetentionDays) || 30 } }
        }

        let rows = await ctx.store.list(prefix)
        // Expiry sweep rides the filtered/full-list path (and widget-data):
        // runs of DELETED flows have no recordRun to age them out.
        const sweepCutoff = Date.now() - (Number(ctx.options?.runRetentionDays) || 30) * 86_400_000
        const expired = rows.filter(({ data }) => (Date.parse(String((data as { startedAt?: string }).startedAt ?? '')) || 0) < sweepCutoff)
        for (const run of expired) await ctx.store.remove(run.key)
        if (expired.length) rows = rows.filter((r) => !expired.includes(r))
        const status = req.query.status ? String(req.query.status) : ''
        const from = req.query.from ? (Date.parse(String(req.query.from)) || 0) : 0
        // Date-only `to` means "through the end of that day"; a value with a
        // time component means "through the end of that minute".
        const toRaw = req.query.to ? String(req.query.to) : ''
        const to = toRaw ? (Date.parse(toRaw) || 0) + (toRaw.includes('T') ? 59_999 : 86_399_999) : Number.POSITIVE_INFINITY
        const all = rows.map(({ data }) => data as Record<string, unknown>)
          .filter((r) => {
            if (status && String(r.status) !== status) return false
            const t = Date.parse(String(r.startedAt ?? '')) || 0
            return t >= from && t <= to
          })
          .sort((a, b) => (Date.parse(String(b.startedAt ?? '')) || 0) - (Date.parse(String(a.startedAt ?? '')) || 0))
        // Authoritative deleted-flow flag - the client must not depend on its
        // own (possibly stale) flows list to know a run is orphaned.
        const liveIds = new Set((await ctx.store.list(FLOW_PREFIX)).map(({ key }) => key.slice(FLOW_PREFIX.length)))
        const pageRows = all.slice(offset0, offset0 + limit0).map((r) => ({ ...r, flowDeleted: !liveIds.has(String(r.flowId ?? '')) }))
        return { data: pageRows, meta: { total: all.length, limit: limit0, offset: offset0, retentionDays: Number(ctx.options?.runRetentionDays) || 30 } }
      },
    },
    {
      // Dashboard widget data - live aggregate counts (computed, never stored,
      // so "today" is always right). Gated read:flows to match the widget's
      // manifest capability - every stat deep-links into flows pages.
      method: 'GET', path: 'widget-data', capability: 'read:flows',
      handler: async (_req, ctx) => {
        const flows = await ctx.store.list(FLOW_PREFIX)
        const active = flows.filter(({ data }) => (data as { enabled?: boolean }).enabled).length
        const dayStart = new Date()
        dayStart.setHours(0, 0, 0, 0)
        const runs = (await ctx.store.list(RUN_PREFIX))
          .map(({ data }) => data as { status?: string; startedAt?: string })
          .filter((r) => (Date.parse(String(r.startedAt ?? '')) || 0) >= dayStart.getTime())
        const succeeded = runs.filter((r) => r.status === 'completed').length
        const failed = runs.filter((r) => r.status === 'error').length
        const day = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`
        const runsHref = (extra = '') => `/extensions/flows?tab=runs&from=${day}&to=${day}${extra}`
        return {
          stats: [
            { label: 'Active flows', value: active, href: '/extensions/flows?status=on' },
            { label: 'Runs today', value: runs.length, href: runsHref() },
            { label: 'Succeeded', value: succeeded, tone: succeeded > 0 ? 'success' : 'neutral', href: runsHref('&status=completed') },
            { label: 'Failed', value: failed, tone: failed > 0 ? 'danger' : 'neutral', href: runsHref('&status=error') },
          ],
        }
      },
    },
  ],
})
