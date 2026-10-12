/**
 * File Name: extension-install-state.ts
 * Purpose: The installation state of an extension in a workspace - installed,
 *          enabled, version, options, uninstalled - as the one table
 *          `workspace_installed_apps` holds it. Installed, enabled and
 *          active are distinct: a row exists once installed, `enabled`
 *          switches it, and active means installed AND enabled.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Scope is the WORKSPACE (tasks/remove-environments-programme.md):
 *          an extension is installed in a deployment's database for a
 *          workspace, and every request in that workspace sees the same
 *          installation. `InstallExec` is a raw statement runner so the CLI,
 *          the API and PGlite tests share one implementation.
 */
import { and, eq } from 'drizzle-orm'
import { workspaceInstalledApps } from './schema/workspace-installed-apps'

export type InstallExec = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>

export function installExecFromDb(db: unknown): InstallExec {
  const d = db as { $rawClient?: { unsafe: (t: string, p: unknown[]) => Promise<unknown[]> }; session?: { client?: { unsafe: (t: string, p: unknown[]) => Promise<unknown[]> } }; $client?: { query: (t: string, p: unknown[]) => Promise<{ rows: unknown[] }> } }
  const raw = d.$rawClient ?? d.session?.client
  if (raw && typeof raw.unsafe === 'function') return async (text, params) => (await raw.unsafe(text, params ?? [])) as Array<Record<string, unknown>>
  const pg = d.$client ?? (d.session?.client as unknown as { query?: (t: string, p: unknown[]) => Promise<{ rows: unknown[] }> } | undefined)
  if (pg && typeof pg.query === 'function') { const q = pg.query.bind(pg); return async (text, params) => (await q(text, params ?? [])).rows as Array<Record<string, unknown>> }
  throw new Error('installExecFromDb: not a drizzle client this platform knows')
}

export type ExtensionInstallState = 'installed' | 'uninstalled'

export interface ExtensionInstallRow {
  id: string
  workspaceId: string
  extensionId: string
  state: ExtensionInstallState
  enabled: boolean
  version: string | null
  options: Record<string, unknown>
  installedAt: Date | string
  installedBy: string | null
  upgradedAt: Date | string | null
  uninstalledAt: Date | string | null
  /** K5.2a: the grants an operator approved; null = not reviewed; undefined = the table has no such column yet. */
  grantedGrants?: string[] | null
}

export interface InstallScope { workspaceId: string; extensionId: string }

const COLS = `id, workspace_id, app_id, options, state, enabled, version, installed_at, installed_by, upgraded_at, uninstalled_at`

function rowOf(r: Record<string, unknown>): ExtensionInstallRow {
  return {
    id: String(r.id), workspaceId: String(r.workspace_id), extensionId: String(r.app_id),
    state: (r.state as ExtensionInstallState) ?? 'installed', enabled: r.enabled === true || r.enabled === 't',
    version: (r.version as string | null) ?? null,
    options: (typeof r.options === 'string' ? JSON.parse(r.options) : r.options ?? {}) as Record<string, unknown>,
    installedAt: r.installed_at as Date | string, installedBy: (r.installed_by as string | null) ?? null,
    upgradedAt: (r.upgraded_at as Date | string | null) ?? null, uninstalledAt: (r.uninstalled_at as Date | string | null) ?? null,
    ...('granted_grants' in r ? { grantedGrants: parseGrants(r.granted_grants) } : {}),
  }
}

function parseGrants(v: unknown): string[] | null {
  const parsed = typeof v === 'string' ? JSON.parse(v) : v
  return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : null
}

export async function readInstall(exec: InstallExec, scope: InstallScope): Promise<ExtensionInstallRow | null> {
  const rows = await exec(`SELECT ${COLS} FROM workspace_installed_apps WHERE workspace_id = $1 AND app_id = $2 LIMIT 1`, [scope.workspaceId, scope.extensionId])
  if (!rows[0]) return null
  const row = rowOf(rows[0])
  const grants = await listGrantedGrants(exec, scope)
  return scope.extensionId in grants ? { ...row, grantedGrants: grants[scope.extensionId] ?? null } : row
}

