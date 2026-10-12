/**
 * File Name: extension-server.ts
 * Purpose: The extension server-surface v2 runtime — workspace-scoped
 *          storage over extension_data, platform-event fan-out to
 *          subscribed extensions (installed workspaces only), ext:-task
 *          registration, and the admin-route matcher. This is what lets a
 *          product like Flows ship entirely as an extension.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: All data access rides an injected SQL executor and
 *          injected install-check/ctx builders — the boot wiring in
 *          index.ts supplies the real ones, tests supply fakes. Event
 *          delivery is fire-and-forget per handler (one bad extension
 *          never breaks the emitter), mirroring the event-bus contract.
 */
import type { ExtensionStore, ExtensionServerCtx, ExtensionAdminRoute, ExtensionPlatformEventType, TangenEvent } from '@tangen/types'
import { BUILT_IN_ROLES } from '@tangen/types'
import { getLogger } from '@tangen/logging'
import { eventBus, EventBus } from './event-bus'
import { registerExtensionTask } from './task-queue'
import { listRegisteredExtensionIds, getExtensionEvents, getExtensionTasks, getExtensionManifest, recordedGrantsOf } from '../hooks/app-hooks-registry'
import { registerSiteIdentity } from '../kernel/site-identity'
import type { SiteIdentityProvider, TangenExtensionServer } from '@tangen/types'
import { createExtensionRealtime } from '../realtime/extension-publisher'
import { canWriteLocale } from '../lib/field-access'
import { createExecution } from '../kernel/execution'
import { contributionOf } from '../kernel/contributions'
export { gateExtensionCtx } from '../kernel/gate'
import { extensionActor } from '../kernel/actor'
import type { ExecutionContext, ActorContext, ActorIdentity } from '@tangen/types'
import { grantNames } from '@tangen/types'
import { sqlExecOf, type SqlExec } from '../lib/sql-exec'

const log = () => getLogger(['tangen', 'api', 'ext-server'])

/**
 * Workspace-scoped key-value collection over the existing extension_data
 * table (object_id doubles as the key — no DDL, no migrations).
 */
