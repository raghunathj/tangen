/**
 * File Name: workspace-apps.ts
 * Purpose: Manages workspace extension installation — provides routes to list, install, and
 * uninstall built-in extensions for a workspace, plus a registry listing endpoint.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, Drizzle ORM (workspaceInstalledApps), Node.js crypto
 * (randomBytes), @tangen/types (extension registry helpers), ./errors (RequestError).
 */
import { Elysia } from 'elysia'
import { installExecFromDb, listInstalls, readInstall, installExtension, uninstallExtension, discardInstall } from '../../services/extension-install-state'
import { extensionWiringDeps } from '../../services/extension-server'
import { setEnabled, upgradeExtension, uninstall, DependantsError, ProviderClashError } from '../../services/extension-lifecycle'
import type { TangenExtensionManifest } from '@tangen/types'
import { getExtensionManifest, getExtensionLifecycle, listRegisteredExtensionIds, getExtensionMigrations } from '../../hooks/app-hooks-registry'
import { runExtensionMigrations, migrationDbFromDrizzle } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { checkForUpdate, packageOf, clearUpdateCache, registryUrl } from '../../services/extension-updates'
import { deriveExtensionId } from './list'

/**
 * The gate on every extension lifecycle action. Installing runs the extension's
 * `onInstall`, changes which capabilities, routes and content types the
 * workspace has, and under extension DDL will cause schema planning;
 * uninstalling runs `onUninstall`. None of that is an ordinary content write,
 * and it was gated on nothing but an authenticated member.
 *
 * `manage:settings` rather than a new capability: it is what already gates
 * schema-write.ts, the other path that causes DDL, and `hasCapability` passes
 * owners and admin sessions, so no existing role loses access. If a workspace
 * ever needs "may change settings but may not install code" as a distinct
 * grant, that is a deliberate split, not this commit.
 *
 * Called FIRST in each handler, before the registry lookup and before any
 * database call, so an unauthorised caller cannot reach a resolution step that
 * loads extension code, cannot learn what is installable, and cannot run a
 * lifecycle hook.
 */
