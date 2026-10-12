/**
 * File Name: column-namespace.ts
 * Purpose: One name per column per type. Group sub-fields are stored as flat
 *          columns beside the type's top-level fields, so a name declared
 *          twice - at the top level and inside a group, or inside two groups -
 *          is two declarations of ONE column. A schema like that used to pass
 *          the type-check, have its plan applied to the database, and only
 *          then die in content-tables codegen with "duplicate column(s) ...
 *          this is a generator bug". This validator reports each collision
 *          where the schema is declared, naming both declarations and the
 *          fix, and also refuses the built-in platform columns (id, title,
 *          slug, status, workspace_id, ...) under any field.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Flattens exactly the way codegen does - flattenGroupFields
 *          (the expansion defineObjectType performs) followed by the group-
 *          marker skip every column consumer applies - so the names it checks
 *          are the names the generated table would carry. Accepts both the raw
 *          declaration shape (sub-fields only inside config.groupFields, as the
 *          Schema Builder posts it) and the flattened shape defineObjectType
 *          returns. Rows loaded back from the database carry no group markers
 *          and, being unique per (type, name), cannot hold a collision - do not
 *          feed them here.
 */
import { RESERVED_FIELD_NAMES, type FieldDefinition } from '@tangen/types'
import { flattenGroupFields } from './define-object-type'

/**
 * Every name a content table already owns, in BOTH spellings: the SQL column
 * (`workspace_id`, what CREATE TABLE would duplicate) and the Drizzle property
 * codegen's systemCols() declares (`workspaceId`, what the generated table
 * literal would duplicate). A user field under either spelling collides.
 */
const RESERVED_COLUMN_NAMES: ReadonlySet<string> = new Set([
  ...RESERVED_FIELD_NAMES,
  ...[...RESERVED_FIELD_NAMES].map((n) => n.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())),
])

/** How one occurrence of a name was declared, for the message. */
function describe(f: FieldDefinition): string {
  if (f.group) return `inside group "${f.group}"`
  if (f.fieldType === 'group') return `as the group "${f.name}"`
  return 'as a top-level field'
}

function list(parts: string[]): string {
  return parts.length <= 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * Reports every field name that would map to the same column (or the same
 * `fields` row) more than once in a type, and every field whose name is a
 * built-in column. Returns human-readable strings, one per problem, in the
 * order the declarations appear; [] means the namespace is clean.
 */
export function validateColumnNamespace(
  types: ReadonlyArray<{ name: string; fields?: ReadonlyArray<{ name?: unknown; fieldType?: unknown; config?: unknown; group?: unknown }> }>,
): string[] {
  const issues: string[] = []
  for (const t of types) {
    const flat = flattenGroupFields((t.fields ?? []) as unknown as FieldDefinition[])
    const byName = new Map<string, FieldDefinition[]>()
    for (const f of flat) {
      if (typeof f.name !== 'string') continue
      const arr = byName.get(f.name) ?? []
      arr.push(f)
      byName.set(f.name, arr)
    }
    for (const [name, decls] of byName) {
      if (decls.length > 1) {
        const count = decls.length === 2 ? 'twice' : `${decls.length} times`
        // The top-level declaration reads first; the groups follow in
        // declaration order (the message tells the reader which to keep).
        const ordered = [...decls.filter((d) => !d.group), ...decls.filter((d) => d.group)]
        issues.push(
          `${t.name}: "${name}" is declared ${count} - ${list(ordered.map(describe))}. `
          + 'Group fields are stored as flat columns, so a name may appear once per type. '
          + 'Keep one declaration (the group keeps the editor section).',
        )
      }
      if (RESERVED_COLUMN_NAMES.has(name)) {
        const where = decls[0].group ? ` (inside group "${decls[0].group}")` : ''
        issues.push(`${t.name}: "${name}"${where} is a built-in column every content type already has - rename the field.`)
      }
    }
  }
  return issues
}
