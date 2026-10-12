/**
 * File Name: detail.ts
 * Purpose: GET /api/v1/extensions/:id — a manifest-driven overview of a single
 *          extension. This backs the admin's *default* extension landing page:
 *          any installed extension that doesn't declare its own admin page
 *          still has a real screen (name, version, what it provides), so a
 *          sidebar entry can never point at a dead route. Extensions that DO
 *          declare a page override the default via an explicit route.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Elysia } from 'elysia'
import { inspectExtensionFilters } from '../../kernel/filters'
import { reviewGrants } from '@tangen/types'
import { recordedGrantsOf } from '../../hooks/app-hooks-registry'
import type { TangenExtensionManifest } from '@tangen/types'
import { getExtensionManifest } from '../../hooks/app-hooks-registry'

export interface ExtensionOverview {
  id: string
  name: string
  version: string
  description?: string
  /** Content-versioned data (rolls back with revisions) vs accumulative. */
  versionedData: boolean
  /** Custom field types this extension contributes to the content model. */
  fieldTypes: { name: string; label: string; description?: string }[]
  /** Panels this extension adds to the object editor sidebar. */
  sidebarPanels: { id: string; label: string }[]
  /** True when it ships a server entry (content hooks, tasks, events, MCP). */
  hasServer: boolean
  /** Declares typed manifest settings (K7.1): the overview draws the generated form. */
  settings: boolean
}

/** Pure manifest → overview mapping (browser-safe fields only). */
export function buildExtensionOverview(manifest: TangenExtensionManifest): ExtensionOverview {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    versionedData: manifest.versionedData ?? false,
    fieldTypes: (manifest.fieldTypes ?? []).map((f) => ({
      name: f.name,
      label: f.label,
      description: f.description,
    })),
    sidebarPanels: (manifest.sidebarPanels ?? []).map((p) => ({ id: p.id, label: p.label })),
    hasServer: Boolean(manifest.server),
    settings: Boolean(manifest.settings),
  }
}

/**
 * Elysia plugin registering GET /api/v1/extensions/:id. Returns the overview
 * for any installed extension whose manifest is registered; `data: null`
 * (404) otherwise. Admin-gated by the shared auth middleware.
 */
export const extensionDetailRoute = (app: Elysia) =>
  // Param name must match the sibling GET (/extensions/:extensionId/widget-data)
  // — Elysia's radix router requires one param name per path position.
  app.get('/api/v1/extensions/:extensionId', (ctx: any) => {
    const id = String(ctx.params?.extensionId ?? '')
    const manifest = getExtensionManifest(id)
    if (!manifest) {
      ctx.set.status = 404
      return { error: { code: 'NOT_FOUND', message: `No extension '${id}'`, status: 404 }, data: null }
    }
    // K4.3: `inspect` - the extension's filter registrations and the contention it is part of, for this workspace.
    // K5.2b: the same grant review the CLI renders, against what this workspace recorded (the Admin's Permissions view reads it).
    const recorded = recordedGrantsOf(id, ctx.workspaceId)
    const review = manifest.grants ? reviewGrants(manifest, { trust: 'trusted', ...(Array.isArray(recorded) ? { previouslyGranted: recorded } : {}) }) : null
    return { data: { ...buildExtensionOverview(manifest), filters: inspectExtensionFilters(id, { workspaceId: ctx.workspaceId }), grants: review ? { review, recorded: Array.isArray(recorded) ? recorded : null } : null } }
  })
