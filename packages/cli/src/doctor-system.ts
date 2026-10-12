/**
 * File Name: doctor-system.ts
 * Purpose: Doctor's view of the system tables an optional capability needs
 *          (freeze review C4). The expectation is DERIVED from @tangen/db's
 *          declarations, never listed here by hand: a knowledge table or
 *          column the migration declares and the database lacks is a finding
 *          with the command that fixes it, and a vector table that cannot
 *          exist because pgvector is not enabled is named as the operator
 *          prerequisite it is. The push ledger's integrity (push-history.ts)
 *          is reported the same way.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Runs only when knowledge is enabled for the
 *          environment - an optional capability that is off owes the
 *          database nothing. Findings ride the same DriftReport as the
 *          content checks so `--json` and the exit code need no second path.
 */
import { getTableColumns } from 'drizzle-orm'
import {
  KNOWLEDGE_TABLES, knowledgeMeta, knowledgeChunks, knowledgeQa, knowledgeQueries, knowledgeSchemaAdvice,
  type KnowledgeSchemaStatus, type KnowledgeTable,
} from '@tangen/db'
import type { DbSnapshot, DriftFinding, DriftReport, DriftSeverity } from '@tangen/schema'
import type { PushHistory } from './push-history'
import { unavailableSettings, RETIRED_ROUTES, type ExtensionSettingsDefinition } from '@tangen/types'

/** The canonical declarations, by physical table name. */
const KNOWLEDGE_DECLARATIONS: Record<KnowledgeTable, unknown> = {
  knowledge_meta: knowledgeMeta,
  knowledge_chunks: knowledgeChunks,
  knowledge_qa: knowledgeQa,
  knowledge_queries: knowledgeQueries,
}

/** Column names @tangen/db declares for a knowledge table. */
export function declaredKnowledgeColumns(table: KnowledgeTable): string[] {
  return Object.values(getTableColumns(KNOWLEDGE_DECLARATIONS[table] as never) as Record<string, { name: string }>).map((c) => c.name)
}

export interface SystemSchemaInputs {
  db: DbSnapshot
  knowledge: { enabled: boolean; status: KnowledgeSchemaStatus }
}

const MIGRATE_FIX = "run Tangen's migrations: start the API (they run at boot unless TANGEN_SKIP_MIGRATE=1) or `bun run db:migrate` in packages/db"

/** The findings for the knowledge tables; none when knowledge is off. */
export function checkSystemSchema(inputs: SystemSchemaInputs): DriftFinding[] {
  if (!inputs.knowledge.enabled) return []
  const { status } = inputs.knowledge
  const findings: DriftFinding[] = []
  for (const name of KNOWLEDGE_TABLES) {
    const table = inputs.db.tables[name]
    if (!table) {
      if (name === 'knowledge_chunks' && !status.vectorInstalled) {
        findings.push({
          code: 'KNOWLEDGE_PGVECTOR_MISSING', severity: 'error', pair: 'config/db', subject: name,
          cause: 'knowledge is enabled but pgvector is not enabled in this database, so the vector table cannot exist; indexing and search fail with this message',
          fix: knowledgeSchemaAdvice(status),
        })
        continue
      }
      findings.push({
        code: 'SYSTEM_TABLE_MISSING', severity: 'error', pair: 'config/db', subject: name,
        cause: 'declared by @tangen/db (migration 0041) and missing from the database; knowledge cannot run',
        fix: MIGRATE_FIX,
      })
      continue
    }
    for (const col of declaredKnowledgeColumns(name)) {
      if (col in table.columns) continue
      findings.push({
        code: 'SYSTEM_COLUMN_MISSING', severity: 'error', pair: 'config/db', subject: `${name}.${col}`,
        cause: 'declared by @tangen/db and missing from the table; queries that read it fail',
        fix: MIGRATE_FIX,
      })
    }
  }
  return findings
}

/** The findings for the push ledger: a row that does not verify is an error; rows before checksums are noted. */
export function checkPushHistory(history: PushHistory): DriftFinding[] {
  const findings: DriftFinding[] = []
  for (const m of history.mismatches) {
    findings.push({
      code: 'PUSH_HISTORY_MISMATCH', severity: 'error', pair: 'db', subject: `schema_pushes.${m.id}`,
      cause: `the ${m.status} push of ${m.startedAt} recorded checksum ${m.recorded.slice(0, 12)} but its stored plan and statements fingerprint to ${m.computed.slice(0, 12)}: the ledger was edited or corrupted after the fact, and push refuses this environment`,
      fix: 'restore the row from a backup of schema_pushes (plan_json, statements_json, checksum); see docs/architecture/database-safety.md, "Migration history"',
    })
  }
  if (history.legacy > 0) {
    findings.push({
      code: 'PUSH_HISTORY_UNVERIFIED', severity: 'info', pair: 'db', subject: 'schema_pushes',
      cause: `${history.legacy} push${history.legacy === 1 ? '' : 'es'} predate checksums and cannot be verified; every push since carries one`,
      fix: 'nothing to do: legacy rows are accepted as they are and never rewritten',
    })
  }
  return findings
}

