/**
 * File Name: index.ts
 * Purpose: @tangen/extension-testkit (Extension Kernel K2.3,
 *          tasks/plan-extension-kernel.md) - what an extension's own tests
 *          import. `createTestCtx` builds an ExtensionServerCtx under the
 *          REAL kernel: the actor from the manifest's grants, the same policy
 *          and facility gate a boot applies, so a test proves what the
 *          platform will enforce rather than what a mock allows. Fake peers
 *          register into the real contribution registry so `ctx.contributions`
 *          answers as in production; the in-memory store and the recorded
 *          enqueue / emit / log make a handler observable; `expectRefused`
 *          names a refusal instead of an assertion on an error's shape.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Imports `@tangen/api/kernel` only - no server boot, no
 *          database. `ctx.tangen` is whatever the test passes (a client bound
 *          to a real harness, or a stub); the kit does not fake content.
 *          `ctx.secrets` is a plain map here: the platform's own-name narrowing
 *          is a boot concern (services/extension-http.ts), not re-implemented.
 */
import { createHmac } from 'node:crypto'
import type { ExtensionServerCtx, ExtensionStore, ExecutionContext, TangenExtensionManifest, TangenExtensionServer, ExtensionGrantItem, ConnectorDefinition } from '@tangen/types'
import { grantNames, compileSettings, settingsFieldDescriptor, connectorSupersedes, missingCapabilities, type ExtensionSettingsDefinition } from '@tangen/types'
import {
  createExecution, extensionActor, systemActor, gateExtensionCtx, decide,
  contributions, contribute, registerExtensionManifest, registerExtensionServer, resetExtensionRegistry,
  provideService, getService, instantiateService, serviceValue, dispatchExecution,
  registerFilter, applyFilter, declareFilterPoint,
  type ContributionsOptions,
} from '@tangen/api/kernel'

/**
 * A deterministic stand-in for the host's per-extension MAC (`ctx.sign`).
 *
 * Same shape as the platform's (hex HMAC-SHA256, keyed per extension) but over
 * a fixed test key, so a suite never reaches for a deployment secret and never
 * writes a dev secret file. What a test proves with it is the extension's USE
 * of the MAC - that a value it signed verifies, that one signed for another
 * extension does not - which is the part the extension owns. The key
 * derivation itself is the platform's and is tested there.
 *
 * Exported because a test that seeds a signed value has to produce the same
 * bytes the ctx under test will verify.
 */
export function testSigner(extensionId: string): (payload: string) => string {
  const key = createHmac('sha256', 'tangen:testkit:extension-data-mac').update(extensionId).digest()
  return (payload: string) => createHmac('sha256', key).update(payload).digest('hex')
}

export interface TestCtxCalls {
  enqueued: Array<{ taskId: string; payload: unknown; opts?: unknown }>
  emitted: Array<{ name: string; payload: unknown }>
  logs: string[]
}

export type TestExtensionCtx = ExtensionServerCtx & {
  exec: ExecutionContext
  /** What the handler under test asked the platform to do. */
  calls: TestCtxCalls
}

export interface TestCtxOptions {
  extensionId: string
  workspaceId?: string
  /** The manifest's `grants.required`. Omit (or null) for an extension that declares none: the platform's authority, as today. */
  grants?: ReadonlyArray<ExtensionGrantItem> | null
  options?: Record<string, unknown>
  /** Secret material by name; `ctx.secrets.get(name)` answers from it. */
  secrets?: Record<string, string>
  /** A content client, when the test has one (a harness-bound local client, or a stub). */
  tangen?: unknown
  /** The database handle to offer; present on the ctx only under `db:own`. */
  db?: unknown
  /** The AI client to offer; present only under an `ai:*` grant. */
  ai?: unknown
  /** The media reader to offer (`ctx.media.read`); present only under `media:read`. */
  media?: unknown
  store?: ExtensionStore
  /** Connections the test configures, by connector id, with the material the connector's `request` needs; served through `ctx.connections`. */
  /**
   * Configured connections, as an operator would have made them. Either keyed
   * by connector id, or - since a provider may have several - a list of rows
   * with their own ids and labels:
   *
   *   connections: [{ id: 'cx_1', connectorId: 'ext:google/google.oauth',
   *                   label: 'Marketing', meta: { scope: '...' },
   *                   credentials: { accessToken: 'at' } }]
   *
   * `meta.scope` is what the capability check reads, so a test can say exactly
   * what the operator consented to and watch a wider operation be refused.
   */
  connections?: TestConnections
  /**
   * The fetch a connector's `request` runs on. Stub it here rather than on
   * `globalThis`, so one test's provider cannot answer another's.
   */
  fetchImpl?: typeof fetch
  /**
   * Typed settings for the test (K7.1): the manifest's definition and the
   * values an operator would have saved; `ctx.settings.get()` answers the
   * definition's defaults under those values, the way the platform does.
   */
  settings?: { definition?: ExtensionSettingsDefinition; values?: Record<string, unknown> }
  /** Anything else to put on the ctx (`deploymentRole`, `types`, `http`, ...). Applied before the gate. */
  overrides?: Partial<ExtensionServerCtx>
}

