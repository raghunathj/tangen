/**
 * File Name: app-hooks-registry.ts
 * Purpose: Process-level registry of loaded extensions — manifests, content
 *          hooks, and install/uninstall lifecycle — populated once at boot
 *          from the workspace configs' resolved extensions
 *          (WorkspaceProject.extensions → manifest.server entries).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Replaces the retired compile-time extension registry.
 *          The registry is a module-level singleton — process-scoped, not
 *          per-request; per-workspace install state lives in
 *          workspace_installed_apps rows.
 */
import { join, dirname } from 'node:path'
import type {
  ContentHooks, TangenExtensionManifest, TangenExtensionServer, WorkspaceProject,
  FieldType, FieldTypeServerValidate, ExtensionCapabilityDef, ExtensionMigration,
} from '@tangen/types'
import { compileExtensionPermissions, shadowedAdminRoutePaths } from '@tangen/types'
import { validateDeclaredMigrations } from '@tangen/db'
import { registerPorterProvider, getPorterProvider, type PorterProvider } from '../services/porter-providers'
import { contributions } from '../kernel/contributions'
import { setCustomFieldTypeResolver } from '../services/field-validator'
import { getSiteFieldType } from '../services/site-field-types'

interface RegisteredExtension {
  manifest: TangenExtensionManifest
  /** The declared migrations (manifest `migrations` module), loaded at REGISTER, run only at INSTALL / UPGRADE. */
  migrations?: ExtensionMigration[]
  hooks?: ContentHooks
  lifecycle?: Pick<TangenExtensionServer, 'onInstall' | 'onUninstall'>
  mcpTools?: TangenExtensionServer['mcpTools']
  events?: TangenExtensionServer['events']
  tasks?: TangenExtensionServer['tasks']
  adminRoutes?: TangenExtensionServer['adminRoutes']
}

const _registry = new Map<string, RegisteredExtension>()

/**
 * The specifiers to try, in order, for one manifest entry of a PACKAGE
 * extension.
 *
 * `kind` matters. Until Stage G9 this always tried `<pkg>/server` first,
 * whichever entry was being loaded, so asking for migrations handed back the
 * server module - not an array - and the extension's declared migrations were
 * dropped with a warning (finding G7-3). Tables that worked for an in-project
 * extension silently never appeared for a published one.
 *
 * So: the conventional export for THIS kind, then the manifest's own declared
 * path. Both are shapes a published package already ships; nothing here asks
 * an author to republish.
 */