/** The content report plus the system findings, counts and `clean` recomputed. */


export interface ExtensionRetentionInputs {
  /** Retired installations with what they left behind. */
  tombstones: Array<{ extensionId: string; uninstalledAt: string | null; extensionDataRows: number; ledgerRows: number; tables: string[] }>
  /** Custom tables an extension owns while no installation of it remains anywhere. */
  orphanTables: Array<{ table: string; extensionId: string; version: string | null }>
  /** Failed migration ledger rows. */
  failedMigrations: Array<{ extensionId: string; migrationId: string; error: string | null }>
}

/**
 * Extension retention findings (closure plan Phase 4, Unit 9): what an
 * uninstall retained (info, with the purge command), tables no
 * installation owns (warning), and migrations that failed (error).
 */
export function checkExtensionRetention(inputs: ExtensionRetentionInputs): DriftFinding[] {
  const out: DriftFinding[] = []
  for (const t of inputs.tombstones) {
    const held = [`${t.extensionDataRows} extension_data row${t.extensionDataRows === 1 ? '' : 's'}`, ...(t.tables.length > 0 ? [`rows in ${t.tables.map((x) => `"${x}"`).join(', ')}`] : []), `${t.ledgerRows} ledger row${t.ledgerRows === 1 ? '' : 's'}`]
    out.push({
      code: 'EXTENSION_DATA_RETAINED', severity: 'info', pair: 'db', subject: t.extensionId,
      cause: `'${t.extensionId}' was uninstalled${t.uninstalledAt ? ` on ${t.uninstalledAt}` : ''} and its data is retained: ${held.join(', ')}`,
      fix: `keep it (a reinstall adopts it), or delete it: tangen purge extension ${t.extensionId} --approve purge-extension:${t.extensionId}`,
    })
  }
  for (const o of inputs.orphanTables) {
    out.push({
      code: 'EXTENSION_TABLE_ORPHANED', severity: 'warn', pair: 'db', subject: o.table,
      cause: `"${o.table}" is owned by extension '${o.extensionId}'${o.version ? `@${o.version}` : ''}, which is installed nowhere`,
      fix: `install the extension again to reclaim it, or purge it (tangen purge extension ${o.extensionId} ...) so the table is kept aside as a guarded drop`,
    })
  }
  for (const f of inputs.failedMigrations) {
    out.push({
      code: 'EXTENSION_MIGRATION_FAILED', severity: 'error', pair: 'db', subject: `${f.extensionId}:${f.migrationId}`,
      cause: `migration '${f.migrationId}' of '${f.extensionId}' failed: ${f.error ?? 'unknown error'}; the extension is not active until it applies`,
      fix: `fix the migration and run: tangen extension upgrade ${f.extensionId}`,
    })
  }
  return out
}

export interface ExtensionSettingsGrantInputs {
  extensionId: string
  settings: ExtensionSettingsDefinition | undefined
  /** The installation's effective grants (recorded ∩ declared, else the manifest's required). */
  effective: readonly string[]
}

/**
 * E.15: a setting that requires a grant the installation does not hold is
 * visibly unavailable everywhere, Doctor included - configuration never
 * implies authority the extension lacks.
 */
export function checkExtensionSettingsGrants(inputs: ExtensionSettingsGrantInputs[]): DriftFinding[] {
  const out: DriftFinding[] = []
  for (const ext of inputs) {
    for (const u of unavailableSettings(ext.settings, ext.effective)) {
      out.push({
        code: 'EXTENSION_SETTING_UNAVAILABLE', severity: 'info', pair: 'db', subject: `${ext.extensionId}.${u.key}`,
        cause: `the setting is disabled: it needs the optional ${u.grant} grant, which this installation was not approved`,
        fix: `tangen extension upgrade ${ext.extensionId} --approve-optional ${u.grant} (then enable it in Settings > Extensions > ${ext.extensionId})`,
      })
    }
  }
  return out
}

/**
 * E.16: every retired external URL form is reported, since Doctor cannot see
 * the outside systems that may still hold one; the fix is the replacement.
 */
export function checkRetiredRoutes(): DriftFinding[] {
  return RETIRED_ROUTES.map((r) => ({
    code: 'ROUTE_RETIRED', severity: 'info', pair: 'db', subject: `${r.method === '*' ? 'POST' : r.method} ${r.prefix}`,
    cause: `retired in ${r.since}: a request to this URL form answers 410 Gone (${r.code}); a sender that still holds one fails on purpose`,
    fix: `switch the sender to ${r.replacement} - ${r.message}`,
  }))
}

export function withSystemFindings(report: DriftReport, extra: DriftFinding[]): DriftReport {
  if (extra.length === 0) return report
  const findings = [...report.findings, ...extra]
  const counts: Record<DriftSeverity, number> = { error: 0, warn: 0, info: 0 }
  for (const f of findings) counts[f.severity]++
  return { ...report, findings, counts, clean: counts.error === 0 && counts.warn === 0 }
}