/**
 * K5.2a: the approval record per installed extension of a scope. Read in
 * its own statement so a database whose migration has not run (or a test's
 * hand-built table) answers "nothing recorded" instead of failing every
 * install read.
 */
export async function listGrantedGrants(exec: InstallExec, scope: { workspaceId: string; extensionId?: string }): Promise<Record<string, string[] | null>> {
  try {
    const rows = scope.extensionId
      ? await exec(`SELECT app_id, granted_grants FROM workspace_installed_apps WHERE workspace_id = $1 AND app_id = $2 AND state = 'installed'`, [scope.workspaceId, scope.extensionId])
      : await exec(`SELECT app_id, granted_grants FROM workspace_installed_apps WHERE workspace_id = $1 AND state = 'installed'`, [scope.workspaceId])
    const out: Record<string, string[] | null> = {}
    for (const r of rows) out[String(r.app_id)] = parseGrants(r.granted_grants)
    return out
  } catch {
    return {}
  }
}

/** K5.2a: record (or clear, with null) the grants an operator approved for an installation. */
export async function recordGrantedGrants(exec: InstallExec, scope: InstallScope, grants: readonly string[] | null): Promise<void> {
  await exec(
    `UPDATE workspace_installed_apps SET granted_grants = $3::jsonb WHERE workspace_id = $1 AND app_id = $2`,
    [scope.workspaceId, scope.extensionId, grants ? JSON.stringify([...grants]) : null],
  )
}

export async function listInstalls(exec: InstallExec, scope: { workspaceId: string }): Promise<ExtensionInstallRow[]> {
  const rows = await exec(`SELECT ${COLS} FROM workspace_installed_apps WHERE workspace_id = $1 ORDER BY app_id`, [scope.workspaceId])
  return rows.map(rowOf)
}

export async function isExtensionActive(exec: InstallExec, scope: InstallScope): Promise<boolean> {
  const rows = await exec(`SELECT 1 AS one FROM workspace_installed_apps WHERE workspace_id = $1 AND app_id = $2 AND state = 'installed' AND enabled = true LIMIT 1`, [scope.workspaceId, scope.extensionId])
  return rows.length > 0
}

export async function activeExtensionIdsDb(db: unknown, scope: { workspaceId: string }): Promise<string[]> {
  const d = db as { select: (cols: Record<string, unknown>) => { from: (t: unknown) => { where: (w: unknown) => Promise<Array<{ appId: string }>> } } }
  const rows = await d
    .select({ appId: workspaceInstalledApps.appId })
    .from(workspaceInstalledApps)
    .where(and(
      eq(workspaceInstalledApps.workspaceId, scope.workspaceId),
      eq(workspaceInstalledApps.state, 'installed'),
      eq(workspaceInstalledApps.enabled, true),
    ))
  return rows.map((r) => r.appId)
}

export async function activeExtensionIds(exec: InstallExec, scope: { workspaceId: string }): Promise<string[]> {
  const rows = await exec(`SELECT app_id FROM workspace_installed_apps WHERE workspace_id = $1 AND state = 'installed' AND enabled = true ORDER BY app_id`, [scope.workspaceId])
  return rows.map((r) => String(r.app_id))
}

export interface InstallInput {
  workspaceId: string
  extensionId: string
  version: string | null
  options?: Record<string, unknown>
  installedBy?: string | null
  enabled?: boolean
  /** K5.2a: the grants the operator approved at this install; omit to leave the installation unreviewed. */
  grants?: readonly string[] | null
}