export function packageSubpathCandidates(pkg: string, declared: string, kind: 'server' | 'migrations'): string[] {
  const out = [`${pkg}/${kind}`]
  const subpath = (declared ?? '').replace(/^\.\//, '')
  if (subpath) out.push(`${pkg}/${subpath}`)
  return out
}

/** Where an npm extension's files live, for a built Admin bundle; null when the package cannot be located from here. */
function packageFile(pkg: string, rel: string): string | null {
  try { return join(dirname(Bun.resolveSync(`${pkg}/package.json`, process.cwd())), rel) } catch { return null }
}

const uiBundles = new Map<string, string>()
/** The absolute path of an extension's built Admin bundle (manifest `ui`), registered at load (Extension Kernel K7.3). */
export function registerExtensionUiBundle(extensionId: string, absolutePath: string): void { uiBundles.set(extensionId, absolutePath) }
export function extensionUiBundlePath(extensionId: string): string | null { return uiBundles.get(extensionId) ?? null }

async function importFromPackage(pkg: string, declared: string, kind: 'server' | 'migrations'): Promise<any> {
  const candidates = packageSubpathCandidates(pkg, declared, kind)
  let last: unknown
  for (const spec of candidates) {
    try { return await import(spec) } catch (e) { last = e }
  }
  throw last instanceof Error ? last : new Error(`cannot resolve ${candidates.join(' or ')}`)
}

/**
 * Loads every resolved extension's server entry (manifest.server) and
 * registers manifests + hooks + lifecycle. Called once at startup after the
 * workspace configs load; safe to call again on dev reload (replaces entries).
 */
export async function loadExtensionServers(projects: WorkspaceProject[]): Promise<void> {
  const seen = new Set<string>()
  for (const project of projects) {
    for (const ext of project.extensions ?? []) {
      if (seen.has(ext.id)) continue
      seen.add(ext.id)

      const entry: RegisteredExtension = { manifest: ext.manifest }
      // K7.3: the built Admin bundle, if the manifest names one, from where the extension lives.
      if (typeof ext.manifest.ui === 'string' && ext.manifest.ui) {
        const bundle = ext.dir ? join(ext.dir, ext.manifest.ui) : packageFile(ext.pkg ?? ext.id, ext.manifest.ui)
        if (bundle) registerExtensionUiBundle(ext.manifest.id, bundle)
      }
      if (ext.manifest.migrations) {
        try {
          const mod = ext.dir
            ? await import(join(ext.dir, ext.manifest.migrations))
            : await importFromPackage(ext.pkg ?? ext.id, ext.manifest.migrations, 'migrations')
          const declared = (mod.default ?? mod) as ExtensionMigration[]
          const problems = validateDeclaredMigrations(declared)
          if (problems.length > 0) console.warn(`[extensions] '${ext.id}' migrations ignored: ${problems.join('; ')}`)
          else entry.migrations = declared
        } catch (err) {
          console.warn(`[extensions] '${ext.id}' migrations module failed to load: ${(err as Error).message}`)
        }
      }
      if (ext.manifest.server) {
        try {
          // Local dirs resolve on disk; npm extensions import through their
          // package specifier - './src/server.ts' maps to the './server'
          // export (falling back to the raw subpath for packages without an
          // exports entry). The extension ID is never a module specifier.
          const mod = ext.dir
            ? await import(join(ext.dir, ext.manifest.server))
            : await importFromPackage(ext.pkg ?? ext.id, ext.manifest.server, 'server')
          const server = (mod.default ?? mod) as TangenExtensionServer
          entry.hooks = server?.contentHooks
          entry.lifecycle = { onInstall: server?.onInstall, onUninstall: server?.onUninstall }
          entry.mcpTools = server?.mcpTools
          entry.events = server?.events
          entry.tasks = server?.tasks
          entry.adminRoutes = server?.adminRoutes
          // K7.1: core serves `<ext>/settings` itself for a manifest that
          // declares typed settings, so an extension's OWN route at that path
          // is unreachable. SEO shipped one and its Settings page read the
          // wrong payload for days (2026-09-20). Say so loudly rather than
          // shadowing in silence.
          for (const path of shadowedAdminRoutePaths(ext.manifest, server?.adminRoutes)) {
            console.warn(
              `[extensions] '${ext.id}' declares an admin route at '${path}', which core serves itself `
              + `because the manifest declares typed settings. That route is UNREACHABLE - rename it `
              + `(e.g. '${path === 'settings' ? 'site-settings' : `${path}-own`}') and update its callers.`,
            )
          }
          if (server) { _serverEntries.set(ext.id, server); registerContributedPorterProviders(ext.id, server) }
        } catch (err) {
          console.warn(`[extensions] '${ext.id}' server entry failed to load: ${(err as Error).message}`)
        }
      }
      _registry.set(ext.id, entry)
    }
  }
}

/** MCP tools an extension's server entry contributed (undefined when none). */
/** The migrations an extension declares; undefined when it declares none (or they failed to load). */
export function getExtensionMigrations(extensionId: string): ExtensionMigration[] | undefined {
  return _registry.get(extensionId)?.migrations
}

/** Test seam: declares manifest capabilities for a registered (or bare) extension id. */
export function setExtensionCapabilities(extensionId: string, capabilities: ExtensionCapabilityDef[] | undefined): void {
  const existing = _registry.get(extensionId)
  const manifest = { ...(existing?.manifest ?? { id: extensionId, name: extensionId, version: '0.0.0' }), capabilities } as TangenExtensionManifest
  _registry.set(extensionId, { ...(existing ?? {}), manifest })
}

/** Test seam: declares migrations for a registered (or bare) extension id. */
export function setExtensionMigrations(extensionId: string, migrations: ExtensionMigration[] | undefined): void {
  const existing = _registry.get(extensionId)
  _registry.set(extensionId, { ...(existing ?? { manifest: { id: extensionId, name: extensionId, version: '0.0.0' } as TangenExtensionManifest }), migrations })
}

export function getExtensionMcpTools(extensionId: string): TangenExtensionServer['mcpTools'] {
  return _registry.get(extensionId)?.mcpTools
}

/** Registers (or replaces) a manifest directly (tests, programmatic extensions); the server entry, if any, is kept. */
export function registerExtensionManifest(manifest: TangenExtensionManifest): void {
  _generation++
  const existing = _registry.get(manifest.id)
  _registry.set(manifest.id, { ...(existing ?? { lifecycle: {} }), manifest } as never)
}

/** Registers a full server entry directly (tests, programmatic extensions). */
export function registerExtensionServer(extensionId: string, server: TangenExtensionServer): void {
  _generation++
  const existing = _registry.get(extensionId)
  _registry.set(extensionId, {
    manifest: existing?.manifest ?? ({ id: extensionId, name: extensionId, version: '0.0.0' } as TangenExtensionManifest),
    hooks: server.contentHooks ?? existing?.hooks,
    lifecycle: { onInstall: server.onInstall, onUninstall: server.onUninstall },
    mcpTools: server.mcpTools,
    events: server.events,
    tasks: server.tasks,
    adminRoutes: server.adminRoutes,
  })
  _serverEntries.set(extensionId, server)
  warnOnMalformedFlowOutput(extensionId, server)
  registerContributedPorterProviders(extensionId, server)
}

/**
 * Output metadata a contribution declares but the builder cannot read.
 *
 * The failure this catches used to be silent: an action declaring
 * `output: [{ path: … }]` - the spelling the public type named until Stage G5 -
 * registered without complaint and then simply never appeared in the token
 * picker. A warning is the right severity: the action itself works, and
 * refusing to register it would punish a caller for a metadata typo.
 */
/** A dot-path of identifiers: `leadId`, `lead.tier`, `response.status`. */
const OUTPUT_KEY = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/
const OUTPUT_TYPES = new Set(['string', 'number', 'boolean', 'json', 'array'])

/**
 * Checks a contributed action's declared output metadata, returning one
 * message per problem and an empty array when it is fine.
 *
 * This exists because the failure it catches was silent. A contribution could
 * declare `output: [{ path: 'leadId' }]` - the spelling the public type used
 * to name - register without complaint, and simply never appear in the
 * builder's token picker. Nothing failed; a feature just was not there.
 */
export function validateFlowOutputFields(
  extensionId: string,
  actionName: string,
  output: unknown,
): string[] {
  if (output === undefined || output === null) return []
  const where = `extension '${extensionId}' action '${actionName}'`
  if (!Array.isArray(output)) return [`${where}: \`output\` must be an array of { key, label?, type? }`]
  const problems: string[] = []
  for (const [i, raw] of output.entries()) {
    const f = raw as Record<string, unknown>
    if (!f || typeof f !== 'object') { problems.push(`${where}: output[${i}] must be an object`); continue }
    if (typeof f.key !== 'string' || !OUTPUT_KEY.test(f.key)) {
      problems.push(
        `${where}: output[${i}] needs a \`key\` that is a dot-path into the result`
        + (typeof (f as { path?: unknown }).path === 'string' ? ' - it declares `path`, which nothing reads' : '')
        + ` (got ${JSON.stringify(f.key ?? (f as { path?: unknown }).path)})`,
      )
    }
    if (f.type !== undefined && !OUTPUT_TYPES.has(String(f.type))) {
      problems.push(`${where}: output[${i}].type must be one of ${[...OUTPUT_TYPES].join(', ')} (got ${JSON.stringify(f.type)})`)
    }
  }
  return problems
}

function warnOnMalformedFlowOutput(extensionId: string, server: TangenExtensionServer): void {
  for (const action of (server as { flowActions?: Array<{ name?: unknown; output?: unknown }> }).flowActions ?? []) {
    for (const problem of validateFlowOutputFields(extensionId, String(action?.name ?? '?'), action?.output)) {
      console.warn(`[extensions] ${problem}`)
    }
  }
}

/**
 * Porter providers declared on the server entry (Unit 11) join the process
 * registry under the extension's id; the scope-level gate decides where
 * they are offered and run. A key another provider already holds is
 * refused, loudly: two extensions cannot share one.
 */
function registerContributedPorterProviders(extensionId: string, _server: TangenExtensionServer): void {
  // K2.2: `porter.providers@1` - the legacy key and the explicit `contributions` form alike.
  const provided = contributions<{ key: string }>('porter.providers@1', { activeIds: new Set([extensionId]) }).map((c) => c.item)
  for (const p of provided) {
    const existing = getPorterProvider(p.key)
    if (existing && existing.extensionId !== extensionId) {
      console.warn(`[extensions] '${extensionId}' porter provider '${p.key}' ignored: the key belongs to ${existing.extensionId ? `extension '${existing.extensionId}'` : 'the platform'}`)
      continue
    }
    registerPorterProvider({ ...(p as unknown as Omit<PorterProvider, 'extensionId'>), extensionId, contributed: true })
  }
}

/** Event subscriptions an extension's server entry contributed. */
export function getExtensionEvents(extensionId: string): TangenExtensionServer['events'] {
  return _registry.get(extensionId)?.events
}

/** Queue tasks an extension's server entry contributed. */
export function getExtensionTasks(extensionId: string): TangenExtensionServer['tasks'] {
  return _registry.get(extensionId)?.tasks
}

/**
 * The FULL server entry object for an extension — lets sibling extensions
 * read contribution conventions core doesn't know about (e.g. Flows reads
 * flowTriggers/flowActions). Core never interprets extra keys.
 */
const _serverEntries = new Map<string, TangenExtensionServer>()

export function setExtensionServerEntry(extensionId: string, server: TangenExtensionServer): void {
  _serverEntries.set(extensionId, server)
}

export function getExtensionServer(extensionId: string): TangenExtensionServer | undefined {
  return _serverEntries.get(extensionId)
}

/** Admin routes an extension's server entry contributed. */
export function getExtensionAdminRoutes(extensionId: string): TangenExtensionServer['adminRoutes'] {
  return _registry.get(extensionId)?.adminRoutes
}

/** Registers hooks directly (tests, programmatic extensions). */
export function registerExtensionHooks(extensionId: string, hooks: ContentHooks): void {
  const existing = _registry.get(extensionId)
  _registry.set(extensionId, {
    manifest: existing?.manifest ?? ({ id: extensionId, name: extensionId, version: '0.0.0' } as TangenExtensionManifest),
    lifecycle: existing?.lifecycle,
    hooks,
  })
}

/** The ContentHooks registered for an extension id, if any. */
export function getExtensionHooks(extensionId: string): ContentHooks | undefined {
  return _registry.get(extensionId)?.hooks
}

/** The loaded manifest for an extension id (from its resolve path). */
export function getExtensionManifest(extensionId: string): TangenExtensionManifest | undefined {
  return _registry.get(extensionId)?.manifest
}

/**
 * Whether ANY registered extension has content hooks. The hook runner asks the
 * database which extensions a workspace has installed and then consults this
 * registry for each; when no extension registered hooks at all, that query
 * cannot change the outcome and is one round trip per mutation for nothing.
 */
export function anyExtensionHasHooks(): boolean {
  for (const r of _registry.values()) if (r.hooks) return true
  return false
}

/** Whether ANY registered extension declares versioned data - same reasoning, for revision snapshots. */
export function anyExtensionHasVersionedData(): boolean {
  for (const r of _registry.values()) if (r.manifest?.versionedData) return true
  return false
}

/** A manifest capability def tagged with the extension that declared it, plus
 *  the grouping metadata compiled from `permissions.resources` (permission tree). */
export interface RegisteredExtensionCapability extends ExtensionCapabilityDef {
  extensionId: string
  /** Resource this capability belongs to (grouping); absent for raw caps. */
  resource?: string
  /** Action verb (grouping / icon). */
  action?: string
  /** Reveals sensitive data (banner cue). */
  sensitive?: boolean
}

/**
 * Every capability an extension makes available, tagged with the declaring
 * extension: the declarative `permissions.resources` compiled into
 * `<action>:<resource>` caps (with resource/action metadata and standard
 * implications), plus the raw `capabilities` list unchanged. Callers filter by
 * installed-ness per workspace — the registry is process-level.
 */
export function getExtensionCapabilities(): RegisteredExtensionCapability[] {
  const out: RegisteredExtensionCapability[] = []
  for (const [extensionId, entry] of _registry) {
    const compiled = compileExtensionPermissions(entry.manifest.permissions, entry.manifest.capabilities ?? [])
    for (const cap of compiled) out.push({ ...cap, extensionId } as RegisteredExtensionCapability)
  }
  return out
}

/**
 * Manifest `implies` inverted into IMPLIED_BY shape: map[implied] lists the
 * declaring capabilities whose holders also get `implied`. Consumed by
 * hasCapability/expandCapabilities (lib/member-access).
 */
export function extensionCapabilityImplications(): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const cap of getExtensionCapabilities()) {
    for (const implied of cap.implies ?? []) (map[implied] ??= []).push(cap.id)
  }
  return map
}