const registered = new Set<string>()
/** The grants each fake peer declared, so a dispatched service runs under the provider's real principal. */
const registeredGrants = new Map<string, readonly string[]>()

/** An in-memory ExtensionStore: insertion-ordered, prefix listing, count. */
export function createMemoryStore(): ExtensionStore {
  const rows = new Map<string, Record<string, unknown>>()
  const select = (prefix = '') => [...rows.entries()].filter(([k]) => k.startsWith(prefix))
  return {
    async get(key) { return rows.get(key) },
    async put(key, data) { rows.delete(key); rows.set(key, { ...data }) },
    async remove(key) { rows.delete(key) },
    async list(prefix, opts) {
      let out = select(prefix).map(([key, data]) => ({ key, data }))
      if (opts?.orderByDataKey) {
        const k = opts.orderByDataKey
        out = [...out].sort((a, b) => String(a.data[k] ?? '').localeCompare(String(b.data[k] ?? '')))
      }
      if (opts?.desc) out = [...out].reverse()
      const offset = opts?.offset ?? 0
      return out.slice(offset, opts?.limit !== undefined ? offset + opts.limit : undefined)
    },
    async count(prefix) { return select(prefix).length },
  }
}

/** A configured connection in a test, keyed by connector id or given as a row. */
export interface TestConnectionRow {
  id?: string
  /** `ext:<pack>/<connector>` as the platform stores it, or a bare connector id. */
  connectorId: string
  label?: string
  kind?: 'oauth2' | 'apiKey' | 'basic'
  credentials: Record<string, unknown>
  /** `meta.scope` is what a capability check reads. */
  meta?: Record<string, unknown>
}
export type TestConnections =
  | Record<string, { label?: string; kind?: 'oauth2' | 'apiKey' | 'basic'; credentials: Record<string, unknown>; meta?: Record<string, unknown> }>
  | readonly TestConnectionRow[]

/**
 * `ctx.connections` for a test, under the same rules the kernel applies:
 * the connector comes from a registered peer's `connectors@1` (or the
 * extension's own), the credentials from the test, and the grant gate from the
 * real policy. Since A1/A3 it also resolves by PROVIDER, refuses a capability
 * the connection's recorded scope does not cover - before the connector's
 * `request` is reached - and reports `authorizationKnown`, so a pack's own
 * tests exercise the boundary its users will hit.
 */
