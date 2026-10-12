/**
 * File Name: extension-lifecycle.ts
 * Purpose: The CLI's extension lifecycle (closure plan Phase 4, Unit 12):
 *          `tangen extension enable | disable | upgrade | status`, per
 *          environment, over the same install-state writer, migration
 *          runner and plans the API uses. The CLI has no running registry,
 *          so a runtime capability an extension requires is reported as
 *          "checked at runtime" rather than guessed.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Every command takes an injected drizzle client so
 *          tests run it on PGlite; index.ts opens the environment's
 *          database and closes it. A disable or an upgrade refuses what
 *          the API refuses (dependants, downgrades, mismatched history);
 *          messages name the command that fixes it. Nothing here starts a
 *          runtime: a running server sees enable / disable within its
 *          gate's TTL and starts or stops the extension's resources at its
 *          next reconcile or boot (docs/architecture/extension-lifecycle.md).
 */
import { deploymentRoleRefusal, resolveDeploymentRole, type DeploymentRole, unavailableSettings, grantNames, providerOwnershipRefusal } from '@tangen/types'
import { join } from 'node:path'
import { importManifestEntry } from '../extension-entry'
import type { TangenExtensionManifest } from '@tangen/types'
import {
  resolveExtensionActivation, activeDependantsOf, planExtensionUpgrade, validateExtensionOptions, type ActivationMap,
} from '@tangen/types'
import {
  installExecFromDb, listInstalls, readInstall, setExtensionEnabled, recordInstalledVersion, recordGrantedGrants, listGrantedGrants,
  migrationDbFromDrizzle, planExtensionMigrations, runExtensionMigrations, readExtensionMigrationLedger, readScopeMigrationLedger, explainPendingSchema,
  validateDeclaredMigrations, type DeclaredMigration, type InstallExec, type LedgerRow,
} from '@tangen/db'

export type AvailableManifest = TangenExtensionManifest & { __dir?: string; __pkg?: string }
import { reviewAndDecide, renderGrantReview, loadGrantPolicy, type ReviewCliOptions } from './extension-review'
import { writeLockEntry, manifestIntegrity } from './extension-lock'
import { reviewGrants } from '@tangen/types'

export interface LifecycleCliDeps {
  /** A drizzle client for the deployment's database. */
  db: unknown
  workspaceId: string
  available: AvailableManifest[]
  /** The deployment role of this process; resolved from the process when omitted. */
  role?: DeploymentRole
  log?: (msg: string) => void
  /** The project root (`tangen.lock`, `tangen.policy.ts`); omit to skip the lockfile and the policy. */
  projectRoot?: string
}

/**
 * A1: the providers a manifest declares, and who already owns one. The
 * manifest is the source here on purpose - reading the server entry would mean
 * running a pack's code to decide whether it may be enabled.
 */
function declaredProviders(m: AvailableManifest | undefined): string[] {
  const declared = (m as { connectors?: Array<{ provider?: string; id?: string }> } | undefined)?.connectors ?? []
  return [...new Set(declared.map((c) => c.provider ?? c.id).filter((p): p is string => typeof p === 'string' && p !== ''))]
}

/** Providers claimed by the packs that are installed AND enabled, excluding one. */
function claimedProviders(
  manifests: Record<string, AvailableManifest>,
  installed: Record<string, { version: string | null; enabled: boolean }>,
  except: string,
): Record<string, string> {
  const claimed: Record<string, string> = {}
  for (const [id, row] of Object.entries(installed)) {
    if (id === except || !row.enabled) continue
    for (const provider of declaredProviders(manifests[id])) claimed[provider] ??= id
  }
  return claimed
}

