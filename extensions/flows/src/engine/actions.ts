/**
 * File Name: actions.ts
 * Purpose: The built-in action registry - what a flow step can DO.
 *          http (signed outbound call, SSRF-guarded), content (update
 *          fields through the tangen client), log (leave a note in the
 *          step log). Each action returns its output for later steps'
 *          {{steps.N.…}} templates.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: fetcher is injected for tests; HMAC uses
 *          Bun.CryptoHasher (X-Tangen-Signature: sha256=<hex>, the same
 *          scheme the platform's cron URL triggers use). 'wait' is not
 *          here - the server executor handles it (queue re-enqueue).
 */
import type { FlowStep, FlowScope } from './types'
import { resolveDeep } from './template'
import { FlowActionError, FLOW_ERROR_CODES, classifyHttpStatus } from './failure'

/** The content-object surface a flow uses (subset of the local client) - mutations
 *  + a chainable read (where/status/limit → get). Self-referential for chaining. */
export interface FlowObjectApi {
  update(id: string, fields: Record<string, unknown>): Promise<unknown>
  publish(id: string, opts?: { cascade?: boolean }): Promise<unknown>
  unpublish(id: string): Promise<unknown>
  /** Future publish - status 'scheduled' + scheduled_at; scheduler publishes when due. */
  schedule(id: string, at: string | Date): Promise<unknown>
  // NB: no delete() - content deletion is deliberately NOT a flow op (irreversible,
  // huge blast radius). Use http/code explicitly if you truly need it.
  where(filter: Record<string, unknown>): FlowObjectApi
  status(s: string): FlowObjectApi
  limit(n: number): FlowObjectApi
  get(): Promise<{ data: Record<string, unknown>[]; meta?: { total?: number } }>
}

export interface ActionCtx {
  /** Content/table client - required by content/query/email actions. */
  tangen?: {
    objects: (typeName: string) => FlowObjectApi
    /** Operational/system labels - entityType 'content:<type>' for content objects. */
    labels?: {
      add: (entityType: string, entityId: string, labels: string[]) => Promise<unknown>
      remove: (entityType: string, entityId: string, labels: string[]) => Promise<unknown>
      list: (entityType: string, entityId: string) => Promise<string[]>
    }
    /** Workspace mail sender (needs defineMailConfig) - the 'email' action. */
    sendMail?: (message: { to: string | string[]; subject: string; html?: string; text?: string }) => Promise<void>
  }
  fetcher: (url: string, init: RequestInit) => Promise<Response>
  log: (message: string) => void
  /** Dev/self-hosted escape hatch: the Allow private networks setting, which takes effect only under the network:private grant (E.15). */
  allowPrivate?: boolean
  /** Contributed-action dispatch (set by the server; extensions/site helpers).
   *  `extra.trigger` is the run's trigger scope - contributors default their
   *  target from it, mirroring the built-in content/label actions.
   *  `extra.idempotencyKey` and `extra.attempt` are forwarded so a CONTRIBUTED
   *  action can deduplicate a retried delivery too - without this the identity
   *  reached only the built-in actions, which is where it is least needed. */
  runContributed?: (
    name: string,
    config: Record<string, unknown>,
    extra?: { trigger?: Record<string, unknown>; idempotencyKey?: string; attempt?: number; signal?: AbortSignal },
  ) => Promise<unknown>
  /** Composition - run another flow as a sub-step (set by the server; depth-guarded). */
  runFlow?: (flowId: string, input: Record<string, unknown>, opts?: { dryRun?: boolean; testMode?: boolean }) => Promise<{ status: string; output: unknown }>
  /** Dry run - write-actions are simulated, not executed (set by the executor). */
  dryRun?: boolean
  /** Test run - waits fast-forward (set by the executor; propagates to sub-flows). */
  testMode?: boolean
  /**
   * A stable identity for THIS logical node in THIS execution, suitable as an
   * external idempotency key (Phase 9B, Unit 10). It deliberately excludes the
   * attempt number: a retry of the same node carries the SAME key, so a
   * provider that deduplicates on it does not perform the work twice.
   */
  idempotencyKey?: string
  /** Which attempt this is, counting from 1. Separate from the key, on purpose. */
  attempt?: number
  /** Cancels the action when the executor's budget runs out (Phase 9B, Unit 17). */
  signal?: AbortSignal
}

