/**
 * File Name: extension-install.ts
 * Purpose: Implements the `tangen extension install` command, which registers a built-in
 *   extension into a workspace by inserting a row into `workspace_installed_apps`.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires `@tangen/db` (Drizzle ORM) and `@tangen/types` for the
 *   built-in extension registry; idempotent — re-running on an already-installed extension is a no-op.
 */
import { deploymentRoleRefusal } from '@tangen/types'
import { resolveDeploymentDatabase, deploymentRole, type DeploymentDatabase } from '../deployment-database'
import { randomBytes } from 'node:crypto'
import { importManifestEntry, resolveManifestFile } from '../extension-entry'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { existsSync } from 'node:fs'
import { configuredExtensions } from '@tangen/types'
import type { TangenExtensionManifest, TangenConfig } from '@tangen/types'
import { assertExtensionManifest } from '@tangen/types'
import { runExtensionMigrations, migrationDbFromDrizzle, validateDeclaredMigrations, type DeclaredMigration } from '@tangen/db'

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Looks up an extension by ID in the built-in registry and returns its manifest.
 * Throws with a human-readable error listing available extensions if not found.
 * @param extensionId - The extension identifier to look up (e.g. `seo`)
 * @returns The matching `TangenExtensionManifest`
 */
export function validateInstallableExtension(
  extensionId: string,
  available: TangenExtensionManifest[],
): TangenExtensionManifest {
  const manifest = available.find((e) => e.id === extensionId)
  if (!manifest) {
    const ids = available.map((e) => e.id).join(', ') || '(none configured)'
    throw new Error(
      `Extension '${extensionId}' is not configured in app/config/extensions.ts. Configured: ${ids}\n`
      + `  Add its package to the project (bun add @tangen/ext-${extensionId}) and run this again - install declares it for you - or declare its path in app/config/extensions.ts.`,
    )
  }
  // The manifest v1 contract: the CLI refuses what the loader would skip.
  assertExtensionManifest(manifest, extensionId)
  return manifest
}

/**
 * Resolves the extensions configured for a project (config.extensions /
 * plugins resolve entries) into their manifests — the CLI-side mirror of the
 * API loader's resolution. Relative paths are tried against config/, the app
 * dir, and the project root.
 */
/**
 * Everything a `tangen extension install|uninstall|list` needs about the
 * project, resolved the way push and doctor resolve it: the thin
 * tangen.config.ts merged with the workspace config, so the
 * `plugins` registry on the workspace config is where extension entries
 * live, and the workspace id is the config's, never the directory-name guess.
 */
export async function loadExtensionCommandContext(
  configCwd: string,
  fallbackWorkspaceId: string,
  opts: { workspaceSlug?: string } = {},
): Promise<{
  config: TangenConfig
  /** The deployment's database (DATABASE_URL). */
  database: DeploymentDatabase
  workspaceId: string
  available: Array<TangenExtensionManifest & { __dir?: string }>
}> {
  const { resolveEffectiveConfig } = await import('./push-config')
  const mod = await import(resolvePath(configCwd, 'tangen.config.ts'))
  const config = await resolveEffectiveConfig(configCwd, mod.default as TangenConfig)
  const database = resolveDeploymentDatabase()
  const masterId = config.workspaceId ?? fallbackWorkspaceId
  if (!opts.workspaceSlug) {
    return { config, database, workspaceId: masterId, available: await loadConfigExtensions(config as never, configCwd) }
  }
  // `--workspace <slug>` (the user, 2026-09-12): the command acts on that
  // registered workspace, and sees the extensions IT can install - the
  // master's declarations minus its exclusions, then its own - the way the
  // server assembles a child (workspace-loader mergeDeclaredExtensions).
  const target = await resolveExtensionWorkspace(configCwd, opts.workspaceSlug)
  if (target.id === masterId) {
    return { config, database, workspaceId: masterId, available: await loadConfigExtensions(config as never, configCwd) }
  }
  const masterEntries = configuredExtensions(config as never).entries as Array<{ resolve?: string }>
  const entries = mergeWorkspaceExtensions(masterEntries, target.entries, target.excludeExtensions)
  return { config, database, workspaceId: target.id, available: await loadConfigExtensions({ extensions: entries }, configCwd) }
}

export interface ExtensionWorkspaceTarget {
  id: string
  slug: string
  master?: string
  /** The workspace's own declarations (its workspace.config.ts), if it has a config. */
  entries: Array<{ resolve?: string }>
  excludeExtensions: string[]
}