/** How many configured connections each provider has, so the refusal can say what it would cost. */
async function connectionCounts(exec: InstallExec, workspaceId: string, providers: readonly string[]): Promise<Record<string, number>> {
  if (providers.length === 0) return {}
  const counts: Record<string, number> = {}
  try {
    const rows = await exec(`SELECT connector_id, count(*)::int AS n FROM connections WHERE workspace_id = $1 GROUP BY connector_id`, [workspaceId])
    for (const r of rows as Array<{ connector_id?: string; n?: number }>) {
      const connectorId = /^ext:[^/]+\/(.+)$/.exec(String(r.connector_id ?? ''))?.[1] ?? ''
      for (const provider of providers) {
        if (connectorId === provider || connectorId.startsWith(`${provider}.`)) counts[provider] = (counts[provider] ?? 0) + Number(r.n ?? 0)
      }
    }
  } catch { /* a database without the table answers nothing, which is honest */ }
  return counts
}

/** The preflight, shared by enable and install: null, or the refusal to throw. */
export async function providerPreflight(deps: LifecycleCliDeps, extensionId: string, manifest: AvailableManifest | undefined): Promise<string | null> {
  const declares = declaredProviders(manifest)
  if (declares.length === 0) return null
  const exec = installExecFromDb(deps.db)
  const rows = await listInstalls(exec, { workspaceId: deps.workspaceId })
  const installed: Record<string, { version: string | null; enabled: boolean }> = {}
  for (const r of rows) if (r.state === 'installed') installed[r.extensionId] = { version: r.version, enabled: r.enabled }
  const manifests: Record<string, AvailableManifest> = {}
  for (const m of deps.available) manifests[m.id] = m
  const claimed = claimedProviders(manifests, installed, extensionId)
  const clashing = declares.filter((p) => claimed[p] && claimed[p] !== extensionId)
  return providerOwnershipRefusal({
    extensionId, declares, claimed,
    connections: await connectionCounts(exec, deps.workspaceId, clashing),
  })
}

async function declaredMigrations(m: AvailableManifest | undefined): Promise<DeclaredMigration[]> {
  if (!m?.migrations) return []
  const mod = await importManifestEntry(m, m.migrations, 'migrations')
  const declared = ((mod?.default ?? mod) ?? []) as DeclaredMigration[]
  const problems = validateDeclaredMigrations(declared)
  if (problems.length > 0) throw new Error(`Extension '${m.id}' declares invalid migrations: ${problems.join('; ')}`)
  return declared
}

/** The scope's activation as the CLI can know it: rows, manifests, schema; capabilities are a runtime fact. */
export async function scopeActivation(deps: LifecycleCliDeps): Promise<{ activation: ActivationMap; manifests: Record<string, AvailableManifest>; installed: Record<string, { version: string | null; enabled: boolean }> }> {
  const exec = installExecFromDb(deps.db)
  const rows = await listInstalls(exec, { workspaceId: deps.workspaceId })
  const installed: Record<string, { version: string | null; enabled: boolean }> = {}
  for (const r of rows) if (r.state === 'installed') installed[r.extensionId] = { version: r.version, enabled: r.enabled }
  const manifests: Record<string, AvailableManifest> = {}
  for (const m of deps.available) manifests[m.id] = m
  const ledger: Record<string, LedgerRow[]> = await readScopeMigrationLedger(exec, { workspaceId: deps.workspaceId }).catch(() => ({}))
  const schema = new Map<string, string | null>()
  for (const id of Object.keys(installed)) {
    const declared = await declaredMigrations(manifests[id]).catch(() => [])
    if (declared.length > 0) schema.set(id, explainPendingSchema(declared, ledger[id] ?? []))
  }
  const activation = resolveExtensionActivation({
    installed, manifests,
    // The CLI has no registry: a required capability is available as far as a database can tell.
    capability: () => ({ available: true }),
    schema: (id) => schema.get(id) ?? null,
  })
  return { activation, manifests, installed }
}