function assertExtensionAdmin(ctx: any, workspaceIdFromPath: string): void {
  requireCapability(ctx, 'manage:settings')
  // The workspace came from the URL and was never compared to the authenticated
  // one, so a member of any workspace could install into any other.
  if (ctx.workspaceId && workspaceIdFromPath !== ctx.workspaceId) {
    throw new RequestError('FORBIDDEN', 'This session is not authorized for that workspace', 403)
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** What the Extensions screen shows for one installation. */
export interface ExtensionInventoryRow {
  extensionId: string
  name: string
  description?: string
  author?: string
  homepage?: string
  license?: string
  /** An icon NAME from the manifest, for the Admin's icon set. */
  icon?: string
  /** A connector pack's own brand mark (a data: URI), which is an image. */
  brandIcon?: string
  kind: 'extension' | 'connector-pack'
  /** The version this installation RUNS. */
  version: string | null
  /** The version the code in this project ships; newer means an upgrade is pending here. */
  codeVersion: string | null
  state: string
  enabled: boolean
  /** Declares typed settings, so the screen offers the gear. */
  settings: boolean
  /** The npm package this came from, or null for a path in the project. */
  package: string | null
  options: Record<string, unknown>
  installedAt: unknown
  installedBy: string | null
  upgradedAt: unknown
  uninstalledAt: unknown
}

/**
 * The mark an extension is recognised by, from wherever it declared one. An
 * extension names its icon for the surface it builds - a nav entry, an editor
 * panel, a dashboard widget - and a CONNECTOR PACK carries a brand image
 * instead, the provider's own logo. Reading only one of those left every
 * extension wearing the default puzzle piece (the user, 2026-09-20).
 */
export function extensionGlyph(manifest: {
  pages?: Array<{ nav?: { icon?: string } }>
  sidebarPanels?: Array<{ icon?: string }>
  dashboardWidgets?: Array<{ icon?: string }>
  connectors?: Array<{ brand?: { icon?: string } }>
} | undefined): { icon?: string; brandIcon?: string } {
  if (!manifest) return {}
  const brand = manifest.connectors?.find((c) => typeof c?.brand?.icon === 'string')?.brand?.icon
  // Only an inline image: a manifest must never point the Admin at a remote
  // URL to load, and never at a scheme a browser would execute.
  const brandIcon = typeof brand === 'string' && /^data:image\//i.test(brand) ? brand : undefined
  const named = manifest.pages?.find((p) => p?.nav?.icon)?.nav?.icon
    ?? manifest.sidebarPanels?.find((p) => p?.icon)?.icon
    ?? manifest.dashboardWidgets?.find((w) => w?.icon)?.icon
  return {
    ...(typeof named === 'string' && /^Icon[A-Za-z0-9]+$/.test(named) ? { icon: named } : {}),
    ...(brandIcon ? { brandIcon } : {}),
  }
}

/**
 * One installation row plus what its manifest says about itself. Pure: the
 * route hands over the install row, the manifest (or nothing, when the code
 * is not present) and how the project resolved it.
 *
 * A row whose manifest is missing is still listed: an extension whose package
 * was removed from the project while its data remains is exactly what an
 * operator needs to see, and hiding it would make the state unexplainable.
 */
export function inventoryRow(
  row: { extensionId: string; version: string | null; state: string; enabled: boolean; options: Record<string, unknown>; installedAt?: unknown; installedBy?: string | null; upgradedAt?: unknown; uninstalledAt?: unknown },
  manifest: Partial<TangenExtensionManifest> & { sidebarPanels?: Array<{ icon?: string }>; pages?: Array<{ nav?: { icon?: string } }> } | undefined,
  resolve: string | null,
): ExtensionInventoryRow {
  return {
    extensionId: row.extensionId,
    name: manifest?.name ?? row.extensionId,
    ...(manifest?.description ? { description: manifest.description } : {}),
    ...(manifest?.author ? { author: manifest.author } : {}),
    ...(manifest?.homepage ? { homepage: manifest.homepage } : {}),
    ...(manifest?.license ? { license: manifest.license } : {}),
    ...extensionGlyph(manifest as never),
    kind: manifest?.kind === 'connector-pack' ? 'connector-pack' : 'extension',
    version: row.version ?? null,
    codeVersion: manifest?.version ?? null,
    state: row.state,
    enabled: row.enabled,
    settings: manifest?.settings !== undefined,
    package: packageOf(resolve),
    options: row.options ?? {},
    installedAt: row.installedAt ?? null,
    installedBy: row.installedBy ?? null,
    upgradedAt: row.upgradedAt ?? null,
    uninstalledAt: row.uninstalledAt ?? null,
  }
}

/** How the project resolved each extension id, for the package name. */
export function resolveMap(declared: Array<{ resolve?: string }> | undefined, idOf: (resolve: string) => string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of declared ?? []) {
    if (typeof entry?.resolve !== 'string') continue
    out[idOf(entry.resolve)] = entry.resolve
  }
  return out
}

export interface InstallPayload {
  extensionId: string
  options: Record<string, unknown>
}

/**
 * Validates and normalises the raw request body for an extension install request.
 * Accepts either `extensionId` or the legacy `appId` field name.
 * @param body - Raw request body (should be a plain object).
 * @returns A validated InstallPayload with trimmed extensionId and defaults applied.
 * @throws RequestError(422) when the body is malformed or required fields are missing.
 */
export function buildInstallPayload(body: unknown): InstallPayload {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError('VALIDATION_ERROR', 'Request body must be an object', 422)
  }
  const b = body as Record<string, unknown>

  const rawId = b.extensionId ?? b.appId
  if (rawId === undefined || rawId === null) {
    throw new RequestError('VALIDATION_ERROR', 'extensionId is required', 422)
  }
  if (typeof rawId !== 'string' || (rawId as string).trim() === '') {
    throw new RequestError('VALIDATION_ERROR', 'extensionId must be a non-empty string', 422)
  }
  if (b.options !== undefined && b.options !== null) {
    if (typeof b.options !== 'object' || Array.isArray(b.options)) {
      throw new RequestError('VALIDATION_ERROR', 'options must be an object', 422)
    }
  }

  return {
    extensionId: (rawId as string).trim(),
    options: (b.options as Record<string, unknown>) ?? {},
  }
}

