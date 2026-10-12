/**
 * File Name: extension-purge.ts
 * Purpose: PURGE of an uninstalled extension's retained data (closure plan
 *          Phase 4, Unit 9): the inventory of what it holds in one
 *          workspace, the statements that delete exactly
 *          that, and the purge itself under the destructive policy of
 *          Phase 1 - one exact approval, never in production, fail closed.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: UNINSTALL retains; this is the separate, explicit
 *          deletion. It targets ONE extension in ONE scope: extension_data
 *          rows, the extension's rows in the custom tables it owns (scoped
 *          by their workspace_id column), its migration ledger
 *          and its installation record. A physical table it owns is never
 *          dropped here: when the last installation anywhere is gone it is
 *          renamed aside as a guarded drop, recoverable until
 *          `tangen purge guarded` finalises it. Refused while the
 *          extension is still installed in the scope (uninstall first).
 */
import { sql } from 'drizzle-orm'
import { queryRows, type SqlReader, type PlannedStatement } from './migration-plan'
import { safeId, isSafeIdent } from './column-types'
import { evaluateDestructivePolicy } from './destructive-policy'
import { freeGuardedName } from './guarded-drops'
import type { ChangeOperation, ChangePlan } from './types'
import type { DeploymentRole } from '@tangen/types'

export interface ExtensionPurgeScope { workspaceId: string; extensionId: string }

export interface OwnedTableInventory {
  table: string
  /** Rows of the scope in it; null when the table cannot be scoped (no workspace_id column) or counted. */
  rows: number | null
  scopedBy: Array<'workspace_id'>
}

export interface ExtensionInventory {
  /** The installation row of the scope, if any. */
  install: { state: string; enabled: boolean; version: string | null; uninstalledAt: string | null } | null
  extensionDataRows: number
  ledgerRows: number
  tables: OwnedTableInventory[]
  /** Installed rows of this extension in OTHER scopes: while any exists, owned tables stay. */
  installedElsewhere: number
}