export function createExtensionStore(
  exec: SqlExec,
  extensionId: string,
  workspaceId: string,
): ExtensionStore {
  const scope = [extensionId, workspaceId]
  const normalize = (v: unknown): Record<string, unknown> => {
    // jsonb written as a string reads back double-encoded — normalize
    if (typeof v === 'string') { try { return JSON.parse(v) } catch { return {} } }
    return (v as Record<string, unknown>) ?? {}
  }
  return {
    async get(key) {
      const rows = await exec(
        `SELECT data FROM extension_data
          WHERE extension_id = $1 AND workspace_id = $2 AND object_id = $3 LIMIT 1`,
        [...scope, key],
      )
      return rows[0] ? normalize(rows[0].data) : undefined
    },
    async put(key, data) {
      await exec(
        `INSERT INTO extension_data (id, extension_id, workspace_id, object_id, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (extension_id, object_id, workspace_id)
         DO UPDATE SET data = $5, updated_at = now()`,
        [`extd_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, ...scope, key, JSON.stringify(data)],
      )
    },
    async remove(key) {
      await exec(
        `DELETE FROM extension_data
          WHERE extension_id = $1 AND workspace_id = $2 AND object_id = $3`,
        [...scope, key],
      )
    },
    async list(prefix = '', opts) {
      // Optional SQL-side ordering by a data key + paging - large stores (run
      // logs) page in the database instead of shipping every payload.
      const orderKey = opts?.orderByDataKey
      if (orderKey && !/^[a-zA-Z0-9_]+$/.test(orderKey)) throw new Error('orderByDataKey must be alphanumeric')
      const order = orderKey
        ? `ORDER BY data->>'${orderKey}' ${opts?.desc ? 'DESC' : 'ASC'} NULLS LAST`
        : 'ORDER BY updated_at DESC'
      const page = `${Number.isFinite(opts?.limit) ? ` LIMIT ${Math.max(0, Math.floor(opts!.limit!))}` : ''}${Number.isFinite(opts?.offset) ? ` OFFSET ${Math.max(0, Math.floor(opts!.offset!))}` : ''}`
      const rows = await exec(
        `SELECT object_id, data FROM extension_data
          WHERE extension_id = $1 AND workspace_id = $2 AND object_id LIKE $3
          ${order}${page}`,
        [...scope, `${prefix.replace(/[%_]/g, '\\$&')}%`],
      )
      return rows.map((r) => ({ key: String(r.object_id), data: normalize(r.data) }))
    },
    async count(prefix = '') {
      const rows = await exec(
        `SELECT COUNT(*)::int AS n FROM extension_data
          WHERE extension_id = $1 AND workspace_id = $2 AND object_id LIKE $3`,
        [...scope, `${prefix.replace(/[%_]/g, '\\$&')}%`],
      )
      return Number(rows[0]?.n ?? 0)
    },
  }
}

/**
 * The platform-typed events an extension may emit as its own. Studio's
 * publish lifecycle, and nothing else: `object.published` drives webhooks
 * and flows, and an extension must not be able to forge it.
 */
export const EXTENSION_PLATFORM_EVENTS: ReadonlySet<ExtensionPlatformEventType> = new Set<ExtensionPlatformEventType>([
  'publish.started', 'publish.completed', 'publish.failed',
  // Realtime R3: Studio's class and tag writes, fanned to studio:<objectId> and studio:classes by the bridge.
  'studio.class.changed', 'studio.tag.changed',
  // A theme write (one token value or one font), fanned to studio:classes by the bridge.
  'studio.theme.changed',
  // Forms (an extension since plan-core-slimming S3) announces an accepted submission.
  'form.submitted',
])

type EmitOpts = { actorId?: string | null; actorType?: 'member' | 'api_key' | null }

/**
 * The two emitters on an extension ctx, built once per workspace x env.
 *
 * `emit` namespaces (`ext:<id>:<name>`): an extension's own vocabulary,
 * which flows and webhooks subscribe to by that id. `emitPlatform` does NOT
 * namespace, because the realtime bridge table keys on the platform type -
 * an `ext:studio:publish.started` would be dropped - and is allow-listed in
 * exchange. Extracted from the boot-time ctx builder so the contract can be
 * tested without booting the API.
 */
export function createExtensionEmitters(scope: {
  extensionId: string
  workspaceId: string
  bus?: EventBus
}): {
  emit: NonNullable<ExtensionServerCtx['emit']>
  emitPlatform: NonNullable<ExtensionServerCtx['emitPlatform']>
  /** Realtime R4: `ctx.realtime.publish` on a channel the manifest declares (realtime/extension-publisher.ts). */
  realtime: NonNullable<ExtensionServerCtx['realtime']>
} {
  const bus = scope.bus ?? eventBus
  const realtime = createExtensionRealtime({ extensionId: scope.extensionId, workspaceId: scope.workspaceId })
  const envelope = (type: string, payload: Record<string, unknown>, opts?: EmitOpts) => ({
    id: globalThis.crypto.randomUUID(), type,
    workspaceId: scope.workspaceId, timestamp: new Date().toISOString(),
    actorId: opts?.actorId ?? null, actorType: opts?.actorType ?? null, source: 'extension',
    payload,
  }) as unknown as TangenEvent
  return {
    emit: (name, payload, opts) => {
      bus.emit(envelope(`ext:${scope.extensionId}:${name}`, payload ?? {}, opts))
    },
    emitPlatform: (type, payload, opts) => {
      if (!EXTENSION_PLATFORM_EVENTS.has(type)) {
        throw new Error(`Extension "${scope.extensionId}" cannot emit "${String(type)}" - only ${[...EXTENSION_PLATFORM_EVENTS].join(', ')} may be emitted by an extension`)
      }
      bus.emit(envelope(type, payload as Record<string, unknown>, opts))
    },
    realtime,
  }
}

export interface ExtensionWiringDeps {
  exec: SqlExec
  /** Is the extension ACTIVE (installed and enabled) in this workspace x environment? The one gate every contribution path asks. */
  isActive: (extensionId: string, workspaceId: string) => Promise<boolean>
  /** The ids active in one workspace x environment (one memoised query). */
  activeIds?: (workspaceId: string) => Promise<string[]>
  /** Forget the gate's memo after an in-process install state write. */
  invalidate?: () => void
  /** The runtime host (Unit 7): reconcile after an in-process install state write so onStart / onStop follow ENABLE / DISABLE. */
  host?: { reconcile: (extensionId?: string) => Promise<{ started: string[]; stopped: string[] }> }
  /** The lifecycle deps (Unit 8) the admin enable / disable / upgrade routes run with. */
  lifecycle?: import('./extension-lifecycle').LifecycleDeps
  /** Builds the rich handler ctx for one extension × workspace × env. */
  buildCtx: (extensionId: string, workspaceId: string) => ExtensionServerCtx | Promise<ExtensionServerCtx>
  /** Event bus to attach to (defaults to the process singleton). */
  bus?: EventBus
}

const _unsubs: Array<() => void> = []
let _deps: ExtensionWiringDeps | null = null

/** The wired deps (route mounts reuse the same ctx builder). */
export function extensionWiringDeps(): ExtensionWiringDeps | null {
  return _deps
}

/**
 * Wires every registered extension's events + tasks into the runtime.
 * Idempotent per boot (dev reload calls resetExtensionWiring first).
 */
/** The context bound to one execution (kernel K7): `exec` set, `tangen` a client that does what that execution's actor may. */
export function bindExtensionCtx<C extends ExtensionServerCtx>(ctx: C, exec: ExecutionContext | null | undefined): C {
  if (!exec) return ctx
  return { ...ctx, exec, tangen: ctx.clientFor ? ctx.clientFor(exec) : ctx.tangen }
}

/**
 * The actor an extension's OWN surfaces run as (Extension Kernel K1.2): the
 * extension actor with exactly the grants its manifest declares - refused by
 * every guard like a key - or, for an extension that declares no `grants`,
 * Tangen's own authority attributed `extension:<id>` (today's binding, kept
 * for back-compat). Decided from the registered manifest, once per execution.
 */
export function extensionOwnActor(extensionId: string, workspaceId: string): ActorContext {
  // E.14: always the extension actor under its effective grants; a grantless manifest holds nothing.
  return extensionActor({ extensionId, workspaceId, grants: effectiveGrants(extensionId, workspaceId) })
}

/**
 * K5.2a: the grants an extension runs with in a scope. Empty for an extension
 * that declares none (E.14: no trusted class). Otherwise the installation's
 * RECORDED approval intersected with what the current manifest declares
 * (required or optional) - so a new required grant is not held until it is
 * re-reviewed, and a grant the manifest dropped is revoked without touching
 * the record. No record (not reviewed, or the scope not resolved yet):
 * the manifest's required grants, as before review existed.
 */
/**
 * The scope Porter runs a provider in (E.4). An extension's provider gets
 * its own store for the workspace and the platform database handle only
 * under `db:own`; a platform provider (no extension id, or one the platform
 * registered itself and merely gates on the extension) keeps the handle and
 * gets no store.
 */
export function porterProviderScope(provider: { extensionId?: string; contributed?: boolean }, db: unknown, workspaceId: string): { db: unknown; store?: ExtensionStore } {
  // A platform provider gated by an extension's presence (Studio's, Flows') is platform code: it keeps the handle.
  if (!provider.extensionId || !provider.contributed) return { db }
  const grants = effectiveGrants(provider.extensionId, workspaceId)
  const exec = sqlExecOf(db)
  const store = exec ? createExtensionStore(exec, provider.extensionId, workspaceId) : undefined
  return { db: grants.includes('db:own') ? db : undefined, store }
}

export function effectiveGrants(extensionId: string, workspaceId: string): string[] {
  const grants = getExtensionManifest(extensionId)?.grants
  if (!grants || !Array.isArray(grants.required)) return []
  const required = grantNames(grants.required)
  const recorded = recordedGrantsOf(extensionId, workspaceId)
  if (!Array.isArray(recorded)) return required
  const declared = new Set([...required, ...grantNames(grants.optional)])
  return recorded.filter((g) => declared.has(g))
}

// ── Block E.2: the facilities a declaring extension holds decide what mounts ──

/** Does the manifest declare this grant at all (required or optional)? A grantless manifest declares nothing (E.14). */
function declaresGrant(extensionId: string, grant: string): boolean {
  const grants = getExtensionManifest(extensionId)?.grants
  if (!grants || !Array.isArray(grants.required)) return false
  return grantNames(grants.required).includes(grant) || grantNames(grants.optional).includes(grant)
}
/** Does the extension HOLD this facility in the workspace (effective grants)? */
function holdsFacility(extensionId: string, workspaceId: string, grant: string): boolean {
  return effectiveGrants(extensionId, workspaceId).includes(grant)
}
/** `events:subscribe`: whether the extension's event subscriptions may run here. */
export function subscriptionsAllowed(extensionId: string, workspaceId: string): boolean { return holdsFacility(extensionId, workspaceId, 'events:subscribe') }
/** `hooks:content`: whether the extension's content hooks run here (a beforeChange hook can veto every write). */
export function hooksAllowed(extensionId: string, workspaceId: string): boolean { return holdsFacility(extensionId, workspaceId, 'hooks:content') }
/** `routes:<mode>`: whether the extension's routes of that auth mode mount here. */
export function routesAllowed(extensionId: string, workspaceId: string, mode: 'member' | 'key' | 'public'): boolean { return holdsFacility(extensionId, workspaceId, `routes:${mode}`) }

/**
 * `network:option(<dotted.path>)` → `network:<host>` from the install options
 * (an operator-configured issuer or endpoint), so a bundled extension needs no
 * `network:any` for a host only the deployment knows. A missing or non-URL
 * value grants nothing.
 */
export function expandOptionGrants(grants: readonly string[] | null | undefined, options: Record<string, unknown> | undefined): string[] {
  if (!grants) return []
  const out: string[] = []
  for (const g of grants) {
    const m = /^network:option\(([^)]+)\)$/.exec(g)
    if (!m) { out.push(g); continue }
    // A `*` segment maps over an array (E.9: `providers.*.issuer` - every issuer an operator configured).
    const values = m[1]!.split('.').reduce<unknown[]>((acc, k) => acc.flatMap((v) => {
      if (!v || typeof v !== 'object') return []
      if (k === '*') return Array.isArray(v) ? v : []
      return [(v as Record<string, unknown>)[k]]
    }), [options])
    for (const value of values) {
      if (typeof value !== 'string') continue
      try { const host = new URL(value).hostname.toLowerCase(); if (host) out.push(`network:${host}`) } catch { /* not a url: nothing granted */ }
    }
  }
  return out
}

/** An execution under the extension's own actor, carrying the chain it is part of. */
export function extensionExecution(extensionId: string, workspaceId: string, chain: {
  initiator?: ActorIdentity | null
  correlationId?: string | null
  causationId?: string | null
} = {}): ExecutionContext {
  return createExecution({
    kind: 'job', source: 'extension', workspaceId,
    actor: extensionOwnActor(extensionId, workspaceId),
    initiator: (chain.initiator ?? null) as never,
    correlationId: chain.correlationId ?? undefined, causationId: chain.causationId ?? undefined,
  })
}

/** An event handler's execution: the extension's own authority (K1.2: its grants, or Tangen's when it declares none), the event's actor as the initiator. */
export function eventExecution(extensionId: string, event: TangenEvent): ExecutionContext {
  const e = event as TangenEvent & { actor?: { kind: string; id: string | null }; correlationId?: string; actorId?: string | null; actorType?: string | null }
  const initiator = e.actor && e.actor.id && (e.actor.kind === 'member' || e.actor.kind === 'api_key')
    ? { kind: e.actor.kind, id: e.actor.id }
    : e.actorId && (e.actorType === 'member' || e.actorType === 'api_key') ? { kind: e.actorType, id: e.actorId } : null
  return extensionExecution(extensionId, event.workspaceId, { initiator: initiator as ActorIdentity | null, correlationId: e.correlationId ?? event.id, causationId: event.id })
}

export function wireExtensionServers(deps: ExtensionWiringDeps): void {
  _deps = deps
  for (const extensionId of listRegisteredExtensionIds()) {
    // E.2: a manifest without events:subscribe attaches no subscription; one that declares it is checked per event against what it holds.
    // Only the subscriptions are skipped: the site identity below registers on its own terms (E.14 fix).
    const subscriptions = declaresGrant(extensionId, 'events:subscribe') ? (getExtensionEvents(extensionId) ?? []) : []
    if (!declaresGrant(extensionId, 'events:subscribe') && (getExtensionEvents(extensionId) ?? []).length) log().warn(`extension '${extensionId}' declares event subscriptions without the events:subscribe grant; none attach`)
    for (const sub of subscriptions) {
      const wanted = sub.types === '*' ? null : new Set(sub.types)
      const off = (deps.bus ?? eventBus).on('*', (event: TangenEvent) => {
        if (wanted && !wanted.has(event.type)) return
        void (async () => {
          if (!(await deps.isActive(extensionId, event.workspaceId))) return
          if (!subscriptionsAllowed(extensionId, event.workspaceId)) return
          // K7: the handler reacts with the extension's own authority, the event's actor as initiator.
          const ctx = bindExtensionCtx(await deps.buildCtx(extensionId, event.workspaceId), eventExecution(extensionId, event))
          await sub.handler(event, ctx)
        })().catch((err) =>
          log().error(`extension '${extensionId}' event handler failed`, err instanceof Error ? err : new Error(String(err))),
        )
      })
      _unsubs.push(off)
    }
    // A site identity provider (tasks/plan-core-slimming.md S1): serves the
    // workspaces where the extension is active, built once per workspace
    // from the extension's ctx so a vendor secret can be read through it.
    // K2.2: `site.identity@1` (single) - the legacy key and the explicit `contributions` form alike.
    const siteIdentity = contributionOf<NonNullable<TangenExtensionServer['siteIdentity']>>('site.identity@1', { activeIds: new Set([extensionId]) })?.item
    if (siteIdentity) {
      const providers = new Map<string, Promise<SiteIdentityProvider>>()
      _unsubs.push(registerSiteIdentity({
        id: `ext:${extensionId}`,
        extensionId,
        forWorkspace: async (workspaceId) => {
          if (!(await deps.isActive(extensionId, workspaceId))) return null
          let p = providers.get(workspaceId)
          if (!p) {
            p = typeof siteIdentity === 'function'
              ? Promise.resolve(deps.buildCtx(extensionId, workspaceId)).then((ctx) => siteIdentity(ctx))
              : Promise.resolve(siteIdentity)
            providers.set(workspaceId, p)
          }
          return p
        },
      }))
    }
    for (const task of getExtensionTasks(extensionId) ?? []) {
      registerExtensionTask({
        id: `ext:${extensionId}:${task.name}`,
        description: task.description,
        handler: async (jobCtx: { workspaceId: string; exec?: ExecutionContext }, payload: unknown) => {
          // A task enqueued before a disable (or for another environment) does not run the handler.
          if (!(await deps.isActive(extensionId, jobCtx.workspaceId))) return
          // K7: the task runs as the run's actor (K6), the extension's ctx bound
          // to it - or, when the task says `runAs: 'extension'`, with the
          // extension's own authority and the run's actor as the initiator.
          const exec = task.runAs === 'extension'
            ? extensionExecution(extensionId, jobCtx.workspaceId, {
                initiator: jobCtx.exec?.actor.identity ?? null,
                correlationId: jobCtx.exec?.correlationId, causationId: jobCtx.exec?.id,
              })
            : jobCtx.exec ?? null
          const ctx = bindExtensionCtx(await deps.buildCtx(extensionId, jobCtx.workspaceId), exec)
          await task.handler(payload, ctx)
        },
      } as never)
    }
  }
}

/**
 * The Porter gate for one workspace x environment (Unit 11): a provider
 * owned by a REGISTERED extension is offered only where that extension is
 * active; a provider owned by a feature that has no manifest (forms) or
 * by nothing is always offered. Without wiring (tests, tools) everything
 * is offered.
 */
export async function porterActivePredicate(workspaceId: string): Promise<((extensionId: string) => boolean) | undefined> {
  const deps = _deps
  if (!deps?.activeIds) return undefined
  const active = new Set(await deps.activeIds(workspaceId).catch(() => [] as string[]))
  return (extensionId) => (getExtensionManifest(extensionId) ? active.has(extensionId) : true)
}

/** Test helper — detaches all event subscriptions. */
export function resetExtensionWiring(): void {
  for (const off of _unsubs.splice(0)) off()
  _deps = null
}

/** What a surface learns about publishing, plus who said so. */
export interface ResolvedPublishPolicy {
  blocked: boolean
  reason?: string
  actionLabel?: string
  /** Which extension is standing in the way (absent when nothing is). */
  extensionId?: string
  /**
   * What the user can DO about it, offered in place of the blocked action.
   * Relative to the blocking extension's own admin mount.
   */
  action?: { label: string; path: string; method?: 'POST' | 'PATCH'; body?: Record<string, unknown> }
}

/**
 * Asks the installed extensions whether publishing is currently unavailable,
 * so a surface can stop offering an action that cannot succeed.
 *
 * This is ADVISORY and defaults to permissive at every turn. A workspace with
 * no extensions, or none declaring a policy, or one whose policy throws or
 * returns nonsense, all resolve to "not blocked" - exactly the behaviour of a
 * Tangen that never heard of this. Content hooks remain the thing that
 * actually refuses a publish, so the worst case of a wrong answer here is the
 * button staying visible and the real gate refusing honestly, which is what
 * happens today.
 */
export async function resolvePublishPolicy(input: {
  entries: Array<{ id: string; server: Record<string, unknown> }>
  isActive: (extensionId: string, workspaceId: string) => Promise<boolean>
  buildCtx: (extensionId: string, workspaceId: string) => Promise<unknown>
  workspaceId: string
  typeName: string
  objectId?: string
}): Promise<ResolvedPublishPolicy> {
  // The first blocking extension, as this route always answered; the
  // lifecycle action policy (kernel/lifecycle-actions.ts) takes them all.
  return (await resolvePublishPolicies(input))[0] ?? { blocked: false }
}

/** Every installed extension's blocking answer, in extension order (K2: merged, not first-wins). */
export async function resolvePublishPolicies(input: {
  entries: Array<{ id: string; server: Record<string, unknown> }>
  isActive: (extensionId: string, workspaceId: string) => Promise<boolean>
  buildCtx: (extensionId: string, workspaceId: string) => Promise<unknown>
  workspaceId: string
  typeName: string
  objectId?: string
}): Promise<ResolvedPublishPolicy[]> {
  const out: ResolvedPublishPolicy[] = []
  for (const entry of input.entries) {
    const policy = entry.server?.publishPolicy
    if (typeof policy !== 'function') continue
    try {
      if (!(await input.isActive(entry.id, input.workspaceId))) continue
      const ctx = await input.buildCtx(entry.id, input.workspaceId)
      const answer = await (policy as (c: unknown, i: unknown) => unknown)(
        ctx, { typeName: input.typeName, objectId: input.objectId },
      )
      if (!answer || typeof answer !== 'object') continue
      const { blocked, reason, actionLabel, action } = answer as ResolvedPublishPolicy
      if (blocked !== true) continue
      // Rebuilt field by field rather than spread, so an extension cannot
      // smuggle unexpected keys into the response - which means every NEW
      // field must be added here too, or it is silently dropped.
      const usableAction = action
        && typeof action.label === 'string' && action.label !== ''
        && typeof action.path === 'string' && action.path !== ''
      out.push({
        blocked: true,
        ...(typeof reason === 'string' && reason ? { reason } : {}),
        ...(typeof actionLabel === 'string' && actionLabel ? { actionLabel } : {}),
        ...(usableAction ? { action } : {}),
        extensionId: entry.id,
      })
    } catch {
      // A broken hint must never be the reason someone cannot reach a button.
      continue
    }
  }
  return out
}

/**
 * Every role slug a workspace has: the built-ins, plus any seeded from code
 * (tangen.config.ts `roles`), plus any created in the admin. A code seed may
 * shadow a built-in (editor/viewer are overridable), so the union is
 * de-duplicated with the built-ins kept first.
 *
 * Extensions gating on roles need this to reject a slug the workspace does
 * not actually have - without it an admin can save a restriction naming a
 * role nobody holds, which silently locks the stage to the owner.
 */
export function workspaceRoleSlugs(
  codeRoles: Array<{ slug?: unknown }> = [],
  dbRoles: Array<{ slug?: unknown }> = [],
): string[] {
  const out: string[] = [...BUILT_IN_ROLES]
  for (const role of [...codeRoles, ...dbRoles]) {
    const slug = typeof role?.slug === 'string' ? role.slug.trim() : ''
    if (slug && !out.includes(slug)) out.push(slug)
  }
  return out
}

/**
 * Roles that are never constrained and always satisfy a role restriction.
 * `owner` is the workspace's permanent recovery path: a restriction that ends
 * up naming nobody (an emptied list after a role was deleted) must still leave
 * someone able to act, or content strands with no way out.
 */
const ALWAYS_ALLOWED_ROLES = new Set(['owner', 'superadmin'])

/**
 * Builds the `actAsRole` helper handed to extension route handlers: does this
 * caller satisfy a role restriction?
 *
 * - `null` restriction  - satisfied by everyone (there is nothing to satisfy)
 * - owner / superadmin  - always satisfied, INCLUDING an empty list
 * - otherwise           - the caller's workspace role must be listed
 *
 * Deliberately answers only the ROLE question. Capability checks stay with
 * `can()` so an extension composes the two as its own model requires.
 */
export function makeActAsRole(memberRole: string | null) {
  return (roles: string[] | null): boolean => {
    if (roles === null || roles === undefined) return true
    if (memberRole && ALWAYS_ALLOWED_ROLES.has(memberRole)) return true
    if (!memberRole) return false
    return roles.includes(memberRole)
  }
}

/**
 * Builds the `canWriteLocale` helper handed to extension route handlers: may
 * this caller write content in a language?
 *
 * `null` (the default) means the base / default language, which is what an
 * extension writing a shared document is doing. A translate-only role
 * (`MemberPermissions.locales`) is refused there exactly as it is on every
 * platform write path; admin sessions and API keys pass, as they do
 * everywhere else.
 *
 * The seam exists because a route handler otherwise sees only capabilities,
 * and a capability grant must never become a way around the locale model.
 */
export function makeCanWriteLocale(
  ctx: { memberId?: string | null; permissions?: unknown },
  defaultLocale: string | undefined,
) {
  return (locale: string | null = null): boolean => canWriteLocale(ctx, locale, defaultLocale)
}

/**
 * Matches one registered admin route against a method + relative path.
 * ':name' segments capture params; no wildcards, exact segment count.
 */
export { validateFlowOutputFields } from '../hooks/app-hooks-registry'

export function matchAdminRoute(
  routes: ExtensionAdminRoute[],
  method: string,
  path: string,
): { route: ExtensionAdminRoute; params: Record<string, string> } | undefined {
  const parts = path.split('/').filter(Boolean)
  outer: for (const route of routes) {
    if (route.method !== method) continue
    const pattern = route.path.split('/').filter(Boolean)
    if (pattern.length !== parts.length) continue
    const params: Record<string, string> = {}
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i].startsWith(':')) params[pattern[i].slice(1)] = decodeURIComponent(parts[i])
      else if (pattern[i] !== parts[i]) continue outer
    }
    return { route, params }
  }
  return undefined
}
