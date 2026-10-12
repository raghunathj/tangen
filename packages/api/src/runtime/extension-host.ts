/**
 * File Name: extension-host.ts
 * Purpose: The runtime host for extensions (closure plan Phase 4, Unit 7):
 *          what the registry calls at START, STOP and DISPOSE of an
 *          `ext:<id>` capability. START runs the server entry's `onStart`
 *          once per workspace x environment where the extension is active
 *          and keeps the cleanup it returns; STOP runs `onStop` and the
 *          cleanups; DISPOSE stops what is still running and calls
 *          `onDispose` once. Everything is idempotent and per scope, so a
 *          scope that becomes active while the process runs can be started
 *          on its own (`reconcile`).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: No background work at import, REGISTER or INSTALL:
 *          the host only acts when the registry (or an in-process
 *          enable/disable) tells it to. A hook that throws is recorded per
 *          scope and never stops the other scopes or the other extensions;
 *          the registry's deadline bounds every call at shutdown. The ctx
 *          handed to the hooks is the same rich ctx events and routes get.
 */
import type { ExtensionServerCtx, TangenExtensionServer, ExtensionCleanup } from '@tangen/types'
import { getLogger } from '@tangen/logging'
import { withdrawContributions } from '../kernel/contributions'
import type { ExtensionGate, ExtensionScope, ExtensionRuntimeHost } from './extensions'

const log = () => getLogger(['tangen', 'extensions', 'runtime'])

export interface ExtensionHostDeps {
  gate: ExtensionGate
  /** Every scope this process serves. */
  scopes: () => ExtensionScope[]
  server: (extensionId: string) => TangenExtensionServer | undefined
  buildCtx: (extensionId: string, workspaceId: string) => ExtensionServerCtx | Promise<ExtensionServerCtx>
  /**
   * Asks the registry to start `ext:<id>` on demand (`ensureStarted`): an
   * extension that was not active anywhere at boot was skipped as
   * not-required, and an in-process enable must bring it up.
   */
  wake?: (extensionId: string) => Promise<boolean>
}

export interface ScopeRuntime {
  scope: ExtensionScope
  cleanup: ExtensionCleanup | null
  /** The error the scope's onStart (or onStop) raised, if any. */
  error: string | null
}

export interface ExtensionHost extends ExtensionRuntimeHost {
  /** The scopes an extension's runtime is started in. */
  running(extensionId: string): ScopeRuntime[]
  /** Start the extension in one scope (an in-process enable); no-op when already running or not active there. */
  startScope(extensionId: string, workspaceId: string): Promise<boolean>
  /** Stop the extension in one scope (an in-process disable); no-op when not running there. */
  stopScope(extensionId: string, workspaceId: string): Promise<boolean>
  /** Start every newly active scope and stop every scope no longer active, for one or every extension. */
  reconcile(extensionId?: string): Promise<{ started: string[]; stopped: string[] }>
}

const key = (s: ExtensionScope) => s.workspaceId
const describe = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createExtensionHost(deps: ExtensionHostDeps): ExtensionHost {
  /** extension id -> scope key -> runtime */
  const running = new Map<string, Map<string, ScopeRuntime>>()
  /** Extensions whose `onDispose` ran; it runs once per process. */
  const disposed = new Set<string>()
  /** Extensions START has been asked for: reconcile only touches these. */
  const started = new Set<string>()

  const startIn = async (id: string, scope: ExtensionScope): Promise<boolean> => {
    const byScope = running.get(id) ?? new Map<string, ScopeRuntime>()
    running.set(id, byScope)
    if (byScope.has(key(scope))) return false
    const server = deps.server(id)
    const rt: ScopeRuntime = { scope, cleanup: null, error: null }
    byScope.set(key(scope), rt)
    if (typeof server?.onStart !== 'function') return true
    try {
      const ctx = await deps.buildCtx(id, scope.workspaceId)
      const cleanup = await server.onStart(ctx)
      rt.cleanup = typeof cleanup === 'function' ? cleanup : null
    } catch (e) {
      rt.error = `onStart failed: ${describe(e)}`
      log().error(`extension '${id}' onStart failed in ${scope.workspaceId}`, e instanceof Error ? e : new Error(String(e)))
    }
    return true
  }

  const stopIn = async (id: string, scopeKey: string): Promise<boolean> => {
    const byScope = running.get(id)
    const rt = byScope?.get(scopeKey)
    if (!byScope || !rt) return false
    byScope.delete(scopeKey)
    const server = deps.server(id)
    if (typeof server?.onStop === 'function') {
      try { await server.onStop(await deps.buildCtx(id, rt.scope.workspaceId)) }
      catch (e) { log().error(`extension '${id}' onStop failed in ${rt.scope.workspaceId}`, e instanceof Error ? e : new Error(String(e))) }
    }
    if (rt.cleanup) {
      try { await rt.cleanup() }
      catch (e) { log().error(`extension '${id}' cleanup failed in ${rt.scope.workspaceId}`, e instanceof Error ? e : new Error(String(e))) }
    }
    // K2.2: what the scope contributed at runtime goes with it.
    withdrawContributions(id, rt.scope.workspaceId)
    return true
  }

  const activeScopes = async (id: string): Promise<ExtensionScope[]> => {
    const out: ExtensionScope[] = []
    for (const s of deps.scopes()) if (await deps.gate.isActive(id, s.workspaceId)) out.push(s)
    return out
  }

  return {
    async start(id) {
      if (disposed.has(id)) return
      started.add(id)
      for (const s of await activeScopes(id)) await startIn(id, s)
    },
    async stop(id) {
      started.delete(id)
      for (const k of [...(running.get(id)?.keys() ?? [])]) await stopIn(id, k)
    },
    async dispose(id) {
      if (disposed.has(id)) return
      started.delete(id)
      for (const k of [...(running.get(id)?.keys() ?? [])]) await stopIn(id, k)
      withdrawContributions(id)
      disposed.add(id)
      const server = deps.server(id)
      if (typeof server?.onDispose === 'function') {
        try { await server.onDispose() }
        catch (e) { log().error(`extension '${id}' onDispose failed`, e instanceof Error ? e : new Error(String(e))) }
      }
    },
    running: (id) => [...(running.get(id)?.values() ?? [])],
    async startScope(id, workspaceId) {
      if (disposed.has(id) || !started.has(id)) return false
      if (!(await deps.gate.isActive(id, workspaceId))) return false
      return startIn(id, { workspaceId })
    },
    stopScope: (id, workspaceId) => stopIn(id, key({ workspaceId })),
    async reconcile(only) {
      const report = { started: [] as string[], stopped: [] as string[] }
      // An extension the registry never started (nothing active at boot)
      // is woken through the registry, which calls start() and lists it.
      if (only && !started.has(only) && !disposed.has(only) && deps.wake && (await activeScopes(only)).length > 0) {
        await deps.wake(only)
        for (const rt of running.get(only)?.values() ?? []) report.started.push(`${only} ${key(rt.scope)}`)
        return report
      }
      for (const id of only ? [only] : [...started]) {
        if (!started.has(id) || disposed.has(id)) continue
        const wanted = new Set((await activeScopes(id)).map(key))
        for (const k of [...(running.get(id)?.keys() ?? [])]) if (!wanted.has(k)) { await stopIn(id, k); report.stopped.push(`${id} ${k}`) }
        for (const s of deps.scopes()) if (wanted.has(key(s)) && !running.get(id)?.has(key(s))) { await startIn(id, s); report.started.push(`${id} ${key(s)}`) }
      }
      return report
    },
  }
}
