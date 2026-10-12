/**
 * File Name: extensions.ts
 * Purpose: The extension state model on top of the runtime registry
 *          (closure plan Phase 4, Unit 2). Every REGISTERED extension is one
 *          capability of kind `extension` in the process registry; whether
 *          it is REQUIRED to start is answered by its installation rows
 *          (installed and enabled in at least one workspace x environment
 *          this process serves). The gate below is the one place the
 *          contribution paths ask "is this extension active here?", and the
 *          state view combines the rows with the registry's runtime phase.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: No second registry: the registry of registry.ts is
 *          the runtime truth (phase, availability, mounted, error) and
 *          workspace_installed_apps is the installation truth. The gate
 *          memoises the active ids per scope for a short TTL because the
 *          hook runner, the event wiring and every extension route ask on
 *          each request; in-process writes invalidate it, another
 *          process's write is seen within the TTL. Start/stop/dispose of an
 *          extension's own resources are delegated to a host (Unit 7 wires
 *          the server entry's hooks into it); here they are idempotent
 *          bookkeeping.
 */
import type { DeploymentRole } from '@tangen/types'
import { deploymentRole } from '../lib/deployment-role'
import type { TangenExtensionManifest, WorkspaceProject, ActivationMap, ActivationResult } from '@tangen/types'
import { resolveExtensionActivation, extensionStartOrder } from '@tangen/types'
import type { RuntimeRegistry, CapabilityState, Availability } from './registry'
import { listInstalls, listGrantedGrants, type InstallExec, type ExtensionInstallRow } from '../services/extension-install-state'
import { readScopeMigrationLedger, explainPendingSchema, type DeclaredMigration } from '@tangen/db'

/** The scope an extension is installed in: a workspace of this deployment. */
export interface ExtensionScope { workspaceId: string }

/** The workspaces each loaded project serves. */
export function projectScopes(projects: WorkspaceProject[]): ExtensionScope[] {
  return projects.map((p) => ({ workspaceId: p.workspaceId }))
}

/**
 * Boot adoption: every extension a project declares is installed in its
 * workspace, unless the manifest's `deploymentRoles` excludes this
 * deployment's role (a developer tool is never adopted into production).
 */
export function declaredExtensionAdoption(projects: WorkspaceProject[], role: DeploymentRole = deploymentRole()) {
  const out: Array<{ workspaceId: string; extensions: Array<{ id: string; version: string }> }> = []
  for (const p of projects) {
    const extensions = (p.extensions ?? [])
      .filter((e) => { const allowed = e.manifest?.deploymentRoles; return !allowed || allowed.includes(role) })
      .map((e) => ({ id: e.id, version: e.manifest?.version ?? '0.0.0' }))
    if (extensions.length > 0) out.push({ workspaceId: p.workspaceId, extensions })
  }
  return out
}

export interface ExtensionGate {
  /** ACTIVE = installed, enabled and every requirement met in this workspace. */
  isActive(extensionId: string, workspaceId: string): Promise<boolean>
  activeIds(workspaceId: string): Promise<string[]>
  /** Why an extension is or is not active here (Unit 4). */
  explain(extensionId: string, workspaceId: string): Promise<ActivationResult>
  /** The whole resolution of one scope. */
  resolve(workspaceId: string): Promise<ActivationMap>
  /** Active in at least one scope this process serves: the registry's REQUIRED question. */
  activeAnywhere(extensionId: string): Promise<boolean>
  /**
   * The synchronous answer for callers that cannot await (the realtime
   * authoriser, the field validator): the last resolution of the scope, or
   * null when the scope has not been resolved yet - in which case the
   * resolution is started so the next call knows.
   */
  activeSync(extensionId: string, workspaceId: string): boolean | null
  /** K5.2a: the grants recorded for an installation - undefined until the scope resolved, null when not reviewed (or not installed). */
  grantsSync(extensionId: string, workspaceId: string): string[] | null | undefined
  /** Forget the memo (after an in-process install state write). */
  invalidate(): void
}

export interface ExtensionGateOptions {
  scopes: () => ExtensionScope[]
  /** The loaded manifests (REGISTER). Default: none, so only installation rows decide. */
  manifests?: () => Record<string, TangenExtensionManifest>
  /** A Tangen capability's availability; null when the process has no such capability. Default: everything unknown. */
  capability?: (id: string) => Promise<Availability | null> | Availability | null
  /** The migrations an extension declares (REGISTER); the gate refuses an extension whose schema is pending here. Default: none. */
  migrations?: (id: string) => DeclaredMigration[] | undefined
  /** The role of an environment, for the manifest `environments` policy. Default: unknown (the policy is not applied). */
  /** The deployment role of this process, for the manifest `deploymentRoles` policy. Default: the process's own. */
  role?: () => DeploymentRole
  ttlMs?: number
}

const NOT_KNOWN: ActivationResult = { active: false, state: 'not-installed', reason: 'not installed here', missingOptional: [] }

