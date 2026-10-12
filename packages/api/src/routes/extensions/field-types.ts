/**
 * File Name: field-types.ts
 * Purpose: Route and helper for listing all custom field types contributed by installed extensions
 *          for a given workspace, used by the admin schema editor.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, Drizzle ORM, @tangen/db (workspaceInstalledApps), @tangen/types (TangenExtensionManifest)
 */
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { activeExtensionIdsDb } from '../../services/extension-install-state'
import type { TangenExtensionManifest } from '@tangen/types'
import { getExtensionManifest } from '../../hooks/app-hooks-registry'
import { listSiteFieldTypes } from '../../services/site-field-types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtensionFieldTypeEntry {
  name: string
  label: string
  description?: string
  icon?: string
  extensionId: string
  extensionName: string
  configSchema?: Record<string, unknown>
  /** false when the field type opts out of AI (`ai.enabled: false`) — governs AI
   *  generation semantics (not the UI). Defaults to true (AI-eligible). */
  aiEnabled?: boolean
  /** Schema-builder control paths/prefixes to hide for this type (general option
   *  suppression). Includes `config.ai` when the type opts out of AI. */
  hiddenControls?: string[]
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * The effective set of schema-builder controls to hide for a field type: the
 * type's declared `hideControls`, plus `config.ai` when it opts out of AI
 * (`ai.enabled: false` is sugar for hiding the whole AI section). Deduped.
 */
export function resolveHiddenControls(
  ft: { hideControls?: string[]; ai?: { enabled?: boolean } },
): string[] {
  const hidden = new Set(ft.hideControls ?? [])
  if (ft.ai?.enabled === false) hidden.add('config.ai')
  return [...hidden]
}

/**
 * Flattens field-type definitions from all installed extension manifests into a single list.
 * @param manifests - Array of installed extension manifests to inspect for fieldTypes
 * @returns A flat array of ExtensionFieldTypeEntry objects, one per declared field type
 */
export function buildInstalledFieldTypes(manifests: TangenExtensionManifest[]): ExtensionFieldTypeEntry[] {
  const result: ExtensionFieldTypeEntry[] = []
  for (const manifest of manifests) {
    if (!manifest.fieldTypes?.length) continue
    for (const ft of manifest.fieldTypes) {
      result.push({
        name: ft.name,
        label: ft.label,
        description: ft.description,
        icon: typeof ft.icon === 'string' ? ft.icon : undefined,
        configSchema: ft.configSchema,
        extensionId: manifest.id,
        extensionName: manifest.name,
        aiEnabled: ft.ai?.enabled !== false,
        hiddenControls: resolveHiddenControls(ft),
      })
    }
  }
  return result
}

/** Site-defined field types (app/fields/<name>) as picker entries. */
export function buildSiteFieldTypes(): ExtensionFieldTypeEntry[] {
  return listSiteFieldTypes().map((ft) => ({
    name: ft.name,
    label: ft.label,
    description: ft.description,
    icon: typeof ft.icon === 'string' ? ft.icon : undefined,
    configSchema: ft.configSchema,
    extensionId: 'site',
    extensionName: 'Site',
    aiEnabled: ft.ai?.enabled !== false,
    hiddenControls: resolveHiddenControls(ft),
  }))
}


// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * Elysia plugin that registers GET /api/v1/admin/workspaces/:workspaceId/field-types;
 * returns all custom field types available from the workspace's installed extensions.
 * @param app - The Elysia application instance
 * @returns The Elysia instance with the field-types route registered
 */
export const workspaceFieldTypesRoute = (app: Elysia) =>
  app.get('/api/v1/admin/workspaces/:workspaceId/field-types', async (ctx: any) => {
    const { db, params } = ctx
    const wsId = params.workspaceId as string

    const rows = (await activeExtensionIdsDb(db, { workspaceId: wsId })).map((appId) => ({ appId }))

    const manifests = rows
      .map((r: { appId: string }) => getExtensionManifest(r.appId))
      .filter(Boolean) as TangenExtensionManifest[]

    return { data: [...buildInstalledFieldTypes(manifests), ...buildSiteFieldTypes()] }
  })
