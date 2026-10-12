/**
 * File Name: push-config.ts
 * Purpose: The config-side helpers `tangen push` and its preflight share: how
 *          the workspace id is derived, how the thin tangen.config.ts is merged
 *          with the workspace config, which custom tables a push gathers, the
 *          row it registers, and where a project's config lives.
 *          Pure or filesystem-only - nothing here touches the database.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Extracted from push.ts so push-preflight.ts can import
 *          them without a cycle; push.ts re-exports them for its callers.
 */
import { resolve, join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import type { WorkspaceDefinition, TangenConfig } from '@tangen/types'

/**
 * Resolves which directory holds the config for a workspace slug: its own
 * app/workspaces/<slug>/workspace.config.ts when there is one, otherwise the
 * master config in app/. (The older app/apps/<slug> layout is gone.)
 * Pure: accepts an existsFn for testability.
 */
export function resolveWorkspaceConfigPath(
  slug: string,
  definitions: Pick<WorkspaceDefinition, 'id' | 'name' | 'slug'>[],
  cwd: string,
  existsFn: (path: string) => boolean = existsSync,
): { def: Pick<WorkspaceDefinition, 'id' | 'name' | 'slug'>; configDir: string } | null {
  const def = definitions.find(d => d.slug === slug)
  if (!def) return null

  const perWorkspaceDir = join(cwd, 'app', 'workspaces', slug)
  const masterDir = join(cwd, 'app')
  const hasWorkspaceConfig = existsFn(join(perWorkspaceDir, 'workspace.config.ts'))
  return { def, configDir: hasWorkspaceConfig ? perWorkspaceDir : masterDir }
}

/** Where a workspace id came from - `config` is the only one that is a declaration. */
export type WorkspaceIdSource = 'environment' | 'config' | 'caller' | 'derived-from-name' | 'fallback'

/**
 * Which of the sources answered. The last two are guesses: an id derived
 * from a mutable project name moves when the name does, and the fallback is
 * the same string for every project on the machine (Phase 6C, Unit 6).
 */
export function workspaceIdSource(config: TangenConfig, fromProject?: string): WorkspaceIdSource {
  if (process.env.TANGEN_WORKSPACE_ID) return 'environment'
  if (config.workspaceId) return 'config'
  if (fromProject) return 'caller'
  if (config.project) return 'derived-from-name'
  return 'fallback'
}

/** Derive a stable workspace ID.
 *  Priority: TANGEN_WORKSPACE_ID env var > config.workspaceId > project-derived > config.project > fallback.
 *  The last two are guesses; `workspaceIdSource` says which one answered so a
 *  caller can warn rather than silently key data by a mutable name.
 */
export function deriveWorkspaceId(config: TangenConfig, fromProject?: string): string {
  if (process.env.TANGEN_WORKSPACE_ID) return process.env.TANGEN_WORKSPACE_ID
  if (config.workspaceId) return config.workspaceId
  if (fromProject) return fromProject
  if (config.project) return `wsp_${config.project.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
  return 'wsp_local_dev'
}

/**
 * The sentence to print when the id was guessed rather than declared, or null
 * when it was declared. One line, at the command that used it.
 */
export function workspaceIdNotice(config: TangenConfig, id: string, fromProject?: string): string | null {
  const source = workspaceIdSource(config, fromProject)
  if (source === 'derived-from-name') {
    return `workspace id "${id}" was derived from the project name "${config.project}" - renaming the project would point at different data. Declare workspaceId in your config.`
  }
  if (source === 'fallback') {
    return `workspace id "${id}" is the local default, not a declared identity. Declare workspaceId in your config before sharing this project or its database.`
  }
  return null
}

/**
 * Builds the admin panel URL where the setup wizard lives.
 * Returns null when the server URL is unknown (developer hasn't configured it yet).
 */
export function buildSetupHintUrl(serverUrl: string | undefined, workspaceId: string): string | null {
  if (!serverUrl) return null
  return `${serverUrl.replace(/\/$/, '')}/${workspaceId}/setup`
}

/**
 * Walks up from dir looking for a packages/db directory (the monorepo layout).
 * @param dir - Starting directory, typically the project cwd.
 * @returns Absolute path to packages/db, or null in standalone projects -
 *          callers skip content-tables codegen in that case.
 */
export function findDbPackageRoot(dir: string): string | null {
  const candidate = resolve(dir, 'packages', 'db')
  if (existsSync(candidate)) return candidate
  // Consumer installs: the db package lives in node_modules - generated
  // content tables are written INTO the installed package (Strapi-style).
  const installed = resolve(dir, 'node_modules', '@tangen', 'db')
  if (existsSync(installed)) return installed
  const parent = resolve(dir, '..')
  if (parent === dir) return null
  return findDbPackageRoot(parent)
}

/**
 * Every custom-table definition to create in this DB: the root tangen.config.ts's
 * `customTables` (the fallback) UNIONed with each `workspaces/<slug>/workspace.config.ts`'s
 * `customTables` (the canonical, workspace-scoped home). Deduped by name (workspace wins).
 * Push creates tables idempotently (CREATE TABLE IF NOT EXISTS), so pulling every declared
 * table into the push is safe - it closes the gap where a table declared only on the
 * workspace config was never physically created.
 */
export async function gatherCustomTables(cwd: string, rootTables: unknown[] | undefined): Promise<unknown[]> {
  const byName = new Map<string, unknown>()
  for (const t of rootTables ?? []) { const n = (t as { name?: string })?.name; if (n) byName.set(n, t) }
  const wsRoot = [join(cwd, 'workspaces'), join(cwd, 'app', 'workspaces')].find((d) => existsSync(d))
  if (wsRoot) {
    for (const entry of readdirSync(wsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const cfgPath = join(wsRoot, entry.name, 'workspace.config.ts')
      if (!existsSync(cfgPath)) continue
      try {
        const mod = await import(`${cfgPath}?t=${Date.now()}`)
        for (const t of ((mod.default ?? mod)?.customTables ?? [])) {
          const n = (t as { name?: string })?.name; if (n) byName.set(n, t)
        }
      } catch { /* unreadable workspace config - skip */ }
    }
  }
  return [...byName.values()]
}

/**
 * Config keys that live on the WORKSPACE config (`workspaces/<slug>/workspace.config.ts`,
 * where `tangen enable` writes) but that PUSH reads. The thin `tangen.config.ts` scaffolded
 * by `tangen create` does not carry them, so without this merge, enabling a feature (e.g.
 * `tangen enable localization`) is silently ignored at push time. (customTables is handled
 * separately by gatherCustomTables, which unions across all workspaces.)
 */
const MERGED_CONFIG_KEYS = [
  'localization', 'auth', 'components', 'knowledge', 'forms',
  // `extensions` is where a scaffold declares them; `plugins` is its
  // deprecated spelling and is kept so older projects still merge. Without
  // `extensions`, `tangen extension list` reported every installed extension
  // as "(not configured - entry removed?)" on a project whose config was fine.
  'extensions', 'plugins',
  // The workspace-layer VALUES the configuration resolver reads (Stage 2): a
  // CLI command resolving a deployment must see the same workspace layer the
  // API loader carries, or Doctor and push would judge a different deployment
  // than boot serves.
  'site', 'integration', 'mail', 'ai', 'storage', 'cache', 'logger', 'debug', 'gateway', 'server', 'admin', 'frontend', 'redis', 'customTables', 'roles', 'jobs',
] as const

/**
 * Fills push-relevant workspace-config keys into the thin tangen.config.ts. A value set
 * explicitly on tangen.config.ts WINS (back-compat for repos that declared env/features
 * there); the workspace config only fills the gaps. Pure, for testing.
 */
export function mergeWorkspaceConfig(
  thin: TangenConfig,
  ws: Record<string, unknown> | null,
): TangenConfig {
  if (!ws) return thin
  const merged: Record<string, unknown> = { ...(thin as unknown as Record<string, unknown>) }
  for (const key of MERGED_CONFIG_KEYS) {
    if (merged[key] == null && ws[key] != null) merged[key] = ws[key]
  }
  return merged as unknown as TangenConfig
}


/** The site's key declarations (`app/config/site.ts`), or undefined. */
export async function loadSiteConfig(cwd: string): Promise<Record<string, unknown> | undefined> {
  for (const p of [join(cwd, 'config', 'site.ts'), join(cwd, 'app', 'config', 'site.ts')]) {
    if (!existsSync(p)) continue
    const mod = await import(`${p}?t=${Date.now()}`)
    const d = mod.default ?? mod
    return d && typeof d === 'object' ? (d as Record<string, unknown>) : undefined
  }
  return undefined
}

/** Code-declared integrations (`app/config/integrations.ts`), or undefined. */
export async function loadIntegrationsConfig(cwd: string): Promise<Record<string, unknown> | undefined> {
  for (const p of [join(cwd, 'config', 'integrations.ts'), join(cwd, 'app', 'config', 'integrations.ts')]) {
    if (!existsSync(p)) continue
    const mod = await import(`${p}?t=${Date.now()}`)
    const d = mod.default ?? mod
    return d && typeof d === 'object' ? (d as Record<string, unknown>) : undefined
  }
  return undefined
}

/** The workspace's desired membership (`app/config/members.ts`), or undefined. */
export async function loadMembersConfig(cwd: string): Promise<unknown[] | undefined> {
  for (const p of [join(cwd, 'config', 'members.ts'), join(cwd, 'app', 'config', 'members.ts')]) {
    if (!existsSync(p)) continue
    const mod = await import(`${p}?t=${Date.now()}`)
    const d = mod.default ?? mod
    return Array.isArray(d) ? d : undefined
  }
  return undefined
}


/**
 * Loads the effective config for push: the thin `tangen.config.ts` merged with the target
 * workspace's `workspace.config.ts` (the source of truth `tangen enable` writes to).
 */
export async function resolveEffectiveConfig(cwd: string, thin: TangenConfig): Promise<TangenConfig> {
  const siteConfig = await loadSiteConfig(cwd)
  if (siteConfig) thin = { ...thin, siteConfig } as TangenConfig
  const membersDesired = await loadMembersConfig(cwd)
  if (membersDesired) thin = { ...thin, membersDesired } as TangenConfig
  const integrations = await loadIntegrationsConfig(cwd)
  if (integrations) thin = { ...thin, integrations } as TangenConfig
  const slug = thin.project ?? ''
  if (!slug) return thin
  for (const root of [join(cwd, 'workspaces'), join(cwd, 'app', 'workspaces')]) {
    const p = join(root, slug, 'workspace.config.ts')
    if (!existsSync(p)) continue
    try {
      const mod = await import(`${p}?t=${Date.now()}`)
      return mergeWorkspaceConfig(thin, (mod.default ?? mod) as Record<string, unknown>)
    } catch (e) {
      // The file EXISTS and failed to load - that is fatal, and the failure is
      // almost never in this file: the config imports the schema barrel and
      // components, so a bad schema surfaces here. Swallowing it used to point at the wrong file (finding #4).
      const cause = e instanceof Error ? e.message : String(e)
      throw new Error(
        `Failed to load ${p}\n`
        + `  ${cause}\n`
        + `  The error is usually in a file this config imports (a schema in `
        + `app/content-objects/ or a component in app/components/), not the config itself.`,
      )
    }
  }
  return thin
}


export function findAllProjectCwds(cwd: string): string[] {
  if (existsSync(join(cwd, 'tangen.config.ts'))) return [cwd]

  const appDir = join(cwd, 'app')
  if (existsSync(join(appDir, 'tangen.config.ts'))) return [appDir]

  return []
}