/** `tangen extension enable|disable <id>` */
export async function runExtensionEnableCommand(deps: LifecycleCliDeps, extensionId: string, enabled: boolean): Promise<void> {
  const log = deps.log ?? console.log
  const exec = installExecFromDb(deps.db)
  const scope = { workspaceId: deps.workspaceId, extensionId }
  const row = await readInstall(exec, scope)
  if (!row || row.state !== 'installed') {
    throw new Error(`Extension '${extensionId}' is not installed${row ? ' (uninstalled; install it again to adopt its data)' : ''}. Install it first: tangen extension install ${extensionId}`)
  }
  if (enabled) {
    const policy = deploymentRoleRefusal(deps.available.find((m) => m.id === extensionId), deps.role ?? resolveDeploymentRole(process.env))
    if (policy) throw new Error(policy)
    // A1: refuse before the damage. The runtime conflict rule is deterministic
    // but blunt - it withholds BOTH packs - so an interactive path says no
    // while the incumbent is still working.
    const clash = await providerPreflight(deps, extensionId, deps.available.find((m) => m.id === extensionId))
    if (clash) throw new Error(clash)
  }
  if (!enabled) {
    const { activation, manifests } = await scopeActivation(deps)
    const blocking = activeDependantsOf(extensionId, manifests, activation)
    if (blocking.length > 0) throw new Error(`'${extensionId}' cannot be disabled: ${blocking.map((d) => `'${d}'`).join(', ')} require${blocking.length === 1 ? 's' : ''} it. Disable ${blocking.length === 1 ? 'it' : 'them'} first.`)
  }
  if (row.enabled === enabled) { log(`[tangen] Extension '${extensionId}' is already ${enabled ? 'enabled' : 'disabled'}`); return }
  await setExtensionEnabled(exec, scope, enabled)
  log(`[tangen] ✓ ${enabled ? 'Enabled' : 'Disabled'} ${extensionId}; a running server follows within its gate's TTL (runtime resources at its next reconcile or boot)`)
}

export interface UpgradeCliOptions extends ReviewCliOptions { planOnly?: boolean }