function testConnections(
  extensionId: string, workspaceId: string, exec: ExecutionContext,
  configured: TestConnections, fetchImpl?: typeof fetch,
): ExtensionServerCtx['connections'] {
  const offers = () => contributions<ConnectorDefinition>('connectors@1', { activeIds: new Set([...registered, extensionId]) })
  const holds = (facility: string) => decide(exec.actor, { kind: 'facility', facility }).allow
  const providerOf = (def: ConnectorDefinition) => def.provider ?? def.id
  const rows = (): Array<Required<Pick<TestConnectionRow, 'id' | 'connectorId' | 'label' | 'kind'>> & { status: string; meta: Record<string, unknown>; credentials: Record<string, unknown> }> =>
    (Array.isArray(configured)
      ? configured.map((c, i) => ({ id: c.id ?? `conn_test_${i + 1}`, connectorId: c.connectorId, label: c.label ?? c.connectorId, kind: c.kind ?? 'apiKey', status: 'active', meta: c.meta ?? {}, credentials: c.credentials }))
      : Object.entries(configured).map(([connectorId, c], i) => ({ id: `conn_test_${i + 1}`, connectorId, label: c.label ?? connectorId, kind: c.kind ?? 'apiKey', status: 'active', meta: c.meta ?? {}, credentials: c.credentials })))

  /**
   * A row belongs to an offer when its stored id names it, however it is
   * spelled - or when an active connector ADOPTS it (`supersedes`), which is
   * how a connection survives a pack taking over what an extension used to
   * offer for itself (plan-connectors F2). The kernel resolves both, so this
   * must too: a test is only worth having if it enforces what production does.
   */
  const offerFor = (connectorId: string) =>
    offers().find(({ extensionId: owner, item }) => connectorId === item.id || connectorId === `ext:${owner}/${item.id}`)
    ?? offers().find(({ item }) => connectorSupersedes(item, connectorId))

  /** Every offer a ref names: the provider's auth models, else one connector id. */
  const matchOffers = (ref: string) => {
    const byProvider = offers().filter((o) => providerOf(o.item) === ref)
    return byProvider.length > 0 ? byProvider : offers().filter((o) => o.item.id === ref)
  }

  return {
    async list() {
      return rows().filter((r) => {
        const offer = offerFor(r.connectorId)
        return offer !== undefined && holds(`connections:${providerOf(offer.item)}`)
      }).map(({ credentials: _c, ...rest }) => rest)
    },
    async availability(ref) {
      const provider = ref.split('.')[0]!
      // EVERY auth model of the provider answers, exactly as the kernel does:
      // a provider offering an OAuth connector and a key connector is one
      // provider, and a connection made with either is its connection. (Found
      // building the Slack pack, 2026-09-19: matching a single offer made a
      // token connection invisible while the kernel resolved it fine.)
      const matched = matchOffers(provider)
      if (matched.length === 0) return { state: 'pack_absent', reason: `Nothing installed offers ${provider}.` }
      const required = ref === provider ? [] : [ref.slice(provider.length + 1)]
      const items = new Set(matched.map((o) => o.item))
      const mine = rows().filter((r) => { const o = offerFor(r.connectorId); return o !== undefined && items.has(o.item) })
      if (mine.length === 0) return { state: 'not_configured', reason: `No connection for ${provider} yet.` }
      // Against the row's OWN connector: two auth models declare capabilities
      // differently (an OAuth one maps scopes, a pasted key cannot).
      const def = offerFor(mine[0]!.connectorId)!.item
      const missing = required.length > 0
        ? missingCapabilities({ def, granted: typeof mine[0]!.meta.scope === 'string' ? String(mine[0]!.meta.scope) : null, required })
        : []
      if (missing.length > 0) return { state: 'needs_capability', reason: `This connection was not authorized for '${missing[0]!.label}'.` }
      return { state: 'ready', reason: `Using '${mine[0]!.label}'.`, connectionId: mine[0]!.id }
    },
    async get(ref, options) {
      // By provider first, then by connector id, exactly as the kernel does -
      // and across EVERY auth model of that provider.
      const matched = matchOffers(ref)
      if (matched.length === 0) return undefined
      const provider = providerOf(matched[0]!.item)
      const items = new Set(matched.map((o) => o.item))
      const entry = rows().find((r) => {
        const o = offerFor(r.connectorId)
        return o !== undefined && items.has(o.item)
          && (options?.id === undefined || r.id === options.id)
          && (options?.label === undefined || r.label === options.label)
      })
      if (!entry) return undefined
      const offer = offerFor(entry.connectorId)!
      const wanted = options?.capabilities ?? []
      const granted = wanted.length > 0
        ? wanted.every((c) => holds(`connections:${provider}.${c}`) || holds(`connections:${provider}`))
        : holds(`connections:${provider}`) || holds(`connections:${ref}`)
      if (!granted) throw Object.assign(new Error(`This extension is not granted connections:${provider}`), { status: 403, code: 'FORBIDDEN' })
      if (wanted.length > 0) {
        const missing = missingCapabilities({ def: offer.item, granted: typeof entry.meta.scope === 'string' ? String(entry.meta.scope) : null, required: wanted })
        if (missing.length > 0) {
          throw Object.assign(
            new Error(`The connection '${entry.label}' is not authorized for ${missing.map((m) => `'${m.label}'`).join(', ')}. Reconnect it under Settings > Connections and include ${missing.length === 1 ? 'that capability' : 'those capabilities'}.`),
            { status: 403, code: 'CONNECTION_CAPABILITY', details: { provider, capability: missing[0]!.capability, missing } },
          )
        }
      }
      const conn = { id: entry.id, connectorId: entry.connectorId, label: entry.label, kind: entry.kind, meta: entry.meta, credentials: entry.credentials, fetch: fetchImpl ?? globalThis.fetch }
      const request = (path: string, init?: RequestInit) => Promise.resolve(offer.item.request!(conn as never, path, init))
      // The kernel's `invoke`, for a connector whose provider is not HTTP: the
      // operation runs with the MATERIAL, the consumer gets the answer, and a
      // missing operation is a refusal rather than an undefined call.
      const invoke = async <T = unknown>(operation: string, payload?: unknown): Promise<T> => {
        const op = (offer.item as { operations?: Record<string, (c: unknown, i: unknown) => Promise<unknown>> }).operations?.[operation]
        if (typeof op !== 'function') {
          throw Object.assign(
            new Error(`Connector '${(offer.item as { id?: string }).id ?? ref}' declares no operation '${operation}'`),
            { status: 501, code: 'NOT_IMPLEMENTED' },
          )
        }
        return await op({ ...conn, request } as never, payload) as T
      }
      return {
        id: entry.id, connectorId: entry.connectorId, label: entry.label, kind: entry.kind, meta: entry.meta,
        authorizationKnown: typeof entry.meta.scope === 'string' && String(entry.meta.scope).trim() !== '',
        request,
        invoke,
        health: async () => { try { return Boolean(await offer.item.health?.({ ...conn, request } as never)) } catch { return false } },
      }
    },
  }
}

