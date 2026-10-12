/**
 * File Name: sidebar-panels.ts
 * Purpose: Exposes the GET /api/v1/admin/workspaces/:workspaceId/sidebar-panels endpoint,
 * which aggregates sidebar panel contributions from all extensions installed in a workspace.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, Drizzle ORM (workspaceInstalledApps), @tangen/types
 * (TangenExtensionManifest, getBuiltInExtension). Panels can be filtered by content-type slug.
 */
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { activeExtensionIdsDb } from '../../services/extension-install-state'
import type { TangenExtensionManifest } from '@tangen/types'
import { getExtensionManifest } from '../../hooks/app-hooks-registry'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtensionSidebarPanelEntry {
  id: string
  label: string
  icon?: string
  component: string
  types?: string[]
  renderMode: 'inline' | 'modal'
  /** 'main' (default) center-stage card; 'sidebar' compact right-rail card. */
  placement: 'main' | 'sidebar'
  buttonLabel: string
  extensionId: string
  extensionName: string
  ai?: { enabled?: boolean; instructions?: string; fields: { name: string; label: string; fieldType: string; config?: Record<string, unknown> }[] }
}

// ── Pure helper ───────────────────────────────────────────────────────────────

/**
 * Flattens sidebar panel definitions from a set of extension manifests into a single list.
 * When typeSlug is provided, panels restricted to other types are excluded.
 * @param manifests - Extension manifests of all installed workspace extensions.
 * @param typeSlug - Optional content-type slug to filter panels by their `types` array.
 * @returns Flat array of enriched sidebar panel entries ready for the API response.
 */
/** Per-extension AI overrides from the workspace config. */
export interface ExtensionAIOverride {
  enabled: boolean
  instructions?: string
}

/**
 * Reads AI enablement from the workspace config's extension entries:
 *   { resolve: '../../extensions/seo', options: { ai: true } }
 *   { resolve: '…', options: { ai: { enabled: true, instructions: '…' } } }
 * Extensions are matched by the basename of their resolve path (= manifest id
 * for built-ins). The manifest declares capability (fields + default
 * guardrail); the config decides whether it is on.
 */
export function resolveExtensionAIOverrides(
  plugins: { resolve: string; options?: Record<string, unknown> }[] | undefined,
): Map<string, ExtensionAIOverride> {
  const overrides = new Map<string, ExtensionAIOverride>()
  for (const plugin of plugins ?? []) {
    const ai = plugin.options?.ai
    if (ai === undefined) continue
    const id = plugin.resolve.replace(/\/+$/, '').split('/').pop()
    if (!id) continue
    if (typeof ai === 'boolean') {
      overrides.set(id, { enabled: ai })
    } else if (ai && typeof ai === 'object') {
      overrides.set(id, {
        enabled: (ai as any).enabled === true,
        instructions: typeof (ai as any).instructions === 'string' ? (ai as any).instructions : undefined,
      })
    }
  }
  return overrides
}

export function buildInstalledSidebarPanels(
  manifests: TangenExtensionManifest[],
  typeSlug?: string,
  aiOverrides?: Map<string, ExtensionAIOverride>,
): ExtensionSidebarPanelEntry[] {
  const result: ExtensionSidebarPanelEntry[] = []

  for (const manifest of manifests) {
    if (!manifest.sidebarPanels?.length) continue

    for (const panel of manifest.sidebarPanels) {
      if (typeSlug !== undefined) {
        const restricted = panel.types && panel.types.length > 0
        if (restricted && !panel.types!.includes(typeSlug)) continue
      }

      // Workspace config wins over the manifest's own enabled flag — but it
      // can only switch on panels that actually declare AI fields.
      let ai = panel.ai
      const override = aiOverrides?.get(manifest.id)
      if (override && ai?.fields?.length) {
        ai = {
          ...ai,
          enabled: override.enabled,
          instructions: override.instructions ?? ai.instructions,
        }
      }

      result.push({
        id: panel.id,
        label: panel.label,
        icon: panel.icon,
        component: panel.component,
        types: panel.types,
        renderMode: panel.renderMode ?? 'inline',
        placement: panel.placement ?? 'main',
        buttonLabel: panel.buttonLabel ?? 'Open',
        extensionId: manifest.id,
        extensionName: manifest.name,
        ai,
      })
    }
  }

  return result
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * Elysia plugin providing GET /api/v1/admin/workspaces/:workspaceId/sidebar-panels.
 * Returns sidebar panel entries for all installed extensions; accepts an optional `type`
 * query parameter to filter panels by content-type slug.
 * @param app - The parent Elysia instance to extend.
 * @returns The extended Elysia instance with the route registered.
 */
export const workspaceSidebarPanelsRoute = (app: Elysia) =>
  app.get('/api/v1/admin/workspaces/:workspaceId/sidebar-panels', async (ctx: any) => {
    const { db, params, query } = ctx
    const wsId = params.workspaceId as string
    const typeSlug = (query?.type as string) || undefined

    const rows = (await activeExtensionIdsDb(db, { workspaceId: wsId })).map((appId) => ({ appId }))

    const manifests = rows
      .map((r: { appId: string }) => getExtensionManifest(r.appId))
      .filter(Boolean) as TangenExtensionManifest[]

    const project = ((ctx as any).workspaceProjects as any[])?.find((p) => p.workspaceId === wsId)
    const aiOverrides = resolveExtensionAIOverrides(project?.declaredExtensions)

    return { data: buildInstalledSidebarPanels(manifests, typeSlug, aiOverrides) }
  })
