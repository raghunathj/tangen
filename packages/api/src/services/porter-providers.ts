/**
 * File Name: porter-providers.ts
 * Purpose: The syncProvider contract - extensions (and built-in apps)
 *   register how THEIR data moves between environments, and Porter grows a
 *   generic "Extension data" surface instead of hardcoding every table.
 *   User decision 2026-08-08: DEFINITIONS ONLY - forms move without their
 *   submissions, flows move without run history, and imported flows arrive
 *   disabled (S11) so a fresh instance never fires triggers mid-import.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Providers are registered at module scope (built-ins
 *   here; extensions can call registerPorterProvider from their server
 *   module). Identity: forms match by slug in the target env (id-only PK,
 *   so a slug twin keeps its target id and a colliding id mints a new
 *   one); flows are key-value rows keyed by their store key, upserted per
 *   env. Rows are plain JSON - the export bundle carries them in
 *   providers/<key> sections.
 */
import { eq, and, sql, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { extensionData } from '@tangen/db'
import type { ExtensionStore } from '@tangen/types'
import { studioPorterProvider } from './porter-studio'
import { membersPorterProvider } from './porter-members'

export interface PorterProviderResult {
  created: number
  updated: number
  /** Per-family counts, for a provider that carries more than one kind of
   *  row (Studio's five key families). Absent means "the two totals say it
   *  all", which is true of forms, flows and every custom table. */
  counts?: Record<string, number>
  /** Rows NOT written, each with the reason. A provider that validates has
   *  to be able to say what it refused: a silent drop is how a promotion
   *  loses work nobody can account for afterwards. */
  refused?: { key: string; reason: string }[]
  /** Rows written that reference something the target does not have. */
  warnings?: { key: string; reason: string }[]
}

/** What the import side knows that a provider might need. */
export interface PorterImportContext {
  /** Bundle id -> target id for everything the plan remapped, media
   *  included. Present on the bundle path; absent on a direct promote,
   *  where nothing was remapped because nothing was copied. */
  idRemap?: Record<string, string>
  /** An extension provider's own store for the workspace (E.4); absent for a platform provider. */
  store?: ExtensionStore
}

/** What an extension provider is handed besides the rows (E.4): its own store. `db` is the platform handle only under `db:own`. */
export interface PorterProviderScope {
  store?: ExtensionStore
}

export interface PorterProvider {
  key: string
  label: string
  /** Extension whose installation gates this provider in the UI. */
  extensionId?: string
  /** Registered from an extension's server entry (E.4/E.14): Porter runs it in the extension's scope. A platform provider gated by an extension keeps the platform's handle. */
  contributed?: boolean
  /** Provider keys whose rows must import BEFORE this one so references
   *  resolve (custom tables derive this from their `references`). */
  dependsOn?: string[]
  count(db: any, workspaceId: string, scope?: PorterProviderScope): Promise<number>
  exportRows(db: any, workspaceId: string, scope?: PorterProviderScope): Promise<Record<string, unknown>[]>
  importRows(
    db: any, workspaceId: string, rows: Record<string, unknown>[],
    ctx?: PorterImportContext,
  ): Promise<PorterProviderResult>
  /** Media assets these rows reference, so the exporter puts the BYTES in
   *  the bundle's ordinary media section and the import plan remaps the ids
   *  like it does for content. Opt-in: a provider that says nothing about
   *  media keeps the behaviour it has always had. */
  mediaIds?(rows: Record<string, unknown>[]): string[]
}

const registry = new Map<string, PorterProvider>()

export function registerPorterProvider(provider: PorterProvider): void {
  registry.set(provider.key, provider)
}

export function getPorterProvider(key: string): PorterProvider | undefined {
  return registry.get(key)
}

export function listPorterProviders(): PorterProvider[] {
  return [...registry.values()]
}

let _builtinsRegistered = false

/**
 * Registers the platform's own providers (flows, custom tables, Studio).
 * Called when a server is composed - never at import (closure plan Phase 3,
 * Unit 2): importing this module leaves the registry empty. Idempotent.
 */
export function registerBuiltinPorterProviders(): void {
  if (_builtinsRegistered) return
  _builtinsRegistered = true
  registerPorterProvider({
    key: 'flows',
    label: 'Flow definitions',
    extensionId: 'flows',
    async count(db, workspaceId) {
      const rows = await db.select({ id: extensionData.id }).from(extensionData)
        .where(flowScope(workspaceId))
      return rows.length
    },
    async exportRows(db, workspaceId) {
      const rows = await db.select({ objectId: extensionData.objectId, data: extensionData.data }).from(extensionData)
        .where(flowScope(workspaceId)) as { objectId: string; data: unknown }[]
      return rows.map((r) => ({ key: r.objectId, data: r.data }))
    },
    async importRows(db, workspaceId, rows) {
      let created = 0
      let updated = 0
      for (const row of rows) {
        const key = String(row.key ?? '')
        if (!key.startsWith(FLOW_KEY_PREFIX)) continue
        const data = (row.data && typeof row.data === 'object' ? { ...(row.data as Record<string, unknown>) } : {})
        const [existing] = await db.select({ id: extensionData.id, data: extensionData.data }).from(extensionData)
          .where(and(flowScope(workspaceId), eq(extensionData.objectId, key)))
          .limit(1)
        if (existing) {
          // Updates keep the target's own enabled state - content refreshes
          // underneath, a running automation is not silently switched off.
          data.enabled = Boolean((existing.data as Record<string, unknown> | null)?.enabled)
          await db.update(extensionData).set({ data, updatedAt: new Date() })
            .where(eq(extensionData.id, existing.id))
          updated += 1
        } else {
          // S11: imported flows ARRIVE DISABLED - nothing fires mid-import.
          data.enabled = false
          await db.insert(extensionData).values({
            id: `extd_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
            extensionId: FLOWS_EXTENSION_ID,
            workspaceId,
            objectId: key,
            data,
          })
          created += 1
        }
      }
      return { created, updated }
    },
  })
  registerPorterProvider(studioPorterProvider())
  // The team. Definitions only - no password hash, no session, no key - so a
  // deployment with its own database can receive a team instead of rebuilding
  // it by hand (plan-deployment-topologies W3).
  registerPorterProvider(membersPorterProvider())
}

// ── Forms: definitions from the forms table, never form_submissions ─────────



// ── Flows: definition rows from the extension store (flow:* keys) ───────────

const FLOWS_EXTENSION_ID = 'flows'
const FLOW_KEY_PREFIX = 'flow:'


/** Store keys land in object_id; flow DEFINITIONS use the flow: prefix
 *  (run:/runmeta: rows are history and never move - definitions only). */
/**
 * Whether a query failed because the table is not there at all.
 *
 * A custom table can be declared in config and not yet pushed, which is a
 * legitimate "nothing to export". Everything else - a column that does not
 * exist because the generated registry and the passed definition disagree, a
 * dead connection - is drift or breakage, and a Porter run that swallowed it
 * would report success having moved nothing.
 */
export function isMissingTableError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null
  if (!e) return false
  if (e.code === '42P01') return true
  if (typeof e.code === 'string' && e.code !== '') return false
  const msg = String(e.message ?? '')
  return /relation ".*" does not exist|no such table/i.test(msg)
}

function flowScope(workspaceId: string) {
  return and(
    eq(extensionData.extensionId, FLOWS_EXTENSION_ID),
    eq(extensionData.workspaceId, workspaceId),
    sql`${extensionData.objectId} LIKE ${FLOW_KEY_PREFIX + '%'}`,
  )
}

// ── Studio: the workspace design system (WF-S10) ────────────────────

// Studio-SPECIFIC rather than a generic extension_data copier, by user
// decision (2026-08-25): five known key families, each parsed and validated
// against Studio's own schema. It lives in its own file because that
// validation is real code, not a shape guess - see porter-studio.ts.

// ── Custom tables: porter: true | { matchBy } opt-in on the definition ───────

interface CustomTableDefLike {
  name: string
  columns: Record<string, { kind?: string } | undefined>
  /** matchBy is required; references declare foreign keys to other
   *  porter-enabled tables - see CustomTableDefinition.porter. */
  porter?: { matchBy: string; references?: Record<string, string> }
}

/** Sidecar key the exporter writes reference natural keys under. */
const REFS_KEY = '_refs'

/** Row keys that are identity/scope, never payload. */
const TABLE_IDENTITY = new Set(['workspace_id'])

/**
 * Builds a Porter provider for one custom-table definition. Identity is the
 * REQUIRED matchBy natural-key column: a row whose key exists in the target
 * env updates in place and keeps ITS id (the analog of slug matching). The
 * id is only a secondary fallback for cross-instance imports where ids are
 * stable; creating mints a fresh id whenever the incoming id is taken.
 */
export function customTableProvider(def: CustomTableDefLike, siblings: CustomTableDefLike[] = []): PorterProvider {
  const matchBy = def.porter?.matchBy ?? null
  const timestampCols = Object.entries(def.columns ?? {})
    .filter(([, c]) => c?.kind === 'timestamp')
    .map(([name]) => name)

  // References resolve only against tables that carry their own matchBy -
  // without a natural key there is nothing portable to resolve with.
  const references = Object.entries(def.porter?.references ?? {})
    .map(([column, tableName]) => ({ column, refDef: siblings.find((s) => s.name === tableName) }))
    .filter((r): r is { column: string; refDef: CustomTableDefLike } => !!r.refDef?.porter?.matchBy)

  async function table(defLike: CustomTableDefLike = def): Promise<Record<string, any>> {
    const { resolveCustomTablePg } = await import('./custom-table-registry')
    return resolveCustomTablePg(defLike as never)
  }

  const scope = (t: Record<string, any>, workspaceId: string) =>
    eq(t.workspace_id, workspaceId)

  return {
    key: `table:${def.name}`,
    label: `${def.name} table`,
    ...(references.length > 0 ? { dependsOn: references.map((r) => `table:${r.refDef.name}`) } : {}),
    async count(db, workspaceId) {
      try {
        const t = await table()
        const rows = await db.select({ id: t.id }).from(t).where(scope(t, workspaceId))
        return rows.length
      } catch (err) {
        // Declared but not pushed yet: listable, empty. Anything else is real.
        if (isMissingTableError(err)) return 0
        throw err
      }
    },
    async exportRows(db, workspaceId) {
      try {
        const t = await table()
        const rows = await db.select().from(t).where(scope(t, workspaceId)) as Record<string, unknown>[]
        const out = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !TABLE_IDENTITY.has(k))))

        // Enrich references with the referenced row's NATURAL KEY, so the
        // import can re-resolve them against the target - ids do not
        // survive environment/instance boundaries, natural keys do.
        for (const { column, refDef } of references) {
          const ids = [...new Set(out.map((r) => r[column]).filter((v): v is string => typeof v === 'string' && v.length > 0))]
          if (ids.length === 0) continue
          const refTable = await table(refDef)
          const refKey = refDef.porter!.matchBy
          const refRows = await db.select({ id: refTable.id, key: refTable[refKey] }).from(refTable)
            .where(and(scope(refTable, workspaceId), inArray(refTable.id, ids))) as { id: string; key: unknown }[]
          const keyById = new Map(refRows.map((r) => [r.id, r.key]))
          for (const row of out) {
            const key = keyById.get(row[column] as string)
            if (key == null) continue   // dangling in the source too - stays honest
            row[REFS_KEY] = { ...(row[REFS_KEY] as Record<string, unknown> ?? {}), [column]: key }
          }
        }
        return out
      } catch (err) {
        // Same rule as count: an absent table is empty, everything else is
        // reported. A Porter export that answered [] on a broken query would
        // migrate nothing and call it success.
        if (isMissingTableError(err)) return []
        throw err
      }
    },
    async importRows(db, workspaceId, rows) {
      const t = await table()
      let created = 0
      let updated = 0
      for (const row of rows) {
        const values: Record<string, unknown> = Object.fromEntries(
          Object.entries(row).filter(([k]) => !TABLE_IDENTITY.has(k) && k !== 'id' && k !== REFS_KEY),
        )
        // Bundle round trips serialize timestamps as strings.
        for (const c of timestampCols) {
          if (typeof values[c] === 'string') values[c] = new Date(values[c] as string)
        }

        // Re-resolve declared references from their natural keys: the claim
        // follows its coupon even when the target coupon kept a different
        // id. Unresolvable keys keep the incoming value (dangling, honest).
        const refs = (row as Record<string, unknown>)[REFS_KEY] as Record<string, unknown> | undefined
        if (refs) {
          for (const { column, refDef } of references) {
            const key = refs[column]
            if (key == null) continue
            const refTable = await table(refDef)
            const [target] = await db.select({ id: refTable.id }).from(refTable)
              .where(and(scope(refTable, workspaceId), eq(refTable[refDef.porter!.matchBy], key)))
              .limit(1)
            if (target) values[column] = target.id
          }
        }

        let existingId: string | null = null
        if (matchBy && row[matchBy] != null && t[matchBy] !== undefined) {
          const [hit] = await db.select({ id: t.id }).from(t)
            .where(and(scope(t, workspaceId), eq(t[matchBy], row[matchBy])))
            .limit(1)
          if (hit) existingId = hit.id as string
        }
        if (!existingId && row.id) {
          const [hit] = await db.select({ id: t.id }).from(t)
            .where(and(scope(t, workspaceId), eq(t.id, row.id)))
            .limit(1)
          if (hit) existingId = hit.id as string
        }

        if (existingId) {
          // The matched target row keeps ITS id - references stay valid.
          await db.update(t).set(values)
            .where(and(scope(t, workspaceId), eq(t.id, existingId)))
          updated += 1
        } else {
          const sourceId = String(row.id ?? '') || randomUUID()
          const [idTaken] = await db.select({ id: t.id }).from(t).where(eq(t.id, sourceId)).limit(1)
          await db.insert(t).values({
            ...values,
            id: idTaken ? randomUUID() : sourceId,
            workspace_id: workspaceId,
          })
          created += 1
        }
      }
      return { created, updated }
    },
  }
}

interface WorkspaceProjectLike {
  config?: { customTables?: CustomTableDefLike[] }
}

/**
 * Every provider available to a workspace: the static registry (forms,
 * flows, extension-registered) plus one per porter-flagged env-isolated
 * custom table from the project config.
 */
/**
 * Is the extension that owns a provider active in the scope? Built by
 * `porterActivePredicate` (services/extension-server.ts) for one workspace x
 * environment; a provider owned by nothing, or by a feature that is not a
 * manifest extension, is always offered. Absent: no gating (tests, tools).
 */
export type ProviderActivePredicate = (extensionId: string) => boolean

export function resolveWorkspaceProviders(project: WorkspaceProjectLike | undefined, active?: ProviderActivePredicate): PorterProvider[] {
  const defs = project?.config?.customTables ?? []
  const custom = defs
    // matchBy is the contract: no natural key, no provider (id matching
    // would duplicate rows on every same-instance re-sync).
    .filter((d) => !!d.porter?.matchBy)
    .map((d) => customTableProvider(d, defs))
  // Phase 4, Unit 11: a provider of an extension that is not active in the
  // scope is not offered and not run - a disabled extension leaves nothing behind.
  const offered = [...registry.values()].filter((p) => !p.extensionId || !active || active(p.extensionId))
  return [...offered, ...custom]
}

export function getWorkspaceProvider(
  project: WorkspaceProjectLike | undefined,
  key: string,
  active?: ProviderActivePredicate,
): PorterProvider | undefined {
  return resolveWorkspaceProviders(project, active).find((p) => p.key === key)
}

/**
 * Parents before children so references resolve on first pass. Kahn-style
 * with a stable fallback: unknown dependencies are ignored and cycles fall
 * back to input order - the sort never loses or blocks a key.
 */
export function sortProvidersByDependency(
  keys: string[],
  dependsOnFor: (key: string) => string[],
): string[] {
  const inSet = new Set(keys)
  const sorted: string[] = []
  const done = new Set<string>()
  let remaining = [...keys]
  while (remaining.length > 0) {
    const ready = remaining.filter((k) =>
      dependsOnFor(k).every((dep) => !inSet.has(dep) || done.has(dep)))
    // Cycle: nothing is ready - emit the rest in input order and stop.
    const batch = ready.length > 0 ? ready : remaining
    for (const k of batch) { sorted.push(k); done.add(k) }
    remaining = remaining.filter((k) => !done.has(k))
  }
  return sorted
}