/** The execution a test ctx runs in: the extension principal under its grants; none declared means none held (E.14, exactly as the platform runs it). */
export function testExecution(extensionId: string, workspaceId: string, grants?: readonly string[] | null): ExecutionContext {
  const actor = extensionActor({ extensionId, workspaceId, grants: grants ?? [] })
  return createExecution({ kind: 'job', source: 'extension', workspaceId, actor })
}

/** A ctx under the real kernel. Facilities follow the grants exactly as in a boot. */
export function createTestCtx(opts: TestCtxOptions): TestExtensionCtx {
  const workspaceId = opts.workspaceId ?? 'ws_test'
  const exec = testExecution(opts.extensionId, workspaceId, opts.grants === undefined || opts.grants === null ? opts.grants : grantNames(opts.grants))
  const calls: TestCtxCalls = { enqueued: [], emitted: [], logs: [] }
  const secrets = opts.secrets
  const secretAccessor = secrets
    ? Object.defineProperty({ get: (name: string) => secrets[name], has: (name: string) => name in secrets, provider: 'testkit' }, 'toJSON', { value: () => ({ provider: 'testkit' }) })
    : undefined
  const base: ExtensionServerCtx = {
    extensionId: opts.extensionId,
    workspaceId,
    exec,
    options: opts.options ?? {},
    ...(secretAccessor ? { secrets: secretAccessor as ExtensionServerCtx['secrets'] } : {}),
    store: opts.store ?? createMemoryStore(),
    ...(opts.tangen !== undefined ? { tangen: opts.tangen as ExtensionServerCtx['tangen'] } : {}),
    ...(opts.db !== undefined ? { db: opts.db } : {}),
    ...(opts.ai !== undefined ? { ai: opts.ai as ExtensionServerCtx['ai'] } : {}),
    ...(opts.media !== undefined ? { media: opts.media as ExtensionServerCtx['media'] } : {}),
    enqueue: async (taskId, payload, o) => { calls.enqueued.push({ taskId, payload, ...(o !== undefined ? { opts: o } : {}) }) },
    emit: (name, payload) => { calls.emitted.push({ name, payload }) },
    log: (message) => { calls.logs.push(message) },
    sign: testSigner(opts.extensionId),
    resolveActor: async () => ({ ok: false, reason: 'testkit: no recorded actors' }) as never,
    clientFor: () => opts.tangen as never,
    hasExtension: async (id) => registered.has(id),
    contributions: ((point: string, o?: { except?: string }) => contributions(point, {
      activeIds: registered, except: o?.except, workspaceId,
      ctxFor: (id) => createTestCtx({ extensionId: id, workspaceId }),
    })) as never,
    contribute: (point, items) => contribute(opts.extensionId, point, items, { workspaceId }),
    filters: {
      register: (registration) => registerFilter(opts.extensionId, registration as never, { workspaceId }),
      apply: (point, value, o) => applyFilter(point, value, { workspaceId, activeIds: registered, scope: o?.scope, context: o?.context, ctxFor: (id) => createTestCtx({ extensionId: id, workspaceId }) }),
      declare: (def) => { declareFilterPoint(def, opts.extensionId) },
    },
    ...(opts.connections ? { connections: testConnections(opts.extensionId, workspaceId, exec, opts.connections, opts.fetchImpl) } : {}),
    ...(opts.settings ? { settings: { get: async () => {
      // E.15: a field that requires a grant the test ctx does not hold answers its default, exactly as the platform does.
      const definition = opts.settings?.definition ?? {}
      const heldGrants = new Set(opts.grants ? grantNames(opts.grants) : [])
      const values = { ...(opts.settings?.values ?? {}) }
      for (const [k, f] of Object.entries(definition)) { const g = settingsFieldDescriptor(f).requires as string | undefined; if (g && !heldGrants.has(g)) delete values[k] }
      return { ...(opts.settings?.definition ? compileSettings(opts.settings.definition).defaults() : {}), ...values } as never
    } } } : {}),
    services: {
      provide: (ref, impl) => provideService(opts.extensionId, ref, impl, { workspaceId }),
      // The KERNEL's rule, not a second one: a zero-argument factory is
      // called, a dispatch-scoped one is refused by name. The testkit
      // answering the raw impl is how a pack's factory passed every test and
      // then failed in a real project (2026-09-20).
      get: (ref) => {
        const resolved = getService(ref, { workspaceId, activeIds: registered })
        return (resolved ? serviceValue(resolved) : undefined) as never
      },
      has: (ref) => getService(ref, { workspaceId, activeIds: registered }) !== undefined,
      resolve: (ref) => getService(ref, { workspaceId, activeIds: registered }) as never,
      dispatch: async (ref, { as }) => {
        const resolved = getService(ref, { workspaceId, activeIds: registered })
        if (!resolved) return undefined
        const provider = createTestCtx({ extensionId: resolved.extensionId, workspaceId, grants: registeredGrants.get(resolved.extensionId) ?? null, tangen: opts.tangen })
        const dispatched = dispatchExecution(provider.exec, as)
        return instantiateService(resolved, { exec: dispatched, tangen: opts.tangen, caller: as.actor.onBehalfOf ?? as.actor.identity }) as never
      },
    },
    ...(opts.overrides ?? {}),
  }
  const gated = gateExtensionCtx(base, exec) as TestExtensionCtx
  return Object.assign(gated, { exec, calls })
}

