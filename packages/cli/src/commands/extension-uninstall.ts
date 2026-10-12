/**
 * File Name: extension-uninstall.ts
 * Purpose: Implements `tangen extension uninstall` and `tangen extension list`,
 *   completing the registry-extension lifecycle (install → list → uninstall).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Mirrors extension-install.ts — `workspace_installed_apps`
 *   is the single source of truth; uninstalling deletes the row (idempotent).
 *   Role permission grants that reference the extension are intentionally NOT
 *   touched: they become inert while the extension is absent (the admin roles
 *   editor shows them as disabled "(inactive)" pills) and re-apply on
 *   reinstall. Extension data tables are never dropped here — extensions own
 *   their storage and document their own teardown.
 */
import type { TangenExtensionManifest } from '@tangen/types'

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Human line for `extension list` — "seo  SEO Toolkit  (installed)". */
export function formatExtensionLine(
  ext: { id: string; name: string },
  installed: boolean,
): string {
  return `  ${ext.id.padEnd(16)} ${ext.name.padEnd(28)} ${installed ? 'installed' : '-'}`
}

// ── Commands ──────────────────────────────────────────────────────────────────

/**
 * Removes a built-in extension from the workspace (idempotent — a missing
 * installation logs and returns). The registry manifest is looked up only for
 * the friendly name; unknown ids still uninstall cleanly so stale rows from
 * removed registry entries can always be cleared.
 */
export async function runExtensionUninstallCommand(
  extensionId: string,
  workspaceId: string,
  databaseUrl: string,
  available: Array<TangenExtensionManifest & { __dir?: string }> = [],
  log: (msg: string) => void = console.log,
  opts: { db?: any } = {},
): Promise<void> {
  const { createDb, workspaceInstalledApps } = await import('@tangen/db')
  const { eq, and } = await import('drizzle-orm')

  const db = opts.db ?? createDb(databaseUrl)
  try {
    // UNINSTALL retires the row; extension data stays until an explicit,
    // approved purge.
    const [existing] = await db
      .select({ id: workspaceInstalledApps.id })
      .from(workspaceInstalledApps)
      .where(
        and(
          eq(workspaceInstalledApps.workspaceId, workspaceId),
          eq(workspaceInstalledApps.appId, extensionId),
          eq(workspaceInstalledApps.state, 'installed'),
        ),
      )
      .limit(1)

    if (!existing) {
      log(`[tangen] Extension '${extensionId}' is not installed in workspace '${workspaceId}' - nothing to do`)
      return
    }

    // Refused while an active extension in this workspace requires this one (Phase 4, Unit 9).
    const { scopeActivation } = await import('./extension-lifecycle')
    const { activeDependantsOf } = await import('@tangen/types')
    const { activation, manifests } = await scopeActivation({ db, workspaceId, available: available as never, log })
    const blocking = activeDependantsOf(extensionId, manifests, activation)
    if (blocking.length > 0) {
      throw new Error(`'${extensionId}' cannot be uninstalled: ${blocking.map((d) => `'${d}'`).join(', ')} require${blocking.length === 1 ? 's' : ''} it. Uninstall or disable ${blocking.length === 1 ? 'it' : 'them'} first.`)
    }

    await db
      .update(workspaceInstalledApps)
      .set({ state: 'uninstalled', enabled: false, uninstalledAt: new Date() })
      .where(eq(workspaceInstalledApps.id, existing.id))

    // onUninstall lifecycle — failures warn (the row is already gone)
    const manifest = available.find((e) => e.id === extensionId)
    if (manifest?.server && manifest.__dir) {
      try {
        const { join } = await import('node:path')
        const mod = await import(join(manifest.__dir, manifest.server))
        const server = mod.default ?? mod
        if (typeof server?.onUninstall === 'function') {
          await server.onUninstall({ workspaceId })
          log(`[tangen]   onUninstall hook completed`)
        }
      } catch (err) {
        log(`[tangen]   warning: onUninstall failed - ${(err as Error).message}`)
      }
    }

    const name = manifest?.name ?? extensionId
    log(`[tangen] ✓ Uninstalled ${name} (${extensionId}) from workspace '${workspaceId}'; its data is retained`)
    log(`[tangen]   Role grants referencing it stay on the roles (shown as inactive) and re-apply on reinstall.`)
  } finally {
    if (!opts.db) await db.end()
  }
}

/**
 * Lists registry extensions with their install state for the workspace.
 */
export async function runExtensionListCommand(
  workspaceId: string,
  databaseUrl: string,
  available: TangenExtensionManifest[] = [],
  log: (msg: string) => void = console.log,
  opts: { db?: any } = {},
): Promise<void> {
  const { createDb, listInstalls, installExecFromDb } = await import('@tangen/db')
  const db = opts.db ?? createDb(databaseUrl)
  try {
    const rows = await listInstalls(installExecFromDb(db), { workspaceId })
    const byId = new Map(rows.map((r) => [r.extensionId, r]))

    log(`[tangen] Extensions for workspace '${workspaceId}':`)
    const known = new Set(available.map((e) => e.id))
    for (const ext of available) {
      const row = byId.get(ext.id)
      const state = !row ? 'not installed' : row.state !== 'installed' ? 'uninstalled (data retained)' : row.enabled ? 'installed, enabled' : 'installed, disabled'
      const version = row?.version && row.version !== ext.version ? `${row.version} -> ${ext.version}` : ext.version
      log(`  ${ext.id.padEnd(16)} ${(ext.name ?? '').slice(0, 26).padEnd(28)} ${String(version).padEnd(18)} ${state}`)
    }
    // Rows whose configured extension no longer exists (config entry removed)
    for (const [appId, row] of byId) {
      if (!known.has(appId)) log(`  ${appId.padEnd(16)} ${'(not configured - entry removed?)'.padEnd(28)} ${String(row.version ?? '?').padEnd(18)} ${row.state === 'installed' ? 'installed' : 'uninstalled (data retained)'}`)
    }
    log(`[tangen] 'tangen extension status' explains why an extension is not active.`)
  } finally {
    if (!opts.db) await db.end()
  }
}