export async function installExtension(exec: InstallExec, input: InstallInput): Promise<{ row: ExtensionInstallRow; outcome: 'installed' | 'adopted' | 'already-installed' }> {
  const existing = await readInstall(exec, input)
  const options = JSON.stringify(input.options ?? {})
  if (existing?.state === 'installed') return { row: existing, outcome: 'already-installed' }
  if (existing) {
    await exec(
      `UPDATE workspace_installed_apps SET state = 'installed', enabled = $3, version = $4, options = $5::jsonb, installed_at = now(), installed_by = $6, uninstalled_at = NULL
        WHERE workspace_id = $1 AND app_id = $2`,
      [input.workspaceId, input.extensionId, input.enabled ?? true, input.version, options, input.installedBy ?? null],
    )
    if (input.grants !== undefined) await recordGrantedGrants(exec, input, input.grants)
    return { row: (await readInstall(exec, input))!, outcome: 'adopted' }
  }
  const id = `wext_${Math.random().toString(16).slice(2, 10)}`
  await exec(
    `INSERT INTO workspace_installed_apps (id, workspace_id, app_id, options, state, enabled, version, installed_by)
      VALUES ($1, $2, $3, $4::jsonb, 'installed', $5, $6, $7)`,
    [id, input.workspaceId, input.extensionId, options, input.enabled ?? true, input.version, input.installedBy ?? null],
  )
  if (input.grants !== undefined) await recordGrantedGrants(exec, input, input.grants)
  return { row: (await readInstall(exec, input))!, outcome: 'installed' }
}

export async function setExtensionEnabled(exec: InstallExec, scope: InstallScope, enabled: boolean): Promise<boolean> {
  const rows = await exec(
    `UPDATE workspace_installed_apps SET enabled = $3 WHERE workspace_id = $1 AND app_id = $2 AND state = 'installed' RETURNING id`,
    [scope.workspaceId, scope.extensionId, enabled],
  )
  return rows.length > 0
}

export async function recordInstalledVersion(exec: InstallExec, scope: InstallScope, version: string, upgraded: boolean): Promise<void> {
  await exec(
    `UPDATE workspace_installed_apps SET version = $3${upgraded ? ', upgraded_at = now()' : ''} WHERE workspace_id = $1 AND app_id = $2`,
    [scope.workspaceId, scope.extensionId, version],
  )
}

export async function discardInstall(exec: InstallExec, scope: InstallScope, outcome: 'installed' | 'adopted'): Promise<void> {
  if (outcome === 'adopted') { await uninstallExtension(exec, scope); return }
  await exec(`DELETE FROM workspace_installed_apps WHERE workspace_id = $1 AND app_id = $2`, [scope.workspaceId, scope.extensionId])
}

export async function uninstallExtension(exec: InstallExec, scope: InstallScope): Promise<boolean> {
  const rows = await exec(
    `UPDATE workspace_installed_apps SET state = 'uninstalled', enabled = false, uninstalled_at = now() WHERE workspace_id = $1 AND app_id = $2 AND state = 'installed' RETURNING id`,
    [scope.workspaceId, scope.extensionId],
  )
  return rows.length > 0
}

/**
 * A declaration in app/config/extensions.ts makes an extension AVAILABLE and
 * nothing more: installing and enabling are explicit acts, per deployment
 * (`tangen extension install`). Boot used to adopt every declared extension
 * as installed and enabled, which put SEO and Flows in every new project's
 * sidebar before anyone asked (2026-09-07). What boot still does is learn
 * the declared version for an installed row that predates versions.
 * @returns how many rows learned a version.
 */
export async function syncDeclaredExtensionVersions(
  exec: InstallExec,
  workspaces: Array<{ workspaceId: string; extensions: Array<{ id: string; version: string }> }>,
): Promise<number> {
  let learned = 0
  for (const ws of workspaces) {
    for (const ext of ws.extensions) {
      const rows = await exec(
        `UPDATE workspace_installed_apps SET version = $3 WHERE workspace_id = $1 AND app_id = $2 AND version IS NULL RETURNING id`,
        [ws.workspaceId, ext.id, ext.version],
      )
      learned += rows.length
    }
  }
  return learned
}
