/**
 * File Name: list.ts
 * Purpose: Route and helpers for enumerating all extensions available to a workspace,
 *          merging the feature-gated built-in (Auth), DB-installed extensions, and externally
 *          resolved extensions from the project config.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, Drizzle ORM, @tangen/db (workspaceInstalledApps), @tangen/types (TangenExtension, ExtensionRoute)
 */
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { allowedSlotContributions, type ExtensionSlotContribution } from '@tangen/types'
import { effectiveGrants } from '../../services/extension-server'
import { activeExtensionIdsDb } from '../../services/extension-install-state'
import type { TangenExtension, ExtensionRoute } from '@tangen/types'
import { configuredExtensions } from '@tangen/types'
import { getExtensionManifest } from '../../hooks/app-hooks-registry'

export interface ExtensionEntry {
  id: string
  name: string
  icon: string
  builtIn: boolean
  routes?: ExtensionRoute[]
  resolve?: string
  options?: Record<string, unknown>
  /** Admin slot items this ACTIVE extension may fill, by its effective grants (Extension Kernel K7.2). */
  slots?: ExtensionSlotContribution[]
  /** Declares typed manifest settings (K7.1): the Admin draws the generated form. */
  settings?: boolean
  /**
   * What KIND of extension this is (plan-connectors E2). A `connector-pack`
   * exists to offer connections, so the Admin lists it under Connections and
   * gives it no Extensions nav entry of its own: an operator looking for
   * Google looks where the connections are. Absent means an ordinary
   * extension, which is what every extension written before the field was.
   */
  kind?: 'extension' | 'connector-pack'
}

// Extensions that are always present regardless of feature flags
const ALWAYS_ON_EXTENSIONS: ExtensionEntry[] = []

/**
 * What the list says about ONE installed extension, read from its manifest.
 * Pure and exported because it is the mapping worth asserting: everything
 * grant-dependent (the allowed slot items) is added by the route around it.
 */
export function entryFromManifest(manifest: {
  id: string; name: string; version?: string
  sidebarPanels?: Array<{ icon?: string }>
  routes?: ExtensionRoute[]
  settings?: unknown
  kind?: 'extension' | 'connector-pack'
}): Omit<ExtensionEntry, 'slots'> {
  return {
    id: manifest.id,
    name: manifest.name,
    icon: manifest.sidebarPanels?.[0]?.icon ?? 'IconPuzzle',
    builtIn: false,
    routes: manifest.routes,
    ...(manifest.settings ? { settings: true } : {}),
    ...(manifest.kind && manifest.kind !== 'extension' ? { kind: manifest.kind } : {}),
  }
}


export function deriveExtensionId(resolve: string): string {
  const last = resolve.split('/').pop() ?? resolve
  // npm extension packages follow @tangen/ext-<id> (ext-flows -> flows);
  // the MANIFEST id is authoritative, so prefer the candidate that has a
  // loaded manifest - otherwise page routes/installs would key 'ext-porter'
  // while the manifest (and the admin's page registry) say 'porter'.
  const candidates = last.startsWith('ext-') ? [last.slice(4), last] : [last]
  for (const c of candidates) {
    if (getExtensionManifest(c)) return c
  }
  return candidates[0]
}

/** 'kitchen-sink' → 'Kitchen Sink' - the fallback when no manifest is loaded. */
function humanizeExtensionId(id: string): string {
  return id.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/**
 * Merges feature-gated built-ins, DB-installed extensions, and externally resolved extensions into a deduplicated list.
 * @param configExtensions - Extensions declared in the workspace project config (external/resolve-based)
 * @param installedExtensions - Feature-gated and DB-installed extensions already resolved by the route handler
 * @returns A deduplicated array of ExtensionEntry objects ordered: always-on → installed → external
 */
export function buildExtensionsList(configExtensions: TangenExtension[], installedExtensions: ExtensionEntry[] = []): ExtensionEntry[] {
  const external: ExtensionEntry[] = configExtensions.map((ext) => {
    const id = deriveExtensionId(ext.resolve)
    // The display name comes from the loaded manifest - the resolve value is
    // a PATH ('../../extensions/flows') and must never reach the UI.
    const manifest = getExtensionManifest(id) as { name?: string; kind?: 'extension' | 'connector-pack' } | undefined
    return {
      id,
      name: manifest?.name ?? humanizeExtensionId(id),
      icon: 'IconPuzzle',
      builtIn: false,
      resolve: ext.resolve,
      options: ext.options,
      ...(manifest?.kind && manifest.kind !== 'extension' ? { kind: manifest.kind } : {}),
    }
  })

  const seen = new Set<string>()
  const all: ExtensionEntry[] = []
  for (const entry of [...ALWAYS_ON_EXTENSIONS, ...installedExtensions, ...external]) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id)
      all.push(entry)
    }
  }
  return all
}

/**
 * Elysia plugin that registers GET /api/v1/extensions; returns the full list of extensions available to the current workspace.
 * @param app - The Elysia application instance
 * @returns The Elysia instance with the extensions list route registered
 */
export const extensionsListRoute = (app: Elysia) =>
  app.get('/api/v1/extensions', async (ctx: any) => {
    const { db, workspaceProjects, workspaceId } = ctx
    const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    // The loader already normalized the config's declaration (one precedence,
    // one deprecation notice); read what it resolved rather than re-deciding.
    const configExtensions: TangenExtension[] = project?.declaredExtensions ?? configuredExtensions(project?.config as never).entries

    let installedExtensions: ExtensionEntry[] = []
    try {
      const rows = (await activeExtensionIdsDb(db, { workspaceId })).map((appId) => ({ appId }))

      const dbInstalled = rows
        .map((r: { appId: string }) => {
          const manifest = getExtensionManifest(r.appId)
          if (!manifest) return null
          return {
            ...entryFromManifest(manifest),
            slots: allowedSlotContributions(manifest, effectiveGrants(manifest.id, workspaceId)),
          } satisfies ExtensionEntry
        })
        .filter(Boolean) as ExtensionEntry[]
      installedExtensions = dbInstalled
    } catch {
      // DB unavailable — degrade gracefully
    }

    // A code-declared extension is listed (pages, nav, commands mount from
    // this list) only while it is active in this environment (Phase 4).
    const activeIds = new Set(installedExtensions.map((e) => e.id))
    const activeConfig = configExtensions.filter((ext) => activeIds.has(deriveExtensionId(ext.resolve)))
    return { data: buildExtensionsList(activeConfig, installedExtensions) }
  })
