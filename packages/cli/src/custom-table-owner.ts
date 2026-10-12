/**
 * File Name: custom-table-owner.ts
 * Purpose: Who owns a custom table, carried from the declaration that asked for
 *   it all the way to the plan, the statements and the ledger.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. Ownership is not inferred from a name prefix and it
 *   is never adopted by declaring: an extension that declares a table somebody
 *   else already owns is refused, not made a co-owner.
 *
 *   The durable record is the `custom_table_owners` table, keyed by table name
 *   alone, and that key is the honest description of the architecture: a
 *   physical table is instance-global. Installing an extension in a second
 *   workspace does not create a second table; it finds the one that is already
 *   there. Rows inside it stay workspace- and environment-scoped, as they
 *   always were.
 *
 *   A table with no recorded owner is `unclaimed`, which is not the same as
 *   unowned. Every custom table that existed before this registry is unclaimed,
 *   so an extension declaring one of those names is refused rather than handed
 *   a table full of somebody else's data.
 */
import type { CustomTableDefinition } from '@tangen/types'

export type CustomTableOwner =
  /** Declared by the site's own `tangen.config.ts` or a workspace config. */
  | { kind: 'site' }
  /** Declared by an installed extension's manifest. */
  | { kind: 'extension'; id: string; version: string }

export interface NormalizedCustomTable {
  table: CustomTableDefinition
  owner: CustomTableOwner
}

/** A row of `custom_table_owners`, as the database holds it. */
export interface RecordedOwner {
  tableName: string
  ownerKind: string
  ownerId: string | null
  ownerVersion: string | null
}

export const ownerLabel = (o: CustomTableOwner): string =>
  o.kind === 'extension' ? `extension ${o.id}@${o.version}` : 'the site schema'

export const sameOwner = (a: CustomTableOwner, b: CustomTableOwner): boolean =>
  a.kind === 'site' ? b.kind === 'site' : b.kind === 'extension' && a.id === b.id

/**
 * One list from every source, with ownership attached and every collision
 * refused rather than resolved.
 *
 * Site declarations win nothing and lose nothing by ordering: two sources
 * claiming one name is an error whichever way round it is, because silently
 * letting the last one define the table is exactly the failure this exists to
 * prevent.
 */
export function normalizeCustomTables(
  site: CustomTableDefinition[],
  fromExtensions: Array<{ extensionId: string; version: string; tables: CustomTableDefinition[] }>,
): { tables: NormalizedCustomTable[]; errors: string[] } {
  const byName = new Map<string, NormalizedCustomTable>()
  const errors: string[] = []

  const claim = (table: CustomTableDefinition, owner: CustomTableOwner) => {
    const held = byName.get(table.name)
    if (!held) { byName.set(table.name, { table, owner }); return }
    if (held.owner.kind === 'site' && owner.kind === 'site') return   // config merge, as before
    errors.push(
      `custom table "${table.name}" is declared by ${ownerLabel(held.owner)} and by ${ownerLabel(owner)}. ` +
      `Two owners cannot share one physical table: rename one of them.`,
    )
  }

  for (const t of site) if (t?.name) claim(t, { kind: 'site' })
  for (const ext of fromExtensions) {
    for (const t of ext.tables) {
      if (t?.name) claim(t, { kind: 'extension', id: ext.extensionId, version: ext.version })
    }
  }
  return { tables: [...byName.values()], errors }
}

/**
 * Declarations that contradict what the database already records. Refusing here
 * is what stops a table being taken over by declaring its name.
 */
export function ownershipConflicts(
  tables: NormalizedCustomTable[],
  recorded: RecordedOwner[],
  tableExists: (name: string) => boolean,
): string[] {
  const byName = new Map(recorded.map((r) => [r.tableName, r]))
  const errors: string[] = []
  for (const { table, owner } of tables) {
    const row = byName.get(table.name)
    if (row) {
      const held: CustomTableOwner = row.ownerKind === 'extension'
        ? { kind: 'extension', id: row.ownerId ?? '', version: row.ownerVersion ?? '' }
        : { kind: 'site' }
      if (!sameOwner(held, owner)) {
        errors.push(
          `custom table "${table.name}" is owned by ${ownerLabel(held)}, but ${ownerLabel(owner)} declares it. ` +
          `Ownership is never transferred by declaring a name.`,
        )
      }
      continue
    }
    // No record, but the table is physically there: it predates this registry,
    // or something outside Tangen made it. An extension may not adopt it.
    if (owner.kind === 'extension' && tableExists(table.name)) {
      errors.push(
        `custom table "${table.name}" already exists and Tangen has no record of who owns it, so ` +
        `${ownerLabel(owner)} cannot claim it. Rename the extension's table, or declare this one in the site schema first.`,
      )
    }
  }
  return errors
}

/**
 * The same extension resolved at two versions in one project. DDL is
 * instance-global while installation is per workspace, so two versions would be
 * two definitions of one physical table and whichever push ran last would win.
 * Reported rather than resolved: coexistence is a design, not a tie-break.
 */
export function versionSkew(
  fromExtensions: Array<{ extensionId: string; version: string; tables: CustomTableDefinition[] }>,
): string[] {
  const byId = new Map<string, Set<string>>()
  for (const e of fromExtensions) {
    if (e.tables.length === 0) continue
    const seen = byId.get(e.extensionId) ?? new Set<string>()
    seen.add(e.version)
    byId.set(e.extensionId, seen)
  }
  const out: string[] = []
  for (const [id, versions] of byId) {
    if (versions.size > 1) {
      out.push(
        `extension "${id}" is resolved at ${[...versions].sort().join(' and ')} in this project, and both declare custom tables. ` +
        `A physical table is shared by every workspace, so two versions would be two definitions of one table.`,
      )
    }
  }
  return out
}

/** Custom tables the database still records an owner for that nobody declares. */
export function orphanedCustomTables(
  tables: NormalizedCustomTable[],
  recorded: RecordedOwner[],
): Array<{ table: string; owner: string }> {
  const declared = new Set(tables.map((t) => t.table.name))
  return recorded
    .filter((r) => r.ownerKind === 'extension' && !declared.has(r.tableName))
    .map((r) => ({ table: r.tableName, owner: `${r.ownerId}${r.ownerVersion ? `@${r.ownerVersion}` : ''}` }))
}
