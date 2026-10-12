/**
 * File Name: extension-lifecycle.ts
 * Purpose: The lifecycle operations of the extension platform as the API
 *          performs them (closure plan Phase 4, Unit 8): ENABLE, DISABLE
 *          and UPGRADE over the install state, the migration runner, the
 *          server entry's hooks, the gate and the runtime host. The admin
 *          routes call these; the CLI runs the same plan and runner
 *          without a host (Unit 12).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: UPGRADE is explicit and deterministic: plan
 *          (target version, options, dependencies, migration history),
 *          stop the scope's runtime, run only the pending migrations,
 *          `onUpgrade` for non-schema work, record the version - only on
 *          success - then restore enabled and running state. A failure
 *          leaves the old version on the row, the ledger's failed row or
 *          the reported hook error as the diagnosis, and the scope not
 *          active until the next successful run.
 */
import { getLogger } from '@tangen/logging'
import { randomUUID } from 'node:crypto'
import { cleanupOnUninstall, contributedNodesOf, type CleanupLedger } from './extension-cleanup'
import type { SealedKey } from '../lib/sealed'
import type { TangenExtensionManifest, ExtensionServerCtx } from '@tangen/types'
import { planExtensionUpgrade, activeDependantsOf, providerOwnershipRefusal, type UpgradePlan } from '@tangen/types'
import {
  readInstall, listInstalls, setExtensionEnabled, recordInstalledVersion, uninstallExtension,
  planExtensionMigrations, runExtensionMigrations, readExtensionMigrationLedger,
  type InstallExec, type MigrationDb, type DeclaredMigration,
} from '@tangen/db'
import type { ExtensionGate } from '../runtime/extensions'
import type { ExtensionHost } from '../runtime/extension-host'
import type { Availability } from '../runtime/registry'

export interface LifecycleDeps {
  exec: InstallExec
  migrationDb: () => MigrationDb
  gate: ExtensionGate
  host?: Pick<ExtensionHost, 'reconcile' | 'stopScope' | 'running'>
  manifest: (id: string) => TangenExtensionManifest | undefined
  manifests: () => Record<string, TangenExtensionManifest>
  migrations: (id: string) => DeclaredMigration[] | undefined
  server: (id: string) => { onUpgrade?: (ctx: ExtensionServerCtx, info: { from: string | null; to: string }) => void | Promise<void> } | undefined
  buildCtx: (extensionId: string, workspaceId: string) => ExtensionServerCtx | Promise<ExtensionServerCtx>
  capability: (id: string) => Promise<Availability | null> | Availability | null
  /** K8.6: where `extension.uninstalled` is announced; absent in a process with no bus (tests). */
  bus?: { emit: (event: never) => unknown }
  /** K8.6: the deployment's connections key, to clear an uninstalled extension's connection material. */
  connectionsKey?: SealedKey | ((workspaceId: string) => SealedKey)
}

export interface UninstallResult { retired: boolean; cleanup: CleanupLedger | null }

export interface Scope { workspaceId: string; extensionId: string }

const log = () => getLogger(['tangen', 'extensions', 'lifecycle'])

/** Active extensions in the scope that require this one; a disable or uninstall is refused while any exists. */
export async function dependantsBlocking(deps: LifecycleDeps, scope: Scope): Promise<string[]> {
  const activation = await deps.gate.resolve(scope.workspaceId)
  return activeDependantsOf(scope.extensionId, deps.manifests(), activation)
}

/** A1: refused because another active pack already owns a provider this one declares. */
export class ProviderClashError extends Error {
  constructor(message: string) { super(message); this.name = 'ProviderClashError' }
}

/**
 * The providers a manifest declares, read from the MANIFEST so no server entry
 * runs to decide whether an extension may be enabled.
 */
function declaredProviders(manifest: { connectors?: Array<{ id?: string; provider?: string }> } | undefined): string[] {
  return [...new Set((manifest?.connectors ?? []).map((c) => c.provider ?? c.id).filter((p): p is string => typeof p === 'string' && p !== ''))]
}