export function createExtensionGate(exec: InstallExec, opts: ExtensionGateOptions): ExtensionGate {
  const ttl = opts.ttlMs ?? 2000
  const memo = new Map<string, { at: number; result: Promise<ActivationMap> }>()
  const settled = new Map<string, ActivationMap>()
  /** K5.2a: the approval record per scope, kept beside the activation so the runtime binds without a query. */
  const grantsByScope = new Map<string, Record<string, string[] | null>>()
  const resolveScope = async (workspaceId: string): Promise<ActivationMap> => {
    const rows = await listInstalls(exec, { workspaceId })
    grantsByScope.set(workspaceId, await listGrantedGrants(exec, { workspaceId }))
    const installed: Record<string, { version: string | null; enabled: boolean }> = {}
    for (const r of rows) if (r.state === 'installed') installed[r.extensionId] = { version: r.version, enabled: r.enabled }
    const manifests = opts.manifests?.() ?? {}
    // Capabilities first (async), then the pure resolver.
    const capabilities = new Map<string, Availability | null>()
    for (const m of Object.values(manifests)) {
      for (const cap of m.requires?.capabilities ?? []) {
        if (!capabilities.has(cap)) capabilities.set(cap, opts.capability ? await opts.capability(cap) : null)
      }
    }
    // The declared schema must be in place: one ledger read for the scope,
    // only when some installed extension declares migrations.
    const schema = new Map<string, string | null>()
    if (opts.migrations) {
      const declaring = Object.keys(installed).filter((id) => (opts.migrations!(id)?.length ?? 0) > 0)
      if (declaring.length > 0) {
        const ledger = await readScopeMigrationLedger(exec, { workspaceId }).catch(() => ({} as Record<string, never[]>))
        for (const id of declaring) schema.set(id, explainPendingSchema(opts.migrations(id)!, ledger[id] ?? []))
      }
    }
    const role = opts.role ? opts.role() : deploymentRole()
    return resolveExtensionActivation({ installed, manifests, role, capability: (id) => capabilities.get(id) ?? null, schema: (id) => schema.get(id) ?? null })
  }
  const resolve = (workspaceId: string) => {
    const key = workspaceId
    const hit = memo.get(key)
    const now = Date.now()
    if (hit && ttl > 0 && now - hit.at < ttl) return hit.result
    const result = resolveScope(workspaceId).catch((e) => { memo.delete(key); throw e })
    memo.set(key, { at: now, result })
    result.then((r) => settled.set(key, r), () => {})
    return result
  }
  const activeIds = async (workspaceId: string) =>
    Object.entries(await resolve(workspaceId)).filter(([, r]) => r.active).map(([id]) => id)
  return {
    activeIds,
    resolve,
    isActive: async (extensionId, workspaceId) => (await resolve(workspaceId))[extensionId]?.active === true,
    explain: async (extensionId, workspaceId) => (await resolve(workspaceId))[extensionId] ?? NOT_KNOWN,
    activeAnywhere: async (extensionId) => {
      for (const s of opts.scopes()) if ((await resolve(s.workspaceId))[extensionId]?.active) return true
      return false
    },
    activeSync: (extensionId, workspaceId) => {
      const key = workspaceId
      const hit = memo.get(key)
      if (!hit || (ttl > 0 && Date.now() - hit.at >= ttl)) resolve(workspaceId).catch(() => {})
      const last = settled.get(key)
      return last ? last[extensionId]?.active === true : null
    },
    grantsSync: (extensionId, workspaceId) => {
      const scope = grantsByScope.get(workspaceId)
      if (!scope) return undefined
      return scope[extensionId] ?? null
    },
    invalidate: () => { memo.clear(); settled.clear(); grantsByScope.clear() },
  }
}

export const extensionCapabilityId = (extensionId: string) => `ext:${extensionId}`

/** What an extension's runtime does at START / STOP / DISPOSE; Unit 7 wires the server entry's hooks in. */
export interface ExtensionRuntimeHost {
  start(extensionId: string): void | Promise<void>
  stop(extensionId: string): void | Promise<void>
  dispose(extensionId: string): void | Promise<void>
}

export interface RegisterExtensionsInput {
  /** The REGISTERED extension ids (the loaded manifests). */
  ids: () => string[]
  manifest: (id: string) => TangenExtensionManifest | undefined
  gate: ExtensionGate
  host?: Partial<ExtensionRuntimeHost>
  /** A Tangen capability's availability, for `requires.capabilities` (default: the registry's own answer). */
  capability?: (id: string) => Promise<Availability | null> | Availability | null
}

/** Unavailable when a required Tangen capability is missing or unavailable; the reason names it. */
export async function requiredCapabilitiesAvailability(
  manifest: TangenExtensionManifest | undefined,
  capability: (id: string) => Promise<Availability | null> | Availability | null,
): Promise<Availability> {
  for (const cap of manifest?.requires?.capabilities ?? []) {
    const a = await capability(cap)
    if (!a) return { available: false, reason: `requires capability '${cap}', which is not part of this server` }
    if (!a.available) return { available: false, reason: `requires capability '${cap}', which is unavailable: ${a.reason}` }
  }
  return { available: true }
}