export interface FakeExtension {
  id: string
  manifest?: Partial<TangenExtensionManifest>
  server?: Partial<TangenExtensionServer> & Record<string, unknown>
}

/** Register fake peers into the real registry; they answer `ctx.contributions` and `hasExtension` until `resetTestkit`. */
export function withExtensions(extensions: readonly FakeExtension[]): { ids: string[]; reset: () => void } {
  for (const ext of extensions) {
    registerExtensionManifest({ id: ext.id, name: ext.id, version: '0.0.0-test', ...(ext.manifest ?? {}) } as TangenExtensionManifest)
    registerExtensionServer(ext.id, (ext.server ?? {}) as TangenExtensionServer)
    registered.add(ext.id)
    const required = ext.manifest?.grants?.required
    if (Array.isArray(required)) registeredGrants.set(ext.id, grantNames(required))
  }
  return { ids: extensions.map((e) => e.id), reset: resetTestkit }
}

/** Every contribution the registered peers make to a point, exactly as the platform reads it. */
export function contributionsOf<T = unknown>(point: string, opts: Pick<ContributionsOptions, 'except' | 'workspaceId'> = {}): Array<{ extensionId: string; item: T }> {
  return contributions<T>(point, { activeIds: registered, ...opts }).map(({ extensionId, item }) => ({ extensionId, item }))
}

/** Forget every fake peer and runtime contribution. Call it after each test. */
export function resetTestkit(): void {
  registered.clear()
  registeredGrants.clear()
  resetExtensionRegistry()
}

type Refusal = Error & { status?: number; statusCode?: number; code?: string }

const isRefusal = (e: unknown): e is Refusal => {
  const err = e as Refusal | null
  if (!err || typeof err !== 'object') return false
  const status = err.status ?? err.statusCode
  return status === 403 || err.code === 'FORBIDDEN' || err.code === 'NETWORK_REFUSED'
}

/** Runs the call and returns the refusal it ended in (a 403, FORBIDDEN or NETWORK_REFUSED); anything else - success included - fails the test. */
export async function expectRefused(run: () => unknown | Promise<unknown>): Promise<Refusal> {
  let result: unknown
  try { result = await run() } catch (e) {
    if (isRefusal(e)) return e
    throw e
  }
  throw new Error(`Expected a refusal, but the call succeeded${result === undefined ? '' : ` with ${JSON.stringify(result)}`}`)
}

/** Runs the call and returns its value; a refusal fails the test with the refusal's message. */
export async function expectAllowed<T>(run: () => T | Promise<T>): Promise<T> {
  try { return await run() } catch (e) {
    if (isRefusal(e)) throw new Error(`Expected the call to be allowed, but it was refused: ${e.message}`)
    throw e
  }
}