/** The install/uninstall lifecycle callbacks for an extension id. */
export function getExtensionLifecycle(
  extensionId: string,
): Pick<TangenExtensionServer, 'onInstall' | 'onUninstall'> | undefined {
  return _registry.get(extensionId)?.lifecycle
}

/** All extension ids currently registered. */
export function listRegisteredExtensionIds(): string[] {
  return [..._registry.keys()]
}

/** Every id with a server entry, whether or not a manifest registered it (tests, programmatic entries); registration order. */
export function listExtensionServerIds(): string[] {
  const ids = [..._registry.keys()]
  for (const id of _serverEntries.keys()) if (!ids.includes(id)) ids.push(id)
  return ids
}

let _generation = 0
/** Bumps on every registration and reset; the kernel's compiled chains key on it. */
export function registryGeneration(): number { return _generation }

const _resetHooks: Array<() => void> = []
/** Runs on every registry reset - the contribution registry withdraws with it (K2.1). */
export function onExtensionRegistryReset(fn: () => void): void {
  _resetHooks.push(fn)
}

/** Test helper — clears the registry. */
export function resetExtensionRegistry(): void {
  uiBundles.clear()
  _generation++
  _registry.clear()
  _serverEntries.clear()
  for (const fn of _resetHooks) fn()
}

