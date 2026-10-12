/**
 * File Name: settings.ts (extensions)
 * Purpose: The core settings API for an extension with a typed `settings`
 *          manifest (Extension Kernel K7.1): GET answers the redacted
 *          values, the descriptors and the version - what the generated
 *          Admin form draws; POST validates a patch, seals its secrets and
 *          merges. Reached through the extension admin mount's dispatch,
 *          only when the manifest declares settings, so an extension without
 *          a definition keeps its own `settings` route. Gated by
 *          manage:settings like every other Settings page.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { getExtensionManifest, getExtensionServer } from '../../hooks/app-hooks-registry'
import { extensionWiringDeps, effectiveGrants } from '../../services/extension-server'
import { connectionsScopeFor } from '../../services/connections-scope'
import { createExtensionSettings } from '../../services/extension-settings'
import { getLogger } from '@tangen/logging'

/**
 * Tells the extension's server that settings moved. Isolated and NOT awaited
 * by the response: the hook runs after the write is stored, and an extension
 * that throws - or one that decides to call a provider inline despite the
 * contract - must not fail or delay the operator's save.
 */
async function notifySettingsChange(
  extensionId: string,
  server: { onSettingsChange?: (ctx: any, change: { changed: string[] }) => void | Promise<void> } | undefined | null,
  extCtx: unknown,
  changed: string[],
): Promise<void> {
  if (typeof server?.onSettingsChange !== 'function') return
  try {
    await server.onSettingsChange(extCtx as never, { changed })
  } catch (err) {
    getLogger(['tangen', 'api', 'ext-settings']).warn(`extension '${extensionId}' onSettingsChange failed: ${(err as Error).message}`)
  }
}

export async function serveExtensionSettings(ctx: any, method: 'GET' | 'POST', extensionId: string): Promise<unknown> {
  const { memberId, workspaceId } = ctx
  const manifest = getExtensionManifest(extensionId)
  const deps = extensionWiringDeps()
  if (!manifest?.settings || !deps) throw new RequestError('NOT_FOUND', 'Route not found', 404)
  // Inactive here: indistinguishable from an absent route, before any authority question.
  if (!(await deps.isActive(extensionId, workspaceId))) throw new RequestError('NOT_FOUND', 'Route not found', 404)
  requireCapability({ permissions: ctx.permissions, memberId }, 'manage:settings')
  const key = connectionsScopeFor(workspaceId)?.key
  if (!key) throw new RequestError('NOT_FOUND', 'Settings are not available for this workspace', 404)
  const extCtx = await deps.buildCtx(extensionId, workspaceId)
  const server = getExtensionServer(extensionId)
  const service = createExtensionSettings({
    extensionId, manifest, server: server ?? null, store: extCtx.store, key,
    grants: effectiveGrants(extensionId, workspaceId),
    // An operator's save is the only thing that tells the extension: a write
    // the extension makes itself goes through its own settings surface, not
    // this route, so a hook cannot loop.
    onChanged: (changed) => { void notifySettingsChange(extensionId, server, extCtx, changed) },
  })
  if (method === 'POST') {
    const body = ctx.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('VALIDATION_ERROR', 'Request body must be an object of settings', 422)
    await service.update(body as Record<string, unknown>)
  }
  return service.read()
}