const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|::1)/i
const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[01])\./

/** Loopback / RFC1918 / link-local targets are refused (SSRF guard). */
export function isPrivateHost(host: string): boolean {
  return PRIVATE_HOST.test(host) || PRIVATE_172.test(host)
}

async function httpAction(config: Record<string, unknown>, ctx: ActionCtx): Promise<unknown> {
  const url = String(config.url ?? '')
  const parsed = new URL(url)   // throws on garbage - loud beats silent
  if (!ctx.allowPrivate && isPrivateHost(parsed.hostname)) {
    throw new FlowActionError(FLOW_ERROR_CODES.REFUSED, `http action refuses private/loopback targets (${parsed.hostname}): missing network:private grant - approve it for this installation and enable Allow private networks in the Flows settings`, { retryable: 'non_retryable' })
  }
  const method = String(config.method ?? 'POST').toUpperCase()
  const body = config.body != null ? JSON.stringify(config.body) : undefined
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(config.headers as Record<string, string> | undefined),
  }
  if (config.secret && body) {
    const hex = new Bun.CryptoHasher('sha256', String(config.secret)).update(body).digest('hex')
    headers['X-Tangen-Signature'] = `sha256=${hex}`
  }
  // An idempotency key lets a receiver deduplicate a retried delivery. It is
  // the SAME value on every attempt of this node, which is the point.
  if (ctx.idempotencyKey) headers['Idempotency-Key'] = ctx.idempotencyKey
  let res: Response
  try {
    res = await ctx.fetcher(url, {
      method,
      headers,
      body: method === 'GET' ? undefined : body,
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    // Nothing came back. A transport failure is the archetypal retryable one.
    const aborted = (err as { name?: string })?.name === 'TimeoutError' || (err as { name?: string })?.name === 'AbortError'
    throw new FlowActionError(
      aborted ? FLOW_ERROR_CODES.TIMEOUT : FLOW_ERROR_CODES.NETWORK,
      aborted ? `http action timed out after 15s (${parsed.hostname})` : `http action could not reach ${parsed.hostname}: ${(err as Error)?.message ?? 'network error'}`,
      { retryable: 'retryable' },
    )
  }
  let responseBody: unknown = null
  const text = await res.text()
  try { responseBody = JSON.parse(text) } catch { responseBody = text.slice(0, 2000) }
  if (!res.ok) {
    // The status decides, not the body: 503 is worth another go, 422 is not.
    throw new FlowActionError(
      FLOW_ERROR_CODES.HTTP_STATUS,
      `HTTP ${res.status} from ${parsed.hostname}: ${String(responseBody).slice(0, 200)}`,
      { retryable: classifyHttpStatus(res.status) },
    )
  }
  return { response: { status: res.status, body: responseBody } }
}

async function contentAction(config: Record<string, unknown>, ctx: ActionCtx): Promise<unknown> {
  if (!ctx.tangen) throw new Error('content action needs the tangen client (server context only)')
  const typeName = String(config.typeName ?? '')
  const objectId = String(config.objectId ?? '')
  const op = String(config.op ?? 'update')   // update | publish | unpublish
  const fields = (config.fields ?? {}) as Record<string, unknown>
  if (!typeName || !objectId) throw new Error('content action needs typeName and objectId')
  const api = ctx.tangen.objects(typeName)
  let result: unknown = null
  switch (op) {
    case 'update':
      if (Object.keys(fields).length > 0) result = await api.update(objectId, fields)
      break
    case 'publish': {
      // `at` (a future ISO datetime) schedules the publish; otherwise publish now.
      const at = config.at ? String(config.at) : ''
      result = at && !Number.isNaN(Date.parse(at)) && Date.parse(at) > Date.now()
        ? await api.schedule(objectId, at)
        : await api.publish(objectId, { cascade: config.cascade === true })
      break
    }
    case 'unpublish':
      result = await api.unpublish(objectId)
      break
    default:
      throw new Error(`content action: unknown op '${op}' (expected update | publish | unpublish)`)
  }
  return { op, updated: { typeName, objectId }, result }
}

/** System labels (add/remove) on any taggable entity: a content object, a form
 *  submission, a member, or a media asset. Its own node so flows stay clean. */
async function labelAction(config: Record<string, unknown>, ctx: ActionCtx): Promise<unknown> {
  if (!ctx.tangen?.labels) throw new Error('label action needs the labels client (server context only)')
  const kind = String(config.entityKind ?? 'content')                       // content | member | submission | media
  const entityType = kind === 'content' ? `content:${String(config.typeName ?? '')}` : kind
  const entityId = String(config.entityId ?? '')
  if (kind === 'content' && !config.typeName) throw new Error('label action: pick a content type (on a content trigger it defaults to the triggering object)')
  if (!entityId) throw new Error('label action needs an entity id')
  const add = (Array.isArray(config.addLabels) ? config.addLabels : []).map(String)
  const remove = (Array.isArray(config.removeLabels) ? config.removeLabels : []).map(String)
  if (add.length) await ctx.tangen.labels.add(entityType, entityId, add)
  if (remove.length) await ctx.tangen.labels.remove(entityType, entityId, remove)
  return { entityType, entityId, addedLabels: add, removedLabels: remove }
}

/** Query / count content → { count, items }. Read-only; feeds downstream tokens. */
async function queryAction(config: Record<string, unknown>, ctx: ActionCtx): Promise<unknown> {
  if (!ctx.tangen) throw new Error('query action needs the tangen client (server context only)')
  const typeName = String(config.typeName ?? '')
  if (!typeName) throw new Error('query action needs typeName')
  let b = ctx.tangen.objects(typeName)
  if (config.where && typeof config.where === 'object') b = b.where(config.where as Record<string, unknown>)
  if (config.status) b = b.status(String(config.status))
  // Safety cap on fetched rows. `count` comes from a real COUNT(*) (meta.total),
  // so counting stays accurate even though at most QUERY_MAX items are returned.
  const QUERY_MAX = 20
  const limit = Math.min(Math.max(1, Number(config.limit ?? QUERY_MAX)), QUERY_MAX)
  b = b.limit(limit)
  const res = await b.get()
  const items = Array.isArray(res?.data) ? res.data : []
  const count = Number(res?.meta?.total ?? items.length)
  return { count, items }
}

/** Send an email via the workspace mail config. */
async function emailAction(config: Record<string, unknown>, ctx: ActionCtx): Promise<unknown> {
  if (!ctx.tangen?.sendMail) throw new Error('email action needs a mail service (add defineMailConfig to the workspace)')
  const to = config.to as string | string[]
  const subject = String(config.subject ?? '')
  const html = config.html != null ? String(config.html) : undefined
  const text = config.text != null ? String(config.text) : undefined
  if (!to || (Array.isArray(to) && !to.length) || !subject) throw new Error('email action needs `to` and `subject`')
  if (!html && !text) throw new Error('email action needs `html` or `text`')
  await ctx.tangen.sendMail({ to, subject, html, text })
  return { sent: { to, subject } }
}

/**
 * A note in the step log. `String()` on an object gives "[object Object]",
 * and on an ARRAY of objects gives "[object Object],[object Object]" - which
 * is what a flow author saw after logging a step's rows, so the one node whose
 * whole job is showing you a value showed nothing (found in the real Google
 * acceptance run, 2026-09-19).
 *
 * A single token resolves to its RAW value (template.ts), so the message
 * reaching here is often an object or an array. Those are logged as readable
 * JSON; a primitive is logged as itself.
 */
async function logAction(config: Record<string, unknown>, ctx: ActionCtx): Promise<unknown> {
  const raw = config.message
  const message = raw == null
    ? ''
    : typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
      ? String(raw)
      : safeJson(raw)
  ctx.log(message)
  // A structured message becomes `value`, not an escaped string: the run
  // sheet highlights real JSON, and a later step reads
  // `{{steps.log_x.output.value}}` instead of parsing text back. A primitive
  // stays `message`, which is what every existing flow reads.
  return typeof raw === 'object' && raw !== null ? { value: raw } : { message }
}

/** JSON a person can read, and never a throw: a cycle or a BigInt is described, not fatal. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) ?? String(value)
  } catch {
    return Array.isArray(value) ? `[${value.length} items that cannot be shown as JSON]` : '[a value that cannot be shown as JSON]'
  }
}

/** Run another flow as a sub-step and return its output (composition). */
async function runFlowAction(config: Record<string, unknown>, ctx: ActionCtx): Promise<unknown> {
  if (!ctx.runFlow) throw new Error('run_flow action needs the flow runner (server context only)')
  const flowId = String(config.flowId ?? '')
  if (!flowId) throw new Error('run_flow action needs a target flowId')
  const input = (config.input && typeof config.input === 'object' ? config.input : {}) as Record<string, unknown>
  const res = await ctx.runFlow(flowId, input, { dryRun: ctx.dryRun, testMode: ctx.testMode })
  // Return the sub-flow's output directly → {{steps.<id>.output.<field>}}.
  return (res.output ?? {}) as Record<string, unknown>
}

const ACTIONS: Record<string, (config: Record<string, unknown>, ctx: ActionCtx) => Promise<unknown>> = {
  http: httpAction,
  content: contentAction,
  query: queryAction,
  email: emailAction,
  label: labelAction,
  run_flow: runFlowAction,
  log: logAction,
}

export function knownActions(): string[] {
  return Object.keys(ACTIONS)
}

/**
 * Dry-run stand-in for a write-action: same output SHAPE as the real action
 * (so downstream {{steps.*.output.*}} tokens resolve) plus dryRun: true and
 * the fully resolved config under wouldDo. Read-only actions (query, code,
 * log) and pure nodes still execute for real. Returns null = not a write.
 */
function simulateAction(action: string, config: Record<string, unknown>): Record<string, unknown> | null {
  switch (action) {
    case 'http':
      return { dryRun: true, wouldDo: { url: config.url, method: config.method ?? 'POST', headers: config.headers, body: config.body }, response: { status: 200, body: {} } }
    case 'email':
      return { dryRun: true, wouldDo: { html: config.html, text: config.text }, sent: { to: config.to, subject: config.subject } }
    case 'content': {
      const op = String(config.op ?? 'update')
      return { dryRun: true, wouldDo: { fields: config.fields, at: config.at }, op, updated: { typeName: config.typeName, objectId: config.objectId }, result: null }
    }
    case 'label': {
      const kind = String(config.entityKind ?? 'content')
      const entityType = kind === 'content' ? `content:${String(config.typeName ?? '')}` : kind
      const norm = (v: unknown) => Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []
      return { dryRun: true, entityType, entityId: config.entityId ?? config.objectId, addedLabels: norm(config.addLabels), removedLabels: norm(config.removeLabels) }
    }
    default:
      return null
  }
}

/** Resolves the step's templates against the scope, then runs the action. */
export async function runAction(
  step: Pick<FlowStep, 'action' | 'config'>,
  scope: FlowScope,
  ctx: ActionCtx,
): Promise<unknown> {
  if (step.action === 'code') {
    // Raw source - never template-resolved; the sandbox gets the scope as `input`
    const { runCode } = await import('./sandbox')
    return runCode(String(step.config.source ?? ''), scope)
  }
  const impl = ACTIONS[step.action]
  const config = resolveDeep(step.config, scope) as Record<string, unknown>
  // Content-object actions default to the TRIGGERING object when unset, so a
  // flow on "any content type" can label/update whatever fired it without
  // knowing the type at author time.
  if (step.action === 'label' || step.action === 'content') {
    const trig = scope.trigger as Record<string, unknown> | undefined
    const isContent = step.action === 'content' || String(config.entityKind ?? 'content') === 'content'
    if (isContent && trig) {
      if (!config.typeName && trig.typeName) config.typeName = trig.typeName
      if (step.action === 'content' && !config.objectId && trig.objectId) config.objectId = trig.objectId
      if (step.action === 'label' && !config.entityId && trig.objectId) config.entityId = trig.objectId
    }
  }
  if (ctx.dryRun) {
    const simulated = simulateAction(step.action, config as Record<string, unknown>)
    if (simulated) return simulated
    // Contributed actions have unknown side effects - never run them dry.
    if (!impl) return { dryRun: true, action: step.action, wouldDo: config }
  }
  if (!impl) {
    if (ctx.runContributed) {
      return ctx.runContributed(step.action, config as Record<string, unknown>, {
        trigger: scope.trigger as Record<string, unknown> | undefined,
        idempotencyKey: ctx.idempotencyKey,
        attempt: ctx.attempt,
        signal: ctx.signal,
      })
    }
    throw new Error(`Unknown action '${step.action}' (have: ${knownActions().join(', ')})`)
  }
  return impl(config, ctx)
}