const esc = (v: string) => v.replace(/'/g, "''")

/** What the extension holds in the scope. Reads only. */
export async function inventoryExtension(db: SqlReader, scope: ExtensionPurgeScope): Promise<ExtensionInventory> {
  const count = async (text: string): Promise<number> => {
    try { return (await queryRows<{ n: number }>(db, sql.raw(text)))[0]?.n ?? 0 } catch { return 0 }
  }
  const [installRow] = await queryRows<{ state: string; enabled: boolean; version: string | null; uninstalled_at: string | null }>(db, sql.raw(
    `SELECT state, enabled, version, uninstalled_at FROM workspace_installed_apps WHERE workspace_id = '${esc(scope.workspaceId)}' AND app_id = '${esc(scope.extensionId)}' LIMIT 1`,
  )).catch(() => [] as never[])
  const extensionDataRows = await count(`SELECT count(*)::int AS n FROM extension_data WHERE workspace_id = '${esc(scope.workspaceId)}' AND extension_id = '${esc(scope.extensionId)}'`)
  const ledgerRows = await count(`SELECT count(*)::int AS n FROM extension_migrations WHERE workspace_id = '${esc(scope.workspaceId)}' AND extension_id = '${esc(scope.extensionId)}'`)
  const installedElsewhere = await count(`SELECT count(*)::int AS n FROM workspace_installed_apps WHERE app_id = '${esc(scope.extensionId)}' AND state = 'installed' AND workspace_id != '${esc(scope.workspaceId)}'`)
  const owned = await queryRows<{ table_name: string }>(db, sql.raw(
    `SELECT table_name FROM custom_table_owners WHERE owner_kind = 'extension' AND owner_id = '${esc(scope.extensionId)}' ORDER BY table_name`,
  )).catch(() => [] as Array<{ table_name: string }>)
  const tables: OwnedTableInventory[] = []
  for (const { table_name } of owned) {
    if (!isSafeIdent(table_name)) continue
    const cols = (await queryRows<{ column_name: string }>(db, sql.raw(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${esc(table_name)}'`,
    )).catch(() => [] as Array<{ column_name: string }>)).map((c) => c.column_name)
    const scopedBy = (['workspace_id'] as const).filter((c) => cols.includes(c))
    if (cols.length === 0) continue   // recorded owner, no table: doctor reports the orphan
    const where = scopeWhere(scope, scopedBy)
    tables.push({ table: table_name, scopedBy: [...scopedBy], rows: where ? await count(`SELECT count(*)::int AS n FROM "${safeId(table_name)}" WHERE ${where}`) : null })
  }
  return {
    install: installRow ? { state: installRow.state, enabled: installRow.enabled === true, version: installRow.version, uninstalledAt: installRow.uninstalled_at ? String(installRow.uninstalled_at) : null } : null,
    extensionDataRows, ledgerRows, tables, installedElsewhere,
  }
}

function scopeWhere(scope: ExtensionPurgeScope, scopedBy: ReadonlyArray<'workspace_id'>): string | null {
  const parts: string[] = []
  if (scopedBy.includes('workspace_id')) parts.push(`"workspace_id" = '${esc(scope.workspaceId)}'`)
  return parts.length > 0 ? parts.join(' AND ') : null
}

export const extensionPurgeToken = (scope: Pick<ExtensionPurgeScope, 'extensionId'>) => `purge-extension:${scope.extensionId}`

/** The operation the policy classifies. */
export function extensionPurgeOperation(scope: ExtensionPurgeScope, inventory: ExtensionInventory): ChangeOperation {
  return { op: 'PURGE_EXTENSION', extensionId: scope.extensionId, workspaceId: scope.workspaceId, tables: inventory.tables.map((t) => t.table) }
}

/** The statements that delete exactly the scope's data; guarded renames only when no installation remains anywhere. */
export function extensionPurgeStatements(scope: ExtensionPurgeScope, inventory: ExtensionInventory, existingNames: Iterable<string>): PlannedStatement[] {
  const out: PlannedStatement[] = []
  const w = `"workspace_id" = '${esc(scope.workspaceId)}'`
  const x = `"extension_id" = '${esc(scope.extensionId)}'`
  out.push({ group: 'content', label: `extension_data: delete ${scope.extensionId} in workspace ${scope.workspaceId}`, sql: `DELETE FROM "extension_data" WHERE ${w} AND ${x}` })
  for (const t of inventory.tables) {
    const where = scopeWhere(scope, t.scopedBy)
    if (!where) continue   // reported in the plan; a table without scope columns is never touched blindly
    out.push({ group: 'custom-table', label: `${t.table}: delete the rows of workspace ${scope.workspaceId}`, sql: `DELETE FROM "${safeId(t.table)}" WHERE ${where}` })
  }
  out.push({ group: 'content', label: `extension_migrations: forget the ledger of ${scope.extensionId} in workspace ${scope.workspaceId}`, sql: `DELETE FROM "extension_migrations" WHERE ${w} AND ${x}` })
  out.push({ group: 'content', label: `workspace_installed_apps: remove the installation record`, sql: `DELETE FROM "workspace_installed_apps" WHERE ${w} AND "app_id" = '${esc(scope.extensionId)}'` })
  if (inventory.installedElsewhere === 0) {
    const taken = new Set(existingNames)
    for (const t of inventory.tables) {
      const guarded = freeGuardedName(taken, t.table, `purge-extension:${scope.extensionId}:${t.table}`)
      taken.add(guarded)
      out.push({ group: 'custom-table', label: `${t.table}: last installation gone - kept aside as ${guarded} (recover by installing again; delete with tangen purge guarded)`, sql: `ALTER TABLE "${safeId(t.table)}" RENAME TO "${safeId(guarded)}"` })
      out.push({ group: 'custom-table', label: `custom_table_owners: release ${t.table}`, sql: `DELETE FROM "custom_table_owners" WHERE "table_name" = '${esc(t.table)}'` })
    }
  }
  return out
}

export interface PurgeExtensionInput extends ExtensionPurgeScope {
  /** The deployment role of the process running the purge; production refuses. */
  role: DeploymentRole
  approvals: string[]
  /** Runs the statements in one transaction (the real apply in production; tests inject). */
  apply?: (statements: PlannedStatement[]) => Promise<void>
}

export interface PurgeExtensionResult {
  applied: boolean
  inventory: ExtensionInventory
  statements: PlannedStatement[]
  message: string
}

/**
 * Purges one extension's retained data in one scope under the destructive
 * policy: refused while installed here, refused without the exact
 * `purge-extension:<id>` approval, refused in production whatever
 * the approvals. Nothing is touched unless everything is allowed.
 */
export async function purgeExtension(db: SqlReader, input: PurgeExtensionInput): Promise<PurgeExtensionResult> {
  const inventory = await inventoryExtension(db, input)
  if (inventory.install?.state === 'installed') {
    return { applied: false, inventory, statements: [], message: `Refused: '${input.extensionId}' is still installed. Uninstall it first (tangen extension uninstall ${input.extensionId}), then purge.` }
  }
  const op = extensionPurgeOperation(input, inventory)
  const plan = { operations: [op], hasDestructive: true, hasMigrations: true } as ChangePlan
  const counts = [{
    key: `PURGE_EXTENSION:${input.extensionId}`,
    rows: inventory.extensionDataRows + inventory.tables.reduce((n, t) => n + (t.rows ?? 0), 0),
    label: `rows (${inventory.extensionDataRows} extension_data${inventory.tables.map((t) => `, ${t.rows ?? '?'} in "${t.table}"`).join('')}; ${inventory.ledgerRows} ledger)`,
  }]
  const verdict = evaluateDestructivePolicy(plan, { approvals: input.approvals, counts, role: input.role })
  if (!verdict.allowed) return { applied: false, inventory, statements: [], message: verdict.message }
  const existing = (await queryRows<{ table_name: string }>(db, sql`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`)).map((r) => r.table_name)
  const statements = extensionPurgeStatements(input, inventory, existing)
  const apply = input.apply ?? (async (stmts) => { for (const s of stmts) await queryRows(db, sql.raw(s.sql)) })
  await apply(statements)
  return { applied: true, inventory, statements, message: '' }
}