/** null, or the refusal text, when enabling this extension would clash over a provider. */
export async function providerClashOnEnable(deps: LifecycleDeps, scope: Scope): Promise<string | null> {
  const manifests = deps.manifests() as Record<string, { connectors?: Array<{ id?: string; provider?: string }> }>
  const declares = declaredProviders(manifests[scope.extensionId])
  if (declares.length === 0) return null
  const activation = await deps.gate.resolve(scope.workspaceId)
  const claimed: Record<string, string> = {}
  for (const [id, state] of Object.entries(activation as Record<string, { active?: boolean }>)) {
    if (id === scope.extensionId || !state?.active) continue
    for (const provider of declaredProviders(manifests[id])) claimed[provider] ??= id
  }
  return providerOwnershipRefusal({ extensionId: scope.extensionId, declares, claimed })
}

export class DependantsError extends Error {
  constructor(readonly extensionId: string, readonly dependants: string[], action: 'disable' | 'uninstall') {
    super(`'${extensionId}' cannot be ${action}d here: ${dependants.map((d) => `'${d}'`).join(', ')} require${dependants.length === 1 ? 's' : ''} it. ${action === 'disable' ? 'Disable' : 'Uninstall or disable'} ${dependants.length === 1 ? 'it' : 'them'} first.`)
  }
}

/**
 * ENABLE / DISABLE in one scope; the gate forgets, the host follows. False
 * when nothing is installed there. A disable is refused while an active
 * extension requires this one.
 */
export async function setEnabled(deps: LifecycleDeps, scope: Scope, enabled: boolean): Promise<boolean> {
  if (!enabled) {
    const blocking = await dependantsBlocking(deps, scope)
    if (blocking.length > 0) throw new DependantsError(scope.extensionId, blocking, 'disable')
  }
  if (enabled) {
    // A1: the same refusal the CLI gives. Enabling a pack that claims a
    // provider another active pack owns would withhold BOTH at runtime, so it
    // is refused while the incumbent still works.
    const clash = await providerClashOnEnable(deps, scope)
    if (clash) throw new ProviderClashError(clash)
  }
  const ok = await setExtensionEnabled(deps.exec, scope, enabled)
  if (!ok) return false
  deps.gate.invalidate()
  await deps.host?.reconcile(scope.extensionId)
  return true
}

/**
 * UNINSTALL in one scope: STOP its runtime there, retire the row, retain
 * every byte of its data. False when nothing is installed there. Refused
 * while an active extension requires this one.
 */
export async function uninstall(deps: LifecycleDeps, scope: Scope): Promise<UninstallResult> {
  const blocking = await dependantsBlocking(deps, scope)
  if (blocking.length > 0) throw new DependantsError(scope.extensionId, blocking, 'uninstall')
  // K8.6: what the extension contributed by name, read while the registry still holds it.
  const contributed = contributedNodesOf(scope.extensionId, scope.workspaceId)
  const retired = await uninstallExtension(deps.exec, scope)
  if (!retired) return { retired: false, cleanup: null }
  deps.gate.invalidate()
  await deps.host?.reconcile(scope.extensionId)
  const key = typeof deps.connectionsKey === 'function' ? deps.connectionsKey(scope.workspaceId) : deps.connectionsKey
  const cleanup = await cleanupOnUninstall(deps.exec as never, scope, { key, contributions: contributed })
  log().info(`uninstalled ${scope.extensionId} in ${scope.workspaceId}: ${cleanup.connections} connection(s) revoked, ${cleanup.jobs} queued job(s) cancelled`)
  deps.bus?.emit({
    id: randomUUID(), type: 'extension.uninstalled', workspaceId: scope.workspaceId, timestamp: new Date().toISOString(),
    actorId: null, actorType: null, source: 'admin',
    payload: { extensionId: scope.extensionId, ...cleanup },
  } as never)
  return { retired: true, cleanup }
}

export interface UpgradeResult {
  ok: boolean
  plan: UpgradePlan
  /** Migrations that ran in this call. */
  applied: string[]
  /** Which step failed, and how; null on success. */
  failed: { step: 'plan' | 'migrations' | 'onUpgrade'; error: string } | null
  /** The version the row carries after this call. */
  version: string | null
  /** Whether the scope's runtime is running after this call. */
  running: boolean
  message: string
}

/**
 * UPGRADE one scope to the registered version. Steps, in order, each
 * gated on the one before: plan → stop the scope's runtime → pending
 * migrations → onUpgrade → record version → restore state.
 */