/** `tangen extension upgrade <id> [--plan]` */
export async function runExtensionUpgradeCommand(deps: LifecycleCliDeps, extensionId: string, opts: UpgradeCliOptions = {}): Promise<void> {
  const log = deps.log ?? console.log
  const exec: InstallExec = installExecFromDb(deps.db)
  const manifest = deps.available.find((m) => m.id === extensionId)
  if (!manifest) throw new Error(`Extension '${extensionId}' is not configured in this project (configured: ${deps.available.map((m) => m.id).join(', ') || 'none'})`)
  const scope = { workspaceId: deps.workspaceId, extensionId }
  const row = await readInstall(exec, scope)
  const declared = await declaredMigrations(manifest)
  const ledger = await readExtensionMigrationLedger(exec, scope)
  const migrationPlan = planExtensionMigrations(declared, ledger)
  const { installed, manifests } = await scopeActivation(deps)
  const plan = planExtensionUpgrade({
    row, manifest, migrationPlan: { pending: migrationPlan.pending.map((m) => m.id), refusals: migrationPlan.refusals },
    installed, manifests, capability: () => ({ available: true }),
  })
  if (plan.noop) {
    // E.15: an explicit grant decision on the current version is a RE-REVIEW, not a no-op - it is how an
    // optional grant gets approved (or revoked) after install, and what the Admin, status and Doctor recommend.
    if (opts.approveOptional !== undefined || opts.approveGrants !== undefined) {
      const recordedNow = (await listGrantedGrants(exec, scope))[extensionId] ?? null
      const policyNow = opts.policy !== undefined ? opts.policy : deps.projectRoot ? await loadGrantPolicy(deps.projectRoot) : null
      const decision = await reviewAndDecide(manifest, { previouslyGranted: recordedNow ?? (manifest.grants ? [] : null), log, verb: 'upgrade' }, { yes: opts.yes, approveOptional: opts.approveOptional, approveGrants: opts.approveGrants, interactive: opts.interactive, ask: opts.ask, policy: policyNow })
      if (opts.planOnly) { log(`[tangen]   dry run - nothing changed.`); return }
      if (decision.granted) await recordGrantedGrants(exec, scope, decision.granted)
      if (deps.projectRoot && decision.granted) {
        writeLockEntry(deps.projectRoot, extensionId, { version: plan.to, integrity: manifestIntegrity(manifest), grantedGrants: decision.granted })
        log(`[tangen] tangen.lock: ${extensionId}@${plan.to} recorded`)
      }
      log(`[tangen] ✓ Re-reviewed ${extensionId} at ${plan.to}: the recorded permissions are what this run approved`)
      return
    }
    log(`[tangen] ${extensionId}: already at ${plan.to}; nothing to do`)
    return
  }
  if (!plan.ok) throw new Error(`upgrade of '${extensionId}' to ${plan.to} refused. Nothing changed.\n${plan.refusals.map((r) => `  - ${r}`).join('\n')}`)
  // K5.2b: re-review against what this installation recorded - a new REQUIRED grant blocks activation until approved.
  const recorded = (await listGrantedGrants(exec, scope))[extensionId] ?? null
  const grantPolicy = opts.policy !== undefined ? opts.policy : deps.projectRoot ? await loadGrantPolicy(deps.projectRoot) : null
  const approval = await reviewAndDecide(manifest, { previouslyGranted: recorded ?? (manifest.grants ? [] : null), log, verb: 'upgrade' }, { yes: opts.yes, approveOptional: opts.approveOptional, approveGrants: opts.approveGrants, interactive: opts.interactive, ask: opts.ask, policy: grantPolicy })
  if (opts.planOnly) {
    log(`[tangen] ${extensionId}: ${plan.from ?? 'unknown'} -> ${plan.to}`)
    log(`[tangen]   migrations pending: ${plan.pendingMigrations.length > 0 ? plan.pendingMigrations.join(', ') : 'none'}`)
    log(`[tangen]   dry run - nothing changed.`)
    return
  }
  const run = await runExtensionMigrations(migrationDbFromDrizzle(deps.db), { ...scope, extensionVersion: plan.to, migrations: declared })
  for (const line of run.message.split('\n')) log(`[tangen]   ${line}`)
  if (!run.ok) throw new Error(`upgrade of '${extensionId}' stopped at its migrations; the row stays at ${row!.version ?? 'unknown'}. Fix the migration and run the upgrade again.`)
  // The approval is recorded with the version: what this version was granted.
  if (approval.granted) await recordGrantedGrants(exec, scope, approval.granted)
  if (manifest.server && manifest.__dir) {
    const mod = await import(join(manifest.__dir, manifest.server))
    const server = mod.default ?? mod
    if (typeof server?.onUpgrade === 'function') {
      try {
        await server.onUpgrade({ extensionId, workspaceId: deps.workspaceId, options: row!.options, log: (m: string) => log(`[${extensionId}] ${m}`) }, { from: plan.from, to: plan.to })
        log(`[tangen]   onUpgrade hook completed`)
      } catch (err) {
        throw new Error(`migrations applied but onUpgrade of '${extensionId}' failed: ${(err as Error).message}. The row stays at ${row!.version ?? 'unknown'}; run the upgrade again once fixed - the migrations will not rerun.`)
      }
    }
  }
  await recordInstalledVersion(exec, scope, plan.to, true)
  // K5.3: the lockfile follows the version and the approval.
  if (deps.projectRoot) {
    writeLockEntry(deps.projectRoot, extensionId, { version: plan.to, integrity: manifestIntegrity(manifest), grantedGrants: approval.granted })
    log(`[tangen] tangen.lock: ${extensionId}@${plan.to} recorded`)
  }
  log(`[tangen] ✓ Upgraded ${extensionId}: ${plan.from ?? 'unknown'} -> ${plan.to}${row!.enabled ? '' : ' (stays disabled)'}`)
}

export interface StatusLine {
  id: string
  name: string
  codeVersion: string | null
  installedVersion: string | null
  state: 'installed' | 'uninstalled' | 'not-installed'
  enabled: boolean
  active: boolean
  reason: string | null
  pendingMigrations: number
  requiresCapabilities: string[]
  optionsProblems: string[]
  /** E.15: settings disabled because the grant they require was not approved for this installation. */
  settingsUnavailable: Array<{ key: string; grant: string }>
}

