/**
 * File Name: ui-manifest.ts (extensions)
 * Purpose: The runtime UI manifest and the bundle it points at (Extension
 *          Kernel K7.3). `GET /api/v1/admin/ui-manifest` answers, for the
 *          member's workspace, every ACTIVE extension's UI descriptors and
 *          the url of its built client bundle when one is registered on
 *          disk; `GET /api/v1/admin/ext/<id>/ui.js` (reached through the
 *          extension admin mount's dispatch) serves that bundle as an ES
 *          module - private, immutable (the url carries the version),
 *          nosniff. An inactive extension, an unregistered bundle or a
 *          file gone from disk are all a 404: nothing about the deployment
 *          is learnable from the difference.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { Elysia } from 'elysia'
import { existsSync } from 'node:fs'
import { buildRuntimeUiManifest } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { getExtensionManifest, extensionUiBundlePath } from '../../hooks/app-hooks-registry'
import { extensionWiringDeps, effectiveGrants } from '../../services/extension-server'

export const UI_BUNDLE_FILE = 'ui.js'

export function bundleUrlFor(extensionId: string, version: string): string {
  return `/api/v1/admin/ext/${encodeURIComponent(extensionId)}/${UI_BUNDLE_FILE}?v=${encodeURIComponent(version)}`
}

/** The registered bundle, only while it exists on disk. */
function registeredBundle(extensionId: string): string | null {
  const p = extensionUiBundlePath(extensionId)
  return p && existsSync(p) ? p : null
}

export const uiManifestRoute = (app: Elysia) =>
  app.get('/api/v1/admin/ui-manifest', async (ctx: any) => {
    const { memberId, workspaceId } = ctx
    if (!memberId) throw new RequestError('FORBIDDEN', 'Admin session required', 403)
    const deps = extensionWiringDeps()
    const activeIds = new Set(deps?.activeIds ? await deps.activeIds(workspaceId).catch(() => [] as string[]) : [])
    const manifests = [...activeIds].map((id) => getExtensionManifest(id)).filter((m): m is NonNullable<typeof m> => Boolean(m))
    return buildRuntimeUiManifest({
      manifests,
      activeIds,
      grantsOf: (id) => effectiveGrants(id, workspaceId),
      bundleFor: (id, m) => (registeredBundle(id) ? { url: bundleUrlFor(id, m.version) } : null),
    })
  })

/** Called by the extension admin mount's dispatch for `GET .../ui.js`. */
export async function serveExtensionUiBundle(ctx: any, extensionId: string): Promise<Response> {
  const { memberId, workspaceId } = ctx
  if (!memberId) throw new RequestError('FORBIDDEN', 'Admin session required', 403)
  const deps = extensionWiringDeps()
  if (!deps || !(await deps.isActive(extensionId, workspaceId))) throw new RequestError('NOT_FOUND', 'Route not found', 404)
  const path = registeredBundle(extensionId)
  if (!path) throw new RequestError('NOT_FOUND', 'Route not found', 404)
  return new Response(Bun.file(path), {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