export async function upgradeExtension(deps: LifecycleDeps, scope: Scope): Promise<UpgradeResult> {
  const manifest = deps.manifest(scope.extensionId)
  const label = `${scope.extensionId} in ${scope.workspaceId}`
  const row = await readInstall(deps.exec, scope)
  if (!manifest) {
    const plan: UpgradePlan = { ok: false, noop: false, from: row?.version ?? null, to: '?', refusals: ['its code is not loaded in this process'], pendingMigrations: [], options: {} }
    return { ok: false, plan, applied: [], failed: { step: 'plan', error: plan.refusals[0]! }, version: row?.version ?? null, running: false, message: `${label}: ${plan.refusals[0]}` }
  }
  const declared = deps.migrations(scope.extensionId) ?? []
  const rows = await listInstalls(deps.exec, scope)
  const installed: Record<string, { version: string | null; enabled: boolean }> = {}
  for (const r of rows) if (r.state === 'installed') installed[r.extensionId] = { version: r.version, enabled: r.enabled }
  const manifests = deps.manifests()
  const caps = new Map<string, Availability | null>()
  for (const cap of manifest.requires?.capabilities ?? []) caps.set(cap, await deps.capability(cap))
  const migrationPlan = planExtensionMigrations(declared, await readExtensionMigrationLedger(deps.exec, scope))
  const plan = planExtensionUpgrade({
    row, manifest, migrationPlan: { pending: migrationPlan.pending.map((m) => m.id), refusals: migrationPlan.refusals },
    installed, manifests, capability: (id) => caps.get(id) ?? null,
  })
  const wasRunning = (deps.host?.running(scope.extensionId) ?? []).some((r) => r.scope.workspaceId === scope.workspaceId)
  if (plan.noop) return { ok: true, plan, applied: [], failed: null, version: plan.to, running: wasRunning, message: `${label}: already at ${plan.to}; nothing to do` }
  if (!plan.ok) {
    return { ok: false, plan, applied: [], failed: { step: 'plan', error: plan.refusals.join('; ') }, version: row?.version ?? null, running: wasRunning, message: `${label}: upgrade to ${plan.to} refused. Nothing changed.\n${plan.refusals.map((r) => `  - ${r}`).join('\n')}` }
  }

  // STOP the scope's runtime before its schema and code semantics change.
  if (wasRunning) await deps.host?.stopScope(scope.extensionId, scope.workspaceId)

  const run = await runExtensionMigrations(deps.migrationDb(), { ...scope, extensionVersion: plan.to, migrations: declared })
  if (!run.ok) {
    deps.gate.invalidate()
    await deps.host?.reconcile(scope.extensionId)   // schema-pending: the gate keeps it stopped
    return { ok: false, plan, applied: run.applied, failed: { step: 'migrations', error: run.failed?.error ?? run.message }, version: row!.version, running: false, message: `${label}: upgrade to ${plan.to} stopped at its migrations; the row stays at ${row!.version ?? 'unknown'}.\n${run.message}` }
  }

  const server = deps.server(scope.extensionId)
  if (typeof server?.onUpgrade === 'function') {
    try {
      await server.onUpgrade(await deps.buildCtx(scope.extensionId, scope.workspaceId), { from: plan.from, to: plan.to })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log().error(`extension '${scope.extensionId}' onUpgrade ${plan.from ?? '?'} -> ${plan.to} failed in ${scope.workspaceId}`, e instanceof Error ? e : new Error(error))
      deps.gate.invalidate()
      await deps.host?.reconcile(scope.extensionId)
      return { ok: false, plan, applied: run.applied, failed: { step: 'onUpgrade', error }, version: row!.version, running: (deps.host?.running(scope.extensionId) ?? []).some((r) => r.scope.workspaceId === scope.workspaceId), message: `${label}: migrations applied (${run.applied.join(', ') || 'none pending'}) but onUpgrade failed: ${error}. The row stays at ${row!.version ?? 'unknown'}; run the upgrade again once fixed - the migrations will not rerun.` }
    }
  }

  await recordInstalledVersion(deps.exec, scope, plan.to, true)
  deps.gate.invalidate()
  await deps.host?.reconcile(scope.extensionId)
  const running = (deps.host?.running(scope.extensionId) ?? []).some((r) => r.scope.workspaceId === scope.workspaceId)
  return { ok: true, plan, applied: run.applied, failed: null, version: plan.to, running, message: `${label}: upgraded ${plan.from ?? 'unknown'} -> ${plan.to}${run.applied.length > 0 ? ` (${run.applied.length} migration${run.applied.length === 1 ? '' : 's'}: ${run.applied.join(', ')})` : ''}${row!.enabled ? '' : '; it stays disabled here'}` }
}