/**
 * One capability per registered extension. Registering calls nothing on the
 * extension; START asks the gate whether it is active anywhere. Ids already
 * registered (a dev reload) are left alone.
 */
export function registerExtensionCapabilities(registry: RuntimeRegistry, input: RegisterExtensionsInput): string[] {
  const registered: string[] = []
  const capability = input.capability ?? ((id: string) => registry.availabilityOf(id))
  const ids = input.ids()
  const manifests: Record<string, TangenExtensionManifest> = {}
  for (const id of ids) { const m = input.manifest(id); if (m) manifests[id] = m }
  // A dependency registers before its dependants so the registry starts it
  // first and disposes it last; only registered dependencies order anything.
  for (const id of extensionStartOrder(manifests, ids)) {
    const capId = extensionCapabilityId(id)
    if (registry.has(capId)) continue
    const m = input.manifest(id)
    const dependsOn = (m?.requires?.extensions ?? [])
      .map((d) => (typeof d === 'string' ? d : d.id))
      .filter((dep) => ids.includes(dep) && dep !== id)
      .map(extensionCapabilityId)
    registry.register({
      id: capId,
      label: m?.name ?? id,
      kind: 'extension',
      dependsOn,
      availability: () => requiredCapabilitiesAvailability(m, capability),
      required: () => input.gate.activeAnywhere(id),
      start: () => input.host?.start?.(id),
      stop: () => input.host?.stop?.(id),
      dispose: () => input.host?.dispose?.(id),
    })
    registered.push(capId)
  }
  return registered
}

export type ExtensionStatus =
  | 'registered' | 'installed' | 'enabled' | 'mounted' | 'started' | 'stopped' | 'disabled' | 'unavailable' | 'disposed'

export interface ExtensionStateView {
  id: string
  name: string
  /** The registered code's version; null when the code is not loaded in this process. */
  version: string | null
  registered: boolean
  scope: ExtensionScope
  install: ExtensionInstallRow | null
  installed: boolean
  enabled: boolean
  runtime: Pick<CapabilityState, 'phase' | 'availability' | 'mounted' | 'error'> | null
  /** The dependency resolution for this scope (Unit 4). */
  activation: ActivationResult
  /** Why it is not active here; null when it is. */
  reason: string | null
  status: ExtensionStatus
}

function statusOf(v: Omit<ExtensionStateView, 'status'>): ExtensionStatus {
  if (!v.installed) return 'registered'
  if (!v.enabled) return 'disabled'
  if (!v.registered || !v.runtime) return 'installed'
  if (v.activation.state === 'unavailable' || v.activation.state === 'blocked' || v.activation.state === 'schema-pending') return 'unavailable'
  if (v.runtime.availability && !v.runtime.availability.available) return 'unavailable'
  if (v.runtime.phase === 'disposed') return 'disposed'
  if (v.runtime.phase === 'started') return 'started'
  if (v.runtime.phase === 'stopped') return 'stopped'
  if (v.runtime.mounted) return 'mounted'
  return 'enabled'
}

/**
 * The state of every extension known here (registered in this process or
 * installed in the scope), for one workspace x environment. The Phase 8
 * descriptor reads this; so do doctor and the CLI status.
 */
export async function extensionStates(
  exec: InstallExec,
  registry: RuntimeRegistry,
  scope: ExtensionScope,
  known: { ids: () => string[]; manifest: (id: string) => TangenExtensionManifest | undefined; gate?: ExtensionGate },
): Promise<ExtensionStateView[]> {
  const rows = await listInstalls(exec, scope)
  const ids = new Set<string>([...known.ids(), ...rows.map((r) => r.extensionId)])
  const activation = known.gate ? await known.gate.resolve(scope.workspaceId) : {}
  const out: ExtensionStateView[] = []
  for (const id of [...ids].sort()) {
    const m = known.manifest(id)
    const install = rows.find((r) => r.extensionId === id) ?? null
    const capId = extensionCapabilityId(id)
    const st = registry.has(capId) ? registry.state(capId) : null
    const installed = install?.state === 'installed'
    const enabled = installed && install.enabled
    const act: ActivationResult = activation[id] ?? {
      active: enabled && Boolean(m), reason: !installed ? 'not installed here' : !enabled ? 'disabled here' : !m ? 'installed here, but its code is not loaded in this process' : null,
      state: !installed ? 'not-installed' : !enabled ? 'disabled' : !m ? 'not-registered' : 'active', missingOptional: [],
    }
    const base: Omit<ExtensionStateView, 'status'> = {
      id, name: m?.name ?? id, version: m?.version ?? null, registered: Boolean(m), scope,
      install, installed, enabled,
      runtime: st ? { phase: st.phase, availability: st.availability, mounted: st.mounted, error: st.error } : null,
      activation: act, reason: act.reason,
    }
    out.push({ ...base, status: statusOf(base) })
  }
  return out
}