/**
 * Looks up an extension by ID in the built-in extension registry.
 * @param extensionId - The extension ID to resolve.
 * @returns The matching TangenExtensionManifest.
 * @throws RequestError(404) when the extension ID is not registered.
 */
export function resolveInstallableExtension(extensionId: string): TangenExtensionManifest {
  const ext = getExtensionManifest(extensionId)
  if (!ext) {
    throw new RequestError('NOT_FOUND', `Extension '${extensionId}' is not configured - add it to app/config/extensions.ts first`, 404)
  }
  return ext
}

/**
 * Validates that an extension manifest's `id` field is globally unique
 * among all registered extensions. Called at extension creation / registration time.
 * Throws if a conflict is detected.
 *
 * Convention enforced: extension IDs must be scoped to avoid collisions.
 * First-party (@tangen/*): use short ids like 'seo', 'analytics'.
 * Third-party: must prefix with their namespace, e.g. 'acme.seo', 'acme-analytics'.
 * @param id - The extension ID to check for uniqueness.
 * @param allExtensions - Full list of registered extension manifests to check against.
 * @throws RequestError(409) when a duplicate ID is detected.
 */
export function assertExtensionIdUnique(id: string, allExtensions: TangenExtensionManifest[]): void {
  const conflict = allExtensions.filter((e) => e.id === id)
  if (conflict.length > 1) {
    throw new RequestError(
      'CONFLICT',
      `Extension id '${id}' is already used by another extension. ` +
      `Third-party extensions must use a namespaced id (e.g. 'acme.seo' not 'seo').`,
      409,
    )
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────


/**
 * Elysia plugin providing extension install/uninstall endpoints for a workspace.
 * Routes: GET /extensions (list), POST /extensions (install), DELETE /extensions/:id (uninstall).
 * @param app - The parent Elysia instance to extend.
 * @returns The extended Elysia instance with the routes registered.
 */
export const workspaceAppsRoutes = (app: Elysia) =>
  app
    .get('/api/v1/admin/workspaces/:workspaceId/extensions', async (ctx: any) => {
      const { db, params } = ctx
      const wsId = params.workspaceId as string
      const all = ctx.query?.all === '1' || ctx.query?.all === 'true'

      // The per-environment rows (Phase 4). Retired rows (uninstalled, data
      // retained) are listed only on request: the default answer is what is
      // installed here.
      const rows = (await listInstalls(installExecFromDb(db), { workspaceId: wsId }))
        .filter((row) => all || row.state === 'installed')

      // How the project declared each one, for the package name the update
      // check asks about.
      const project = ((ctx.workspaceProjects ?? []) as any[]).find((p: any) => p.workspaceId === wsId)
      const resolves = resolveMap(project?.declaredExtensions, deriveExtensionId)

      const data = rows.map((row) => ({
        id: row.id,
        ...inventoryRow(row, getExtensionManifest(row.extensionId) as never, resolves[row.extensionId] ?? null),
      }))

      return { data }
    })

    /**
     * What the registry has, asked ON DEMAND (the user, 2026-09-20). Nothing
     * here runs on its own: a screen that phones a registry every time it
     * opens is a screen that leaks its existence, so the operator clicks.
     *
     * `?force=1` drops the cached answers first, for "I just published it".
     */
    .post('/api/v1/admin/workspaces/:workspaceId/extensions/updates', async (ctx: any) => {
      const wsId = ctx.params.workspaceId as string
      assertExtensionAdmin(ctx, wsId)
      if (ctx.query?.force === '1' || ctx.query?.force === 'true') clearUpdateCache()

      const rows = (await listInstalls(installExecFromDb(ctx.db), { workspaceId: wsId })).filter((r) => r.state === 'installed')
      const project = ((ctx.workspaceProjects ?? []) as any[]).find((p: any) => p.workspaceId === wsId)
      const resolves = resolveMap(project?.declaredExtensions, deriveExtensionId)

      const data = await Promise.all(rows.map(async (row) => ({
        extensionId: row.extensionId,
        ...(await checkForUpdate({
          package: packageOf(resolves[row.extensionId] ?? null),
          current: row.version ?? getExtensionManifest(row.extensionId)?.version ?? null,
        })),
      })))
      return { data, registry: registryUrl() }
    })

    .post('/api/v1/admin/workspaces/:workspaceId/extensions', async (ctx: any) => {
      const { body, db, params, memberId, set } = ctx
      const wsId = params.workspaceId as string
      assertExtensionAdmin(ctx, wsId)

      const payload = buildInstallPayload(body)
      const manifest = resolveInstallableExtension(payload.extensionId)
      const exec = installExecFromDb(db)
      const scope = { workspaceId: wsId, extensionId: payload.extensionId }

      // INSTALL is per environment: the admin's current environment.
      const existing = await readInstall(exec, scope)
      if (existing?.state === 'installed') {
        throw new RequestError('CONFLICT', `Extension '${payload.extensionId}' is already installed in ${wsId}`, 409)
      }
      const result = await installExtension(exec, { ...scope, version: manifest.version, options: payload.options, installedBy: memberId ?? null })
      extensionWiringDeps()?.invalidate?.()
      await extensionWiringDeps()?.host?.reconcile(payload.extensionId)

      // INSTALL runs the extension's pending migrations, ledgered per
      // scope; a failure rolls the install back and keeps the failed row
      // as the diagnosis (docs/architecture/extension-lifecycle.md).
      const declared = getExtensionMigrations(payload.extensionId) ?? []
      if (declared.length > 0) {
        const run = await runExtensionMigrations(migrationDbFromDrizzle(db), { ...scope, extensionVersion: manifest.version, migrations: declared })
        if (!run.ok) {
          await discardInstall(exec, scope, result.outcome === 'adopted' ? 'adopted' : 'installed')
          extensionWiringDeps()?.invalidate?.()
          await extensionWiringDeps()?.host?.reconcile(payload.extensionId)
          throw new RequestError('INSTALL_FAILED', run.message, 500)
        }
      }

      // onInstall lifecycle - a failing hook rolls the install back (no half-installs).
      const lifecycle = getExtensionLifecycle(payload.extensionId)
      if (typeof lifecycle?.onInstall === 'function') {
        try {
          await lifecycle.onInstall({ workspaceId: wsId })
        } catch (err) {
          await discardInstall(exec, scope, result.outcome === 'adopted' ? 'adopted' : 'installed')
          extensionWiringDeps()?.invalidate?.()
          await extensionWiringDeps()?.host?.reconcile(payload.extensionId)
          throw new RequestError('INSTALL_FAILED', `onInstall failed: ${(err as Error).message}`, 500)
        }
      }

      set.status = 201
      return {
        data: {
          id: result.row.id,
          extensionId: payload.extensionId,
          name: manifest.name,
          version: manifest.version,
          enabled: result.row.enabled,
          adopted: result.outcome === 'adopted',
          options: payload.options,
        },
      }
    })

    // ENABLE / DISABLE in the admin's current environment (Unit 8).
    .patch('/api/v1/admin/workspaces/:workspaceId/extensions/:extensionId', async (ctx: any) => {
      const { params, body } = ctx
      const wsId = params.workspaceId as string
      const extensionId = params.extensionId as string
      assertExtensionAdmin(ctx, wsId)
      const enabled = (body as { enabled?: unknown } | undefined)?.enabled
      if (typeof enabled !== 'boolean') throw new RequestError('VALIDATION_ERROR', 'Body must be { enabled: boolean }', 422)
      const deps = extensionWiringDeps()?.lifecycle
      if (!deps) throw new RequestError('UNAVAILABLE', 'Extension lifecycle is not wired in this process', 503)
      let ok: boolean
      try { ok = await setEnabled(deps, { workspaceId: wsId, extensionId }, enabled) }
      catch (err) {
        if (err instanceof DependantsError) throw new RequestError('CONFLICT', err.message, 409)
        // A1: enabling a pack whose provider another active pack owns.
        if (err instanceof ProviderClashError) throw new RequestError('PROVIDER_CONFLICT', err.message, 409)
        throw err
      }
      if (!ok) throw new RequestError('NOT_FOUND', `Extension '${extensionId}' is not installed in ${wsId}`, 404)
      return { data: { extensionId, enabled } }
    })

    // UPGRADE to the registered version, in the admin's current environment (Unit 8).
    .post('/api/v1/admin/workspaces/:workspaceId/extensions/:extensionId/upgrade', async (ctx: any) => {
      const { params, set } = ctx
      const wsId = params.workspaceId as string
      const extensionId = params.extensionId as string
      assertExtensionAdmin(ctx, wsId)
      const deps = extensionWiringDeps()?.lifecycle
      if (!deps) throw new RequestError('UNAVAILABLE', 'Extension lifecycle is not wired in this process', 503)
      const result = await upgradeExtension(deps, { workspaceId: wsId, extensionId })
      if (!result.ok) {
        set.status = result.failed?.step === 'plan' ? 409 : 500
        return { error: { code: 'UPGRADE_FAILED', message: result.message, status: set.status }, data: { extensionId, version: result.version, applied: result.applied, failed: result.failed } }
      }
      return { data: { extensionId, from: result.plan.from, to: result.plan.to, version: result.version, applied: result.applied, running: result.running, noop: result.plan.noop, message: result.message } }
    })

    .delete('/api/v1/admin/workspaces/:workspaceId/extensions/:extensionId', async (ctx: any) => {
      const { db, params, set } = ctx
      const wsId = params.workspaceId as string
      const extensionId = params.extensionId as string
      assertExtensionAdmin(ctx, wsId)
      const exec = installExecFromDb(db)

      // UNINSTALL retires the row of THIS environment; extension data stays
      // (docs/architecture/extension-lifecycle.md). PURGE is separate. The
      // lifecycle service stops the runtime first and refuses while an
      // active extension requires this one; without it (a process with no
      // runtime wiring) the row is retired directly.
      const lifecycleDeps = extensionWiringDeps()?.lifecycle
      let retired: boolean
      try {
        // K8.6: the lifecycle path also revokes the extension's connections, cancels its queued jobs and announces
        // extension.uninstalled with the ledger; the response stays a 204, the ledger is logged and on the event.
        retired = lifecycleDeps ? (await uninstall(lifecycleDeps, { workspaceId: wsId, extensionId })).retired : await uninstallExtension(exec, { workspaceId: wsId, extensionId })
      } catch (err) {
        if (err instanceof DependantsError) throw new RequestError('CONFLICT', err.message, 409)
        throw err
      }
      if (!retired) {
        throw new RequestError('NOT_FOUND', `Extension '${extensionId}' is not installed in ${wsId}`, 404)
      }
      extensionWiringDeps()?.invalidate?.()

      // onUninstall lifecycle - failures never resurrect the row; log-and-continue
      const lifecycle = getExtensionLifecycle(extensionId)
      if (typeof lifecycle?.onUninstall === 'function') {
        try {
          await lifecycle.onUninstall({ workspaceId: wsId })
        } catch { /* uninstall is already complete - hook failure is advisory */ }
      }

      set.status = 204
      return null
    })

/**
 * Elysia plugin providing GET /api/v1/admin/extensions/registry.
 * Returns a summary of every built-in extension available for installation,
 * including its field-type and sidebar-panel contributions.
 * @param app - The parent Elysia instance to extend.
 * @returns The extended Elysia instance with the registry route registered.
 */
export const installableAppsRoute = (app: Elysia) =>
  app.get('/api/v1/admin/extensions/registry', (_ctx: any) => {
    return {
      data: listRegisteredExtensionIds()
        .map((id) => getExtensionManifest(id)!)
        .filter(Boolean)
        .map((m) => ({
          id: m.id,
          name: m.name,
          version: m.version,
          description: m.description,
          fieldTypes: m.fieldTypes?.map((f) => ({ name: f.name, label: f.label, icon: f.icon })),
          sidebarPanels: m.sidebarPanels?.map((p) => ({ id: p.id, label: p.label, icon: p.icon })),
        })),
    }
  })