/** The status of every configured or installed extension in this workspace. */
/** The grants an installation runs with: recorded ∩ declared (required or optional), else the manifest's required (E.14: never everything). */
function effectiveGrantsOf(m: { grants?: { required?: unknown[]; optional?: unknown[] } }, recorded: readonly string[] | null): string[] {
  const required = grantNames((m.grants?.required ?? []) as never)
  if (!Array.isArray(recorded)) return required
  const declared = new Set([...required, ...grantNames((m.grants?.optional ?? []) as never)])
  return recorded.filter((g) => declared.has(g))
}

export async function extensionStatus(deps: LifecycleCliDeps): Promise<StatusLine[]> {
  const exec = installExecFromDb(deps.db)
  const rows = await listInstalls(exec, { workspaceId: deps.workspaceId })
  const { activation, manifests } = await scopeActivation(deps)
  const ledger: Record<string, LedgerRow[]> = await readScopeMigrationLedger(exec, { workspaceId: deps.workspaceId }).catch(() => ({}))
  const recordedAll = await listGrantedGrants(exec, { workspaceId: deps.workspaceId }).catch(() => ({} as Record<string, string[] | null>))
  const ids = [...new Set([...Object.keys(manifests), ...rows.map((r) => r.extensionId)])].sort()
  const out: StatusLine[] = []
  for (const id of ids) {
    const m = manifests[id]
    const row = rows.find((r) => r.extensionId === id) ?? null
    const declared = await declaredMigrations(m).catch(() => [])
    const pending = declared.length > 0 ? planExtensionMigrations(declared, ledger[id] ?? []).pending.length : 0
    const a = activation[id]
    out.push({
      id, name: m?.name ?? id, codeVersion: m?.version ?? null, installedVersion: row?.version ?? null,
      state: row ? (row.state === 'installed' ? 'installed' : 'uninstalled') : 'not-installed',
      enabled: row?.state === 'installed' && row.enabled,
      active: a?.active === true, reason: a?.reason ?? (row ? null : 'not installed here'),
      pendingMigrations: pending,
      requiresCapabilities: m?.requires?.capabilities ?? [],
      optionsProblems: m && row?.state === 'installed' ? validateExtensionOptions(m, row.options).errors.map((e) => `${e.path}: ${e.message}`) : [],
      settingsUnavailable: m && row?.state === 'installed' ? unavailableSettings(m.settings, effectiveGrantsOf(m, recordedAll[id] ?? null)) : [],
    })
  }
  return out
}

/** `tangen extension status [--json]` */
export async function runExtensionStatusCommand(deps: LifecycleCliDeps, opts: { json?: boolean } = {}): Promise<void> {
  const log = deps.log ?? console.log
  const lines = await extensionStatus(deps)
  if (opts.json) { log(JSON.stringify({ workspaceId: deps.workspaceId, extensions: lines }, null, 2)); return }
  log(`[tangen] Extensions of workspace '${deps.workspaceId}':`)
  for (const l of lines) {
    const version = l.installedVersion && l.codeVersion && l.installedVersion !== l.codeVersion ? `${l.installedVersion} -> ${l.codeVersion} (upgrade available)` : l.installedVersion ?? l.codeVersion ?? '?'
    const status = l.state === 'not-installed' ? 'not installed' : l.state === 'uninstalled' ? 'uninstalled (data retained)' : l.active ? 'active' : `${l.enabled ? 'enabled' : 'disabled'}${l.reason ? `: ${l.reason}` : ''}`
    log(`  ${l.id.padEnd(18)} ${version.padEnd(34)} ${status}`)
    if (l.pendingMigrations > 0) log(`  ${''.padEnd(18)} ${''.padEnd(34)} ${l.pendingMigrations} migration${l.pendingMigrations === 1 ? '' : 's'} pending - tangen extension upgrade ${l.id}`)
    if (l.requiresCapabilities.length > 0) log(`  ${''.padEnd(18)} ${''.padEnd(34)} requires ${l.requiresCapabilities.join(', ')} (checked at runtime)`)
    for (const p of l.optionsProblems) log(`  ${''.padEnd(18)} ${''.padEnd(34)} options: ${p}`)
    for (const u of l.settingsUnavailable) log(`  ${''.padEnd(18)} ${''.padEnd(34)} setting ${u.key} needs ${u.grant} (optional grant not approved) - tangen extension upgrade ${l.id} --approve-optional ${u.grant}`)
  }
}