/** Master entries the child did not exclude, then the child's own - the server's rule. */
export function mergeWorkspaceExtensions<T extends { resolve?: string }>(
  masterEntries: T[],
  childEntries: T[],
  excludeExtensions: string[],
): T[] {
  const excluded = new Set(excludeExtensions)
  return [...masterEntries.filter((e) => !excluded.has(e.resolve ?? '')), ...childEntries]
}

/**
 * The workspace a `--workspace <slug>` names, from the registry
 * (app/workspaces/index.ts; the id is accepted too), with what its own
 * workspace.config.ts declares and excludes.
 */
export async function resolveExtensionWorkspace(configCwd: string, slugOrId: string): Promise<ExtensionWorkspaceTarget> {
  const registryPath = [join(configCwd, 'workspaces', 'index.ts'), join(configCwd, 'app', 'workspaces', 'index.ts')].find((p) => existsSync(p))
  if (!registryPath) throw new Error(`--workspace needs the workspace registry, and there is none at app/workspaces/index.ts (looked from ${configCwd})`)
  const mod = await import(registryPath)
  const definitions = ((mod.default ?? mod) as Array<{ id: string; slug: string; master?: string }>)
  const def = definitions.find((d) => d.slug === slugOrId) ?? definitions.find((d) => d.id === slugOrId)
  if (!def) throw new Error(`Workspace "${slugOrId}" is not in app/workspaces/index.ts. Registered: ${definitions.map((d) => d.slug).join(', ') || '(none)'}`)
  const configPath = join(dirname(registryPath), def.slug, 'workspace.config.ts')
  let entries: Array<{ resolve?: string }> = []
  let excludeExtensions: string[] = []
  if (existsSync(configPath)) {
    const cfg = await import(configPath)
    const child = (cfg.default ?? cfg) as { excludeExtensions?: string[] }
    entries = configuredExtensions(child as never).entries as Array<{ resolve?: string }>
    excludeExtensions = child.excludeExtensions ?? []
  }
  return { id: def.id, slug: def.slug, master: def.master, entries, excludeExtensions }
}

export type LoadedManifest = TangenExtensionManifest & { __dir?: string; __pkg?: string; __root?: string }

/**
 * `tangen extension install <id>` for an id the config does not declare yet:
 * when the project has the package `@tangen/ext-<id>` (the naming every
 * first-party extension follows), install declares it in
 * app/config/extensions.ts and goes on - one command, not two (the user,
 * 2026-09-12). Resolved from the PROJECT like every declaration. Returns null
 * when no such package is there; throws when the package's manifest carries
 * a different id, since declaring it would not make `<id>` installable.
 */
export async function declareExtensionFromPackage(
  configCwd: string,
  extensionId: string,
): Promise<{ spec: string; manifest: LoadedManifest; declared: boolean } | null> {
  const spec = `@tangen/ext-${extensionId}`
  let file: string
  try {
    file = resolveManifestFile(spec, configCwd)
  } catch {
    return null
  }
  const mod = await import(file)
  const manifest = (mod.default ?? mod) as TangenExtensionManifest
  if (manifest?.id !== extensionId) {
    throw new Error(`${spec} declares id '${manifest?.id}', not '${extensionId}'; declare it in app/config/extensions.ts and install it by that id.`)
  }
  const { registerExtensionInConfig } = await import('./extension-create')
  const declared = registerExtensionInConfig(join(configCwd, 'config', 'extensions.ts'), extensionId, spec)
  return { spec, manifest: { ...manifest, __pkg: spec, __root: dirname(file) }, declared }
}

