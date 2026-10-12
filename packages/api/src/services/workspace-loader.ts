/**
 * File Name: workspace-loader.ts
 * Purpose: Discovers and loads all workspace projects from the app/ surface:
 *          workspaces/index.ts is the registry, each workspace lives in
 *          workspaces/<slug>/workspace.config.ts with optional per-workspace
 *          environments.ts overrides.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types; directory entries without a valid config are silently skipped
 */

import { existsSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import type { WorkspaceProject, WorkspaceConfig, TangenConfig, WorkspaceDefinition, TangenExtension, CustomRoute, ApiResourceDefinition, LoadedExtension, TangenExtensionManifest } from '@tangen/types'
import { configuredExtensions, extensionConfigNotice } from '@tangen/types'
import { validateExtensionManifest, formatManifestIssues } from '@tangen/types'
import { resolveSchemaComponentRefs, validateColumnNamespace } from '@tangen/schema'
import { assertNoOperatorOnlyOverrides } from '../gateway/operator-only'

/** Master entries the child did not exclude, then the child's own. */
function mergeDeclaredExtensions(
  masterEntries: TangenExtension[],
  childEntries: TangenExtension[],
  excludeExtensions: string[],
): TangenExtension[] {
  const excluded = new Set(excludeExtensions)
  const inherited = masterEntries.filter(e => !excluded.has(e.resolve ?? ''))
  return [...inherited, ...childEntries]
}

function mergeApiResources(
  masterResources: ApiResourceDefinition[],
  childResources: ApiResourceDefinition[],
): ApiResourceDefinition[] {
  // Dedupe by id — the child's declaration wins over the inherited one
  const childIds = new Set(childResources.map(r => r.id))
  return [...masterResources.filter(r => !childIds.has(r.id)), ...childResources]
}

function mergeRoutes(
  masterRoutes: CustomRoute[],
  childRoutes: CustomRoute[],
  excludeGroups: string[],
): CustomRoute[] {
  const excluded = new Set(excludeGroups)
  // Routes without a group are always inherited; grouped routes can be excluded
  const inherited = masterRoutes.filter(r => !r.group || !excluded.has(r.group))
  return [...inherited, ...childRoutes]
}

/** Merge custom-table definitions by name: `base` (root config) first, `override`
 *  (workspace config) wins on a name clash. Either side may be undefined. */
export function mergeCustomTables(base: unknown[] | undefined, override: unknown[] | undefined): unknown[] {
  const byName = new Map<string, unknown>()
  for (const t of (base ?? [])) { const n = (t as { name?: string })?.name; if (n) byName.set(n, t) }
  for (const t of (override ?? [])) { const n = (t as { name?: string })?.name; if (n) byName.set(n, t) }
  return [...byName.values()]
}

/**
 * Resolves a config `extensions:` entry to its manifest. Relative resolve
 * strings are conventionally written relative to app/config/extensions.ts;
 * for robustness we try config/, the app root, and the project root. Bare
 * specifiers (npm packages) are imported as `<pkg>/tangen.extension`.
 * Failures warn and return null — one broken extension never blocks boot.
 */
/**
 * The manifest v1 contract (docs/architecture/extension-lifecycle.md): an
 * invalid manifest is skipped loudly - the extension does not load and the
 * warning names every problem - a deprecated declaration warns and loads.
 */
function acceptManifest(manifest: unknown, spec: string): manifest is TangenExtensionManifest {
  const r = validateExtensionManifest(manifest)
  const id = (manifest as { id?: unknown } | null)?.id
  for (const w of r.warnings) console.warn(`[workspace-loader] extension '${String(id ?? spec)}': ${w.path}: ${w.message}`)
  if (!r.ok) {
    console.warn(`[workspace-loader] extension '${String(id ?? spec)}' skipped: the manifest is not valid\n${formatManifestIssues(r.errors)}`)
    return false
  }
  return true
}

async function resolveExtension(
  rootDir: string,
  entry: TangenExtension,
): Promise<LoadedExtension | null> {
  const spec = entry.resolve ?? ''
  if (!spec) return null
  try {
    if (spec.startsWith('.')) {
      const candidates = [
        resolvePath(rootDir, 'config', spec),
        resolvePath(rootDir, spec),
        resolvePath(rootDir, '..', spec),
      ]
      const dir = candidates.find((c) => existsSync(join(c, 'tangen.extension.ts')))
      if (!dir) {
        console.warn(`[workspace-loader] extension '${spec}': no tangen.extension.ts found`)
        return null
      }
      const mod = await import(join(dir, 'tangen.extension.ts'))
      const manifest = (mod.default ?? mod) as TangenExtensionManifest
      if (!acceptManifest(manifest, spec)) return null
      return { id: manifest.id, dir, manifest, options: entry.options }
    }
    // Bare package specifier
    const mod = await import(`${spec}/tangen.extension`)
    const manifest = (mod.default ?? mod) as TangenExtensionManifest
    if (!acceptManifest(manifest, spec)) return null
    return { id: manifest.id, dir: '', pkg: spec, manifest, options: entry.options }
  } catch (err) {
    console.warn(`[workspace-loader] failed to load extension '${spec}': ${(err as Error).message}`)
    return null
  }
}

/**
 * The extensions a workspace config declares, read through the one shared
 * precedence, with the deprecation said ONCE per config at load rather than
 * per request (Phase 6C, Unit 9).
 */
const noticedConfigs = new Set<string>()
function declaredFor(config: unknown, where: string): TangenExtension[] {
  const read = configuredExtensions(config as never)
  const notice = extensionConfigNotice(read, where)
  if (notice && !noticedConfigs.has(notice)) {
    noticedConfigs.add(notice)
    console.warn(`[workspace-loader] ${notice}`)
  }
  return read.entries
}

/** Resolves a project's merged extension entries into LoadedExtension[] (dedup by id). */
async function resolveProjectExtensions(
  rootDir: string,
  entries: TangenExtension[],
): Promise<LoadedExtension[]> {
  const out: LoadedExtension[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const loaded = await resolveExtension(rootDir, entry)
    if (!loaded) continue
    if (seen.has(loaded.id)) {
      console.warn(`[workspace-loader] duplicate extension id '${loaded.id}' - keeping the first`)
      continue
    }
    seen.add(loaded.id)
    out.push(loaded)
  }
  return out
}

/**
 * Loads workspaces starting from the app root (usually `<project>/app`).
 * `workspaces/index.ts` is the authoritative registry (workspace IDs come from
 * WorkspaceDefinition.id, not directory names); each entry's config lives at
 * `workspaces/<slug>/workspace.config.ts`. Environment maps merge three ways:
 * global `config/environments.ts` < per-workspace `environments.ts` < the
 * config's inline `environments` key.
 */
export async function loadWorkspacesFromRoot(rootDir: string): Promise<WorkspaceProject[]> {
  const centralPath = join(rootDir, 'workspaces', 'index.ts')

  if (!existsSync(centralPath)) {
    return []
  }

  let definitions: WorkspaceDefinition[]
  try {
    const mod = await import(centralPath)
    definitions = mod.default as WorkspaceDefinition[]
  } catch {
    return []
  }

  // Load global environments once — workspace configs are merged on top of these
  // The site's key declarations (plan-config-resolver section 9). Optional.
  let siteConfig: Record<string, unknown> | undefined
  try {
    const mod = await import(join(rootDir, 'config', 'site.ts'))
    if (mod.default && typeof mod.default === 'object') siteConfig = mod.default
  } catch {
    // No site.ts - the site declares no keys of its own.
  }

  // Code-declared integrations (Stage 3 E). Optional.
  let integrations: Record<string, unknown> | undefined
  try {
    const mod = await import(join(rootDir, 'config', 'integrations.ts'))
    if (mod.default && typeof mod.default === 'object') integrations = mod.default
  } catch {
    // No integrations.ts.
  }

  // The workspace's desired membership (Stage 3 D). Optional; reconciled at boot.
  let membersDesired: unknown[] | undefined
  try {
    const mod = await import(join(rootDir, 'config', 'members.ts'))
    if (Array.isArray(mod.default)) membersDesired = mod.default
  } catch {
    // No members.ts - membership is managed in the Admin only.
  }

  // Root tangen.config.ts customTables — a FALLBACK so tables declared on the root adapter
  // (the documented single-config path, and what `tangen push` reads) still reach the
  // runtime. The per-workspace workspace.config.ts is canonical and overrides/extends this.
  let rootCustomTables: unknown[] = []
  // The operator's gateway ceiling (`gateway` on the root config): what a workspace may only narrow.
  let rootGateway: unknown
  try {
    const rootMod = await import(join(rootDir, 'tangen.config.ts'))
    rootCustomTables = (rootMod.default ?? rootMod)?.customTables ?? []
    rootGateway = (rootMod.default ?? rootMod)?.gateway
  } catch {
    // No root config, or it declares no customTables — fine.
  }

  // First pass: load all workspace projects without master resolution
  const rawProjects = new Map<string, WorkspaceProject>()
  const rawConfigsBySlug = new Map<string, WorkspaceConfig>()

  for (const def of definitions) {
    const configPath = join(rootDir, 'workspaces', def.slug, 'workspace.config.ts')
    let config: WorkspaceConfig = { name: def.name }

    try {
      const mod = await import(configPath)
      config = mod.default ?? mod
    } catch {
      // Workspace definition exists but no workspace.config.ts — use minimal config
    }

    rawConfigsBySlug.set(def.slug, config)

    // D-15. The spread below is last-writer-wins, which is right for a cache TTL
    // and a privilege escalation for an operator-only key: a tenant restating
    // `server.trustedProxy` would make an attacker-controlled X-Forwarded-For
    // the client IP. Refuse the config by name BEFORE merging, so a ceiling the
    // Gateway resolver reads at M4-M6 is one nothing below it can have moved.
    assertNoOperatorOnlyOverrides({ workspace: def.slug, workspaceConfig: config })

    // Resolve reusable-component name refs against the workspace registry so all
    // downstream consumers (validation, admin, publish) see full ComponentDefs.
    const schemas = resolveSchemaComponentRefs(config.schemas ?? [], (config as any).components ?? [])
    // A field name declared twice in one type (top level + group, or two groups) is
    // two declarations of one column. `tangen push` refuses it; a server that is
    // already running on such code keeps serving, but says so by name rather than
    // leaving the next push to die in codegen.
    for (const issue of validateColumnNamespace(schemas as never)) {
      console.warn(`[workspace-loader] workspace '${def.slug}': ${issue}`)
    }

    rawProjects.set(def.slug, {
      workspaceId: def.id,
      slug: def.slug,
      name: config.name ?? def.name,
      deploymentGateway: rootGateway as WorkspaceProject['deploymentGateway'],
      // customTables merge: root tangen.config.ts is the base, the workspace config overrides/extends by name.
      config: { schema: '', ...config, customTables: mergeCustomTables(rootCustomTables, (config as any).customTables) } as TangenConfig,
      schemas,
      // One reading of the config's extension declaration, so the server and
      // the CLI can never resolve an ambiguous config differently (Phase 6C).
      declaredExtensions: declaredFor(config, `workspace '${def.slug}'`),
      globals: (config as any).globals ?? [],
      components: (config as any).components ?? [],
      contentHooks: (config as any).contentHooks,
      routes: (config as any).routes,
      apiResources: (config as any).apiResources,
      roles: (config as any).roles,
      dashboard: (config as any).dashboard,
      ai: (config as any).ai,
      localization: (config as any).localization,
      mail: (config as any).mail,
      jobs: (config as any).jobs,
      webhookTriggers: (config as any).webhookTriggers,
      storage: (config as any).storage,
      mcp: (config as any).mcp,
      knowledge: (config as any).knowledge,
      graphql: (config as any).graphql,
      siteConfig: siteConfig as WorkspaceProject['siteConfig'],
      membersDesired: membersDesired as WorkspaceProject['membersDesired'],
      integrations: integrations as WorkspaceProject['integrations'],
      masterSlug: def.master,
    })
  }

  // Second pass: resolve master extension + route inheritance with exclusion support
  const projects: WorkspaceProject[] = []
  for (const def of definitions) {
    const project = rawProjects.get(def.slug)!
    if (!def.master) {
      project.extensions = await resolveProjectExtensions(rootDir, project.declaredExtensions ?? [])
      projects.push(project)
      continue
    }

    const masterProject = rawProjects.get(def.master)
    if (!masterProject) {
      console.warn(`[workspace-loader] master '${def.master}' not found for workspace '${def.slug}'`)
      project.extensions = await resolveProjectExtensions(rootDir, project.declaredExtensions ?? [])
      projects.push(project)
      continue
    }

    const childConfig = rawConfigsBySlug.get(def.slug)
    const excludeExtensions = childConfig?.excludeExtensions ?? []
    const excludeRouteGroups = childConfig?.excludeRouteGroups ?? []

    const mergedExtensions = mergeDeclaredExtensions(masterProject.declaredExtensions ?? [], project.declaredExtensions ?? [], excludeExtensions)
    projects.push({
      ...project,
      declaredExtensions: mergedExtensions,
      extensions: await resolveProjectExtensions(rootDir, mergedExtensions),
      routes: mergeRoutes(masterProject.routes ?? [], project.routes ?? [], excludeRouteGroups),
      apiResources: mergeApiResources(masterProject.apiResources ?? [], project.apiResources ?? []),
      // Code roles: child seeds win over master on slug collision
      roles: (() => {
        const childSlugs = new Set((project.roles ?? []).map((r: any) => r.slug))
        return [...(masterProject.roles ?? []).filter((r: any) => !childSlugs.has(r.slug)), ...(project.roles ?? [])]
      })(),
    })
  }

  return projects
}