/** `tangen extension inspect <id>`: the manifest overview, what it provides and requires, and the grant review against what this workspace recorded. */
export async function runExtensionInspectCommand(deps: LifecycleCliDeps, extensionId: string): Promise<void> {
  const log = deps.log ?? console.log
  const manifest = deps.available.find((m) => m.id === extensionId)
  if (!manifest) throw new Error(`Extension '${extensionId}' is not configured in this project (configured: ${deps.available.map((m) => m.id).join(', ') || 'none'})`)
  const exec: InstallExec = installExecFromDb(deps.db)
  const scope = { workspaceId: deps.workspaceId, extensionId }
  const row = await readInstall(exec, scope)
  const recorded = row ? ((await listGrantedGrants(exec, scope))[extensionId] ?? null) : null
  log(`[tangen] ${manifest.name} (${manifest.id}) ${manifest.version}${manifest.__pkg ? `    Package: ${manifest.__pkg}` : manifest.__dir ? '    From: the project' : ''}`)
  log(`[tangen]   installed: ${row?.state === 'installed' ? `${row.version ?? 'unknown'}${row.enabled ? '' : ' (disabled)'}` : 'no'}`)
  if (manifest.description) log(`[tangen]   ${manifest.description}`)
  const req = manifest.requires
  if (req?.capabilities?.length) log(`[tangen]   requires capabilities: ${req.capabilities.join(', ')}`)
  if (req?.extensions?.length) log(`[tangen]   requires extensions: ${req.extensions.map((d) => (typeof d === 'string' ? d : `${d.id}${d.version ? `@${d.version}` : ''}`)).join(', ')}`)
  if (req?.services?.length) log(`[tangen]   requires services: ${req.services.join(', ')}`)
  if (manifest.optional?.services?.length) log(`[tangen]   optional services: ${manifest.optional.services.join(', ')}`)
  if (manifest.provides?.services?.length) log(`[tangen]   provides services: ${manifest.provides.services.join(', ')}`)
  for (const u of unavailableSettings(manifest.settings, effectiveGrantsOf(manifest as never, recorded))) log(`[tangen]   setting ${u.key} is unavailable: needs ${u.grant} (optional grant not approved) - tangen extension upgrade ${extensionId} --approve-optional ${u.grant}`)
  const server = manifest.server ? ' server' : ''
  const parts = [manifest.pages?.length ? `${manifest.pages.length} page${manifest.pages.length === 1 ? '' : 's'}` : '', manifest.sidebarPanels?.length ? `${manifest.sidebarPanels.length} panel${manifest.sidebarPanels.length === 1 ? '' : 's'}` : '', manifest.contentTypes ? 'content types' : '', manifest.migrations ? 'migrations' : ''].filter(Boolean)
  if (parts.length || server) log(`[tangen]   contributes:${server}${parts.length ? ` ${parts.join(', ')}` : ''}`)
  log('[tangen]')
  const review = reviewGrants(manifest, { trust: manifest.__pkg && !manifest.__pkg.startsWith('@tangen/') ? 'marketplace' : 'trusted', ...(recorded ? { previouslyGranted: recorded } : {}) })
  const status: Record<string, 'granted' | 'denied'> = {}
  if (recorded) for (const g of [...review.required, ...review.optional]) status[g.grant] = recorded.includes(g.grant) ? 'granted' : 'denied'
  for (const line of renderGrantReview(review, { publisher: manifest.__pkg, status, connectors: (manifest as { connectors?: never[] }).connectors, kind: (manifest as { kind?: 'extension' | 'connector-pack' }).kind })) log(`[tangen] ${line}`)
  if (row && !recorded && manifest.grants) log('[tangen] Not reviewed yet: this installation runs with the manifest\'s required grants. Re-run `tangen extension upgrade` to review.')
}