/**
 * Resolves a custom field type name to the built-in primitive it inherits (from
 * the manifest's `fieldTypes[].inherits`, default `'text'`) plus its authoritative
 * server validator (from the server entry's `fieldTypes[name].validate`). Returns
 * undefined for built-in / unknown names. The field validator consults this for
 * every custom-typed field.
 */
/** ACTIVE in a scope, synchronously: true, false, or null when not yet known. Set by boot from the extension gate. */
let _activity: ((extensionId: string, workspaceId: string) => boolean | null) | null = null
/** K5.2a: the approval record for an installation, synchronously: undefined = scope unknown yet, null = not reviewed. Set by boot from the gate. */
let _grants: ((extensionId: string, workspaceId: string) => string[] | null | undefined) | null = null

export function setExtensionGrantsResolver(fn: ((extensionId: string, workspaceId: string) => string[] | null | undefined) | null): void {
  _grants = fn
}

export function recordedGrantsOf(extensionId: string, workspaceId: string): string[] | null | undefined {
  return _grants ? _grants(extensionId, workspaceId) : undefined
}

export function setExtensionActivity(fn: ((extensionId: string, workspaceId: string) => boolean | null) | null): void {
  _activity = fn
}

/**
 * The server side of a custom field type. With a scope, a field type whose
 * extension is not active there keeps its inherited primitive (storage and
 * baseline validation stay right) and loses the extension's `validate`: a
 * disabled extension's code does not run on a write.
 */
export function resolveCustomFieldType(
  name: string,
  scope?: { workspaceId: string},
): { inherits: FieldType; validate?: FieldTypeServerValidate } | undefined {
  for (const [extId, entry] of _registry) {
    const decl = entry.manifest.fieldTypes?.find((ft) => ft.name === name)
    if (!decl) continue
    const active = scope && _activity ? _activity(extId, scope.workspaceId) : null
    return {
      inherits: decl.inherits ?? 'text',
      validate: active === false ? undefined : _serverEntries.get(extId)?.fieldTypes?.[name]?.validate,
    }
  }
  // Fall back to a SITE-defined field type (app/fields/<name>/index.ts).
  const site = getSiteFieldType(name)
  if (site) {
    return {
      inherits: site.inherits ?? 'text',
      validate: site.validate ? (value) => site.validate!(value) : undefined,
    }
  }
  return undefined
}

// Wire the resolver into the (registry-agnostic) field validator once at load.
setCustomFieldTypeResolver(resolveCustomFieldType)

/** The resolver a write in one workspace x environment passes to validateFieldValues. */
export function customFieldTypeResolverFor(workspaceId: string) {
  return (name: string) => resolveCustomFieldType(name, { workspaceId })
}