export async function loadConfigExtensions(
  config: unknown,
  configCwd: string,
  opts: { onUnresolved?: (spec: string, error: Error) => void } = {},
): Promise<LoadedManifest[]> {
  // One reading, shared with the server (Phase 6C): `extensions` first, then
  // the deprecated `plugins` / `apps`.
  const entries = configuredExtensions(config as never).entries as Array<{ resolve?: string }>
  const out: LoadedManifest[] = []
  const report = opts.onUnresolved ?? ((spec: string, error: Error) => {
    console.warn(`extension '${spec}' is declared in app/config/extensions.ts but cannot be loaded from ${configCwd}: ${error.message}`)
  })
  for (const entry of entries) {
    const spec = entry.resolve ?? ''
    if (!spec) continue
    try {
      if (spec.startsWith('.')) {
        const candidates = [
          resolvePath(configCwd, 'config', spec),
          resolvePath(configCwd, spec),
          resolvePath(configCwd, '..', spec),
        ]
        const dir = candidates.find((c) => existsSync(join(c, 'tangen.extension.ts')))
        if (!dir) throw new Error(`no tangen.extension.ts at ${candidates.join(', ')}`)
        const mod = await import(join(dir, 'tangen.extension.ts'))
        const manifest = (mod.default ?? mod) as TangenExtensionManifest
        if (manifest?.id) out.push({ ...manifest, __dir: dir })
      } else {
        // Resolved from the PROJECT, not from wherever this CLI is installed:
        // the package is the project's dependency, and the CLI may sit
        // somewhere it is not visible from (the release dry run does exactly
        // that). The location is remembered so every later entry (migrations,
        // server, contentTypes) resolves from the same place (Stage G9, G7-3).
        const file = resolveManifestFile(spec, configCwd)
        const mod = await import(file)
        const manifest = (mod.default ?? mod) as TangenExtensionManifest
        if (manifest?.id) out.push({ ...manifest, __pkg: spec, __root: dirname(file) })
      }
    } catch (err) {
      report(spec, err instanceof Error ? err : new Error(String(err)))
    }
  }
  return out
}

export interface InstallRecord {
  id: string
  workspaceId: string
  extensionId: string
  options: Record<string, unknown>
}

/**
 * Creates an `InstallRecord` with a randomly generated unique ID ready for DB insertion.
 * @param extensionId - The extension to install
 * @param workspaceId - The target workspace
 * @returns A populated `InstallRecord` with a `wext_` prefixed hex ID
 */
export function buildInstallRecord(extensionId: string, workspaceId: string): InstallRecord {
  return {
    id: `wext_${randomBytes(8).toString('hex')}`,
    workspaceId,
    extensionId,
    options: {},
  }
}

// ── Command ───────────────────────────────────────────────────────────────────

/**
 * Installs a built-in extension into the given workspace database record (idempotent).
 * Validates the extension exists in the registry, checks for an existing installation,
 * and inserts a new `workspace_installed_apps` row if absent.
 * @param extensionId - The built-in extension ID to install
 * @param workspaceId - The workspace to install the extension into
 * @param databaseUrl - Postgres connection URL for the target database
 * @param log - Optional logger; defaults to `console.log`
 */
