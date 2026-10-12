/**
 * File Name: regenerate-artifacts.ts
 * Purpose: The pure half of `tangen schema regenerate`: turns an environment's
 *          registry into the SchemaDefinition the push generator reads (in the
 *          order local code declares, so the output is byte-identical to what
 *          a successful push would have written), and diffs two generated
 *          files table by table for the "what changed" print-out.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: No IO. The command (commands/schema-regenerate.ts)
 *          reads the registry, applies the doctor guard and writes through
 *          push-pipeline's writePushArtifacts.
 */
import type { SchemaDefinition } from '@tangen/types'
import type { GeneratedSnapshot } from '@tangen/schema'
import type { RuntimeSchema } from './types'
import { c, sym } from './ui'

type TypeDef = SchemaDefinition['types'][number]
type FieldDef = TypeDef['fields'][number]

/**
 * The registry as a SchemaDefinition for codegen. Types and fields follow the
 * order of `localOrder` (the local schema) where names match - that is the
 * order push used when it last wrote the file - with registry-only entries
 * appended in registry (creation / position) order.
 */
export function schemaFromRegistry(runtime: RuntimeSchema, localOrder?: SchemaDefinition | null): SchemaDefinition {
  const typeRank = new Map<string, number>()
  const fieldRank = new Map<string, Map<string, number>>()
  for (const [i, t] of (localOrder?.types ?? []).entries()) {
    typeRank.set(t.name, i)
    fieldRank.set(t.name, new Map(t.fields.map((f, j) => [f.name, j])))
  }
  const byRank = <T extends { name: string }>(items: T[], rank: Map<string, number> | undefined): T[] => {
    if (!rank) return items
    return items
      .map((item, i) => ({ item, key: rank.has(item.name) ? rank.get(item.name)! : rank.size + i }))
      .sort((a, b) => a.key - b.key)
      .map((x) => x.item)
  }
  const types: TypeDef[] = byRank(runtime.types, typeRank).map((t) => ({
    id: t.id,
    name: t.name,
    label: t.label,
    ...(t.plural ? { plural: t.plural } : {}),
    singleton: t.singleton,
    ...(t.disabled ? { disabled: true } : {}),
    ...(t.localized ? { localized: true } : {}),
    previousName: t.previousNames,
    admin: t.adminConfig as TypeDef['admin'],
    fields: byRank(t.fields, fieldRank.get(t.name)).map((f): FieldDef => ({
      name: f.name,
      label: f.label,
      fieldType: f.fieldType as FieldDef['fieldType'],
      config: f.config as FieldDef['config'],
      previousName: f.previousNames,
      required: f.required,
      ...(f.disabled ? { disabled: true } : {}),
    })),
  }))
  return { types }
}

export interface ArtifactDiff {
  tablesAdded: string[]
  tablesRemoved: string[]
  /** Per table present in both: the column names added and removed. */
  columns: Record<string, { added: string[]; removed: string[] }>
  changed: boolean
}

function diffTables(before: Record<string, { columns: Record<string, unknown> }>, after: Record<string, { columns: Record<string, unknown> }>): ArtifactDiff {
  const diff: ArtifactDiff = { tablesAdded: [], tablesRemoved: [], columns: {}, changed: false }
  for (const name of Object.keys(after)) if (!before[name]) diff.tablesAdded.push(name)
  for (const name of Object.keys(before)) if (!after[name]) diff.tablesRemoved.push(name)
  for (const name of Object.keys(after)) {
    if (!before[name]) continue
    const was = new Set(Object.keys(before[name].columns))
    const now = new Set(Object.keys(after[name].columns))
    const added = [...now].filter((col) => !was.has(col))
    const removed = [...was].filter((col) => !now.has(col))
    if (added.length || removed.length) diff.columns[name] = { added, removed }
  }
  diff.changed = diff.tablesAdded.length > 0 || diff.tablesRemoved.length > 0 || Object.keys(diff.columns).length > 0
  return diff
}

/** What regenerating changes, table by table: main tables and side tables together. */
export function diffGeneratedSnapshots(before: GeneratedSnapshot, after: GeneratedSnapshot): ArtifactDiff {
  const main = diffTables(before.tables, after.tables)
  const side = diffTables(before.i18nTables, after.i18nTables)
  return {
    tablesAdded: [...main.tablesAdded, ...side.tablesAdded],
    tablesRemoved: [...main.tablesRemoved, ...side.tablesRemoved],
    columns: { ...main.columns, ...side.columns },
    changed: main.changed || side.changed,
  }
}

/** One line per table that changed, push-style. */
export function renderArtifactDiff(diff: ArtifactDiff): string[] {
  const lines: string[] = []
  for (const t of diff.tablesAdded) lines.push(`  ${sym.add}  ${c.cyan(t)}  ${c.dim('table added')}`)
  for (const t of diff.tablesRemoved) lines.push(`  ${sym.remove}  ${c.cyan(t)}  ${c.dim('table removed from the file')}`)
  for (const [t, cols] of Object.entries(diff.columns)) {
    const parts: string[] = []
    if (cols.added.length) parts.push(`${sym.add} ${cols.added.join(', ')}`)
    if (cols.removed.length) parts.push(`${sym.remove} ${cols.removed.join(', ')}`)
    lines.push(`  ${sym.change}  ${c.cyan(t)}  ${parts.join(c.dim('  '))}`)
  }
  return lines
}