export async function runExtensionInstallCommand(
  extensionId: string,
  workspaceId: string,
  databaseUrl: string,
  available: TangenExtensionManifest[] = [],
  log: (msg: string) => void = console.log,
  opts: { db?: any; yes?: boolean; approveOptional?: readonly string[] | 'all' | 'none'; approveGrants?: readonly string[]; interactive?: boolean; ask?: (q: string, d: boolean) => Promise<boolean>; projectRoot?: string; policy?: import('@tangen/types').GrantPolicy | null } = {},
): Promise<void> {
  const manifest = validateInstallableExtension(extensionId, available) as TangenExtensionManifest & { __dir?: string; __pkg?: string }
  // The manifest's deployment-role policy: a developer tool never installs into production.
  const policy = deploymentRoleRefusal(manifest, deploymentRole())
  if (policy) throw new Error(policy)
  // K5.2b: the grant review - rendered, decided, and recorded on the installation below.
  const { reviewAndDecide, loadGrantPolicy } = await import('./extension-review')
  const grantPolicy = opts.policy !== undefined ? opts.policy : opts.projectRoot ? await loadGrantPolicy(opts.projectRoot) : null
  const approval = await reviewAndDecide(manifest, { log, verb: 'install' }, { yes: opts.yes, approveOptional: opts.approveOptional, approveGrants: opts.approveGrants, interactive: opts.interactive, ask: opts.ask, policy: grantPolicy })

  const { createDb, workspaceInstalledApps } = await import('@tangen/db')
  const { eq, and } = await import('drizzle-orm')

  const db = opts.db ?? createDb(databaseUrl)

  // A1: a pack that claims a provider another ACTIVE pack already owns is
  // refused here, while the incumbent still works. The runtime rule withholds
  // both, which is deterministic but would break a working connection - so
  // the interactive path never lets it get that far.
  {
    const { providerPreflight } = await import('./extension-lifecycle')
    const clash = await providerPreflight({ db, workspaceId, available: available as never[], log }, extensionId, manifest as never)
    if (clash) throw new Error(clash)
  }

  try {
    // INSTALL is per workspace: a retired row (a previous uninstall) is
    // adopted back; an installed one is left alone.
    const [existing] = await db
      .select({ id: workspaceInstalledApps.id, state: workspaceInstalledApps.state })
      .from(workspaceInstalledApps)
      .where(
        and(
          eq(workspaceInstalledApps.workspaceId, workspaceId),
          eq(workspaceInstalledApps.appId, extensionId),
        ),
      )
      .limit(1)

    if (existing?.state === 'installed') {
      log(`[tangen] Extension '${extensionId}' is already installed in workspace '${workspaceId}'`)
      return
    }

    const record = buildInstallRecord(extensionId, workspaceId)
    if (existing) {
      await db.update(workspaceInstalledApps)
        .set({ state: 'installed', enabled: true, version: manifest.version, options: record.options, installedAt: new Date(), uninstalledAt: null })
        .where(eq(workspaceInstalledApps.id, existing.id))
    } else {
      await db.insert(workspaceInstalledApps).values({
        id: record.id,
        workspaceId: record.workspaceId,
        appId: record.extensionId,
        options: record.options,
        state: 'installed',
        enabled: true,
        version: manifest.version,
      })
    }
    // K5.2b: the approval, recorded in its own statement - a database whose
    // migration has not run (or a hand-built table) still installs an
    // extension that declares no grants, exactly as before.
    if (approval.granted) {
      const { installExecFromDb, recordGrantedGrants } = await import('@tangen/db')
      await recordGrantedGrants(installExecFromDb(db), { workspaceId, extensionId }, approval.granted)
    }

    // INSTALL runs the declared migrations for this scope, ledgered; a
    // failure rolls the install back and the ledger keeps the failed row.
    if (manifest.migrations) {
      const mod = await importManifestEntry(manifest, manifest.migrations, 'migrations')
      const declared = ((mod?.default ?? mod) ?? []) as DeclaredMigration[]
      const problems = validateDeclaredMigrations(declared)
      if (problems.length > 0) throw new Error(`Extension '${extensionId}' declares invalid migrations: ${problems.join('; ')}`)
      const run = await runExtensionMigrations(migrationDbFromDrizzle(db), { workspaceId, extensionId, extensionVersion: manifest.version, migrations: declared })
      for (const line of run.message.split('\n')) log(`[tangen]   ${line}`)
      if (!run.ok) {
        if (existing) {
          await db.update(workspaceInstalledApps).set({ state: 'uninstalled', enabled: false, uninstalledAt: new Date() }).where(eq(workspaceInstalledApps.id, existing.id))
        } else {
          await db.delete(workspaceInstalledApps).where(eq(workspaceInstalledApps.id, record.id))
        }
        throw new Error(`install of '${extensionId}' rolled back: its migrations did not apply`)
      }
    }

    // onInstall lifecycle — loaded from the manifest's server entry; a failing
    // hook rolls the install row back so a half-installed state never persists.
    if (manifest.server && manifest.__dir) {
      try {
        const mod = await import(join(manifest.__dir, manifest.server))
        const server = mod.default ?? mod
        if (typeof server?.onInstall === 'function') {
          await server.onInstall({ workspaceId })
          log(`[tangen]   onInstall hook completed`)
        }
      } catch (err) {
        // No half-installs: a fresh row is removed, an adopted tombstone is retired again.
        if (existing) {
          await db.update(workspaceInstalledApps).set({ state: 'uninstalled', enabled: false, uninstalledAt: new Date() }).where(eq(workspaceInstalledApps.id, existing.id))
        } else {
          await db.delete(workspaceInstalledApps).where(eq(workspaceInstalledApps.id, record.id))
        }
        throw new Error(`onInstall failed for '${extensionId}' - install rolled back: ${(err as Error).message}`)
      }
    }

    log(`[tangen] ✓ Installed ${manifest.name} (${extensionId}) into workspace '${workspaceId}'`)
    // K5.3: the lockfile - what this project installed and approved, a visible diff in a PR.
    if (opts.projectRoot) {
      const { writeLockEntry, manifestIntegrity } = await import('./extension-lock')
      writeLockEntry(opts.projectRoot, extensionId, { version: manifest.version, integrity: manifestIntegrity(manifest), grantedGrants: approval.granted })
      log(`[tangen] tangen.lock: ${extensionId}@${manifest.version} recorded`)
    }
  } finally {
    if (!opts.db) await db.end()
  }
}
