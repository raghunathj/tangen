/**
 * File Name: codegen.ts
 * Purpose: Generates the drizzle-orm `content-tables.ts` file from the local schema definition,
 * including per-type pgTable declarations and system columns.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Output is written to packages/db/src/generated/content-tables.ts.
 * The generated file is not meant to be edited manually — it is regenerated on every `tangen push`.
 * The column list per type is `flattenFields(type.fields)` from @tangen/types: the field
 * list defineObjectType already flattened (group sub-fields beside their group marker,
 * see flattenGroupFields in @tangen/schema) minus the markers. The API, diff, apply and
 * the Porter gate read the same flattened list and never expand groups on their own.
 */
import { fieldTypeToSql } from '@tangen/types'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { flattenFields, type SchemaDefinition, type FieldType, type CustomTableDefinition } from '@tangen/types'
import { localizedContainerFields } from '@tangen/schema'
import { fieldIsIndexable, fieldIndexMethod } from './column-types'
import { artifactMeta } from '@tangen/schema'
import { isSafeIdent } from '@tangen/types'

function fieldTypeToDrizzleCall(fieldType: FieldType, colName: string, config?: Record<string, unknown>): string | null {
  // ONE mapping (types/column-kinds.ts): the kind push creates is the kind the
  // generated file declares and the kind the runtime registry builds.
  switch (fieldTypeToSql(fieldType, config)) {
    case null: return null
    case 'NUMERIC': return `numeric('${colName}')`
    case 'BOOLEAN': return `boolean('${colName}')`
    case 'TIMESTAMPTZ': return `timestamp('${colName}', { withTimezone: true })`
    case 'JSONB': return `jsonb('${colName}')`
    case 'TEXT[]': return `text('${colName}').array()`
    // NUMRANGE is read and written as its string literal ("[1,10]"); PG casts on write.
    case 'NUMRANGE':
    case 'TEXT':
    default: return `text('${colName}')`
  }
}

export function generateContentTablesCode(schema: SchemaDefinition, registry: Array<Record<string, unknown>> = [], where?: { workspaceId: string }): string {
  const types = schema.types

  const tableBlocks = types.map(type => {
    // The column list: the flattened field list minus the group markers - the
    // same helper every API surface reads, so what the table carries and what
    // the runtime expects cannot drift apart.
    const columnFields = flattenFields(type.fields)
    const customCols = columnFields
      .flatMap(f => {
        const call = fieldTypeToDrizzleCall(f.fieldType, f.name, f.config as Record<string, unknown>)
        return call ? [`  ${f.name}: ${call},`] : []
      })
      .join('\n')

    // Build index declarations
    const indexDecls: string[] = []

    // Scope index — every CMS type table gets this automatically
    indexDecls.push(
      `    ${type.name}ScopeIdx: index('${type.name}_scope_idx').on(t.workspaceId, t.status, t.createdAt),`,
    )
    // Slug uniqueness, per environment - push creates the same index (slugUniqueDdl).
    indexDecls.push(
      `    ${type.name}SlugUniq: uniqueIndex('${type.name}_slug_uniq').on(t.slug).where(sql\`slug IS NOT NULL\`),`,
    )

    // `validation.unique` is enforced by the API per environment (field-validator),
    // never by a database index: one table holds every environment's rows, so a
    // unique index on the column alone would refuse the same value in two
    // environments. Nothing is declared for it here, and push creates nothing -
    // the generated file and the database agree. A field index is declared
    // exactly when push creates one (fieldIsIndexable) with the method push
    // uses (GIN on array columns) - column-mapping.test.ts pins the two lists.
    for (const f of columnFields) {
      const cfg = f.config as Record<string, unknown> | undefined
      if (cfg?.index === true && fieldIsIndexable(f.fieldType, cfg)) {
        const decl = fieldIndexMethod(f.fieldType, cfg) === 'gin'
          ? `    ${type.name}${capitalize(f.name)}Idx: index('${type.name}_${f.name}_idx').using('gin', t.${f.name}),`
          : `    ${type.name}${capitalize(f.name)}Idx: index('${type.name}_${f.name}_idx').on(t.${f.name}),`
        indexDecls.push(decl)
      }
    }

    const indexBlock = indexDecls.join('\n')
    return [
      `export const ${type.name} = pgTable('${type.name}', {`,
      `  ...systemCols(),`,
      ...(customCols ? [customCols] : []),
      `}, t => ({`,
      `    ${type.name}Pk: primaryKey({ columns: [t.id] }),`,
      indexBlock,
      `}))`,
    ].join('\n')
  })

  const registryEntries = types.map(t => `  ${t.name},`).join('\n')

  // ── i18n side tables — one per type with localized fields ──────────────────
  // Translations live as real typed columns: <type>_i18n(object_id, locale, …)
  // with the default locale staying in the main table.
  // Media fields localize at the asset level (locale variants), never in side tables
  const isLocalizedField = (f: { fieldType: string; config?: unknown }) =>
    (f.config as Record<string, unknown>)?.localized === true && f.fieldType !== 'media'
  // BL-3: container fields with localized SUB-fields carry a JSONB overlay column
  const containerCols = (t: { fields: unknown }) => localizedContainerFields(t.fields as never, registry as never)
  // A type gets an i18n side table when it opts in at the TYPE level (`localized: true`,
  // making at least the title translatable) OR when any field/container is localized.
  const localizedTypes = types.filter(t =>
    (t as { localized?: boolean }).localized === true
    || t.fields.some(isLocalizedField)
    || containerCols(t).length > 0)

  const i18nTableBlocks = localizedTypes.map(type => {
    // One column per NAME. A container field can qualify through both passes —
    // itself `localized: true` (pass 1) AND holding localized sub-fields
    // (pass 2, the BL-3 overlay) — and both emit jsonb, so the first wins.
    // Without this, `blocks: jsonb('blocks')` was emitted twice and the
    // generated file failed tsc (TS1117) while push exited 0 (finding #16).
    const emitted = new Set<string>()
    const colLines: string[] = []
    for (const f of flattenFields(type.fields).filter(isLocalizedField)) {
      const call = fieldTypeToDrizzleCall(f.fieldType, f.name, f.config as Record<string, unknown>)
      if (call && !emitted.has(f.name)) {
        emitted.add(f.name)
        colLines.push(`  ${f.name}: ${call},`)
      }
    }
    for (const name of containerCols(type)) {
      if (!emitted.has(name)) {
        emitted.add(name)
        colLines.push(`  ${name}: jsonb('${name}'),`)
      }
    }
    const cols = colLines.join('\n')
    return [
      `export const ${type.name}_i18n = pgTable('${type.name}_i18n', {`,
      `  objectId: text('object_id').notNull(),`,
      `  `,
      `  locale: text('locale').notNull(),`,
      `  __title: text('__title'),`,
      ...(cols ? [cols] : []),
      `  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),`,
      `}, t => ({`,
      `    ${type.name}I18nPk: primaryKey({ columns: [t.objectId, t.locale] }),`,
      `}))`,
    ].join('\n')
  })

  const i18nRegistryEntries = localizedTypes.map(t => `  ${t.name}: ${t.name}_i18n,`).join('\n')

  const needsPrimaryKey = types.length > 0 || localizedTypes.length > 0
  const baseImports = ['pgTable', 'text', 'numeric', 'boolean', 'timestamp', 'jsonb', 'index', 'uniqueIndex', 'sql']
  if (needsPrimaryKey) baseImports.push('primaryKey')
  const indexImports = `import { ${baseImports.join(', ')} } from '@tangen/db/schema-kit'`

  const code = [
    `// DO NOT EDIT - generated by tangen push`,
    `// Re-run \`tangen push\` to regenerate after schema changes.`,
    ``,
    indexImports,
    ``,
    `function systemCols() {`,
    `  return {`,
    `    // Identity is COMPOSITE - (id) - declared per table below.`,
    `    id:          text('id').notNull(),`,
    `    workspaceId: text('workspace_id').notNull(),`,
    `    `,
    `    title:       text('title'),`,
    `    slug:        text('slug'),`,
    `    status:          text('status').notNull().default('draft'),`,
    `    publishedAt:     timestamp('published_at', { withTimezone: true }),`,
    `    publishedBy:     text('published_by'),`,
    `    publishedValues: jsonb('published_values'),`,
    `    scheduledAt:     timestamp('scheduled_at', { withTimezone: true }),`,
    `    scheduledBy:     text('scheduled_by'),`,
    `    createdAt:   timestamp('created_at',   { withTimezone: true }).notNull().defaultNow(),`,
    `    updatedAt:   timestamp('updated_at',   { withTimezone: true }).notNull().defaultNow(),`,
    `    createdBy:   text('created_by'),`,
    `    updatedBy:   text('updated_by'),`,
    `    createdByKind:   text('created_by_kind'),`,
    `    updatedByKind:   text('updated_by_kind'),`,
    `    publishedByKind: text('published_by_kind'),`,
    `  }`,
    `}`,
    ``,
    ...(tableBlocks.length ? [...tableBlocks.flatMap(b => [b, '']), ''] : []),
    ...(i18nTableBlocks.length ? [...i18nTableBlocks.flatMap(b => [b, '']), ''] : []),
    ...(registryEntries
      ? [`export const contentTables = {`, registryEntries, `} as const`]
      : [`export const contentTables = {} as const`]),
    ``,
    ...(i18nRegistryEntries
      ? [`export const contentI18nTables = {`, i18nRegistryEntries, `} as const`]
      : [`export const contentI18nTables = {} as const`]),
    ``,
    `export type ContentTableName = keyof typeof contentTables`,
    `export type ContentTable = typeof contentTables[ContentTableName]`,
    ``,
    // Provenance (Phase 6B, Unit 3): which workspace and environment this
    // schema was pushed to, and its fingerprint, so a server can say "this
    // artifact is another environment's" instead of meeting a missing column
    // as a query error. `artifactStatus` in @tangen/schema reads it.
    ...(where
      ? [
        `export const contentTablesMeta = ${JSON.stringify(artifactMeta(schema, where), null, 2)} as const`,
        ``,
      ]
      : []),
  ].join('\n')
  assertNoDuplicateColumns(code)
  return code
}

/**
 * Refuses to return generated code with a duplicate column in any table
 * literal. A duplicate key is valid at runtime (the last one wins in JS), so
 * nothing downstream fails loudly - tsc flags TS1117 only where generated
 * files are type-checked, which `push` historically did not do. This makes the
 * command that PRODUCED the bad code the one that fails (finding #16).
 *
 * Scans line-anchored two-space-indented `name:` properties per pgTable block,
 * which is exactly the shape this generator emits.
 */
export function assertNoDuplicateColumns(code: string): void {
  const problems: string[] = []
  const re = /export const (\w+) = pgTable\('[^']+', \{\n([\s\S]*?)\n\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const seen = new Set<string>()
    for (const line of m[2].split('\n')) {
      const col = /^  (\w+):/.exec(line)?.[1]
      if (!col) continue
      if (seen.has(col)) problems.push(`${m[1]}.${col}`)
      seen.add(col)
    }
  }
  if (problems.length) {
    throw new Error(
      `content-tables codegen produced duplicate column(s): ${problems.join(', ')} - `
      + `this should have been caught by schema validation; please report it (validateColumnNamespace `
      + `checks these names before any plan or apply). The file was NOT written.`,
    )
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Custom tables → generated Drizzle registry ───────────────────────────────

// The identifier rule lives in @tangen/types (Phase 6B, Unit 7).
const IDENT_RE = { test: (s: string) => isSafeIdent(s) }

/** Valid JS identifier for the exported const; non-identifier chars become _. */
function constNameFor(tableName: string): string {
  const sanitized = tableName.replace(/[^a-zA-Z0-9_]/g, '_')
  return /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized
}

/**
 * Generate custom-tables.ts — a Drizzle pgTable per custom table, built through
 * @tangen/db/schema-kit's customTablePg() so the col.kind → drizzle-column
 * mapping lives in exactly ONE place (the same function the API uses as its
 * build-from-definition fallback). Only the shape the query layer needs
 * (name, columns) is serialized — knowledge/mcp/search config
 * stays in the workspace config.
 */
export function generateCustomTablesCode(tables: CustomTableDefinition[]): string {
  const defBlocks = tables.map((t) => {
    const def: Record<string, unknown> = { name: t.name, columns: t.columns }
    return `export const ${constNameFor(t.name)} = customTablePg(${JSON.stringify(def)})`
  })

  const registryEntries = tables.map((t) => {
    const constName = constNameFor(t.name)
    return IDENT_RE.test(t.name) && t.name === constName
      ? `  ${constName},`
      : `  ${JSON.stringify(t.name)}: ${constName},`
  }).join('\n')

  return [
    `// DO NOT EDIT - generated by tangen push`,
    `// Re-run \`tangen push\` to regenerate after custom-table changes.`,
    ``,
    ...(tables.length ? [`import { customTablePg } from '@tangen/db/schema-kit'`, ``] : []),
    ...(defBlocks.length ? [...defBlocks.flatMap(b => [b, ''])] : []),
    ...(registryEntries
      ? [`export const customTables = {`, registryEntries, `} as const`]
      : [`export const customTables = {} as const`]),
    ``,
    `export type CustomTableName = keyof typeof customTables`,
    ``,
  ].join('\n')
}

/** Write custom-tables.ts into an already-resolved generated directory
 *  (the same dir content-tables.ts goes to — see resolveContentTablesDir). */
export function writeCustomTablesToDir(tables: CustomTableDefinition[], outDir: string): void {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'custom-tables.ts'), generateCustomTablesCode(tables), 'utf8')
}

/**
 * Where the generated content-tables.ts is written:
 * - Monorepo (packages/db present) → the bundled db package (tests read this).
 * - Consumer project → <project>/app/generated/ (configCwd = the app dir),
 *   committed to git so it survives `npm i` / Tangen upgrades. NEVER node_modules.
 */
export function resolveContentTablesDir(cwd: string, configCwd: string): string {
  // Monorepo: walk up for packages/db (cwd is usually the app dir, one level
  // below the repo root). node_modules is intentionally NOT a candidate.
  let dir = cwd
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, 'packages', 'db')
    if (existsSync(candidate)) return resolve(candidate, 'src', 'generated')
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return resolve(configCwd, 'generated')
}

/** Write content-tables.ts into an already-resolved generated directory. */
export function writeContentTablesToDir(schema: SchemaDefinition, outDir: string, registry: Array<Record<string, unknown>> = []): void {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'content-tables.ts'), generateContentTablesCode(schema, registry), 'utf8')
}

/** @deprecated pass a resolved dir via {@link writeContentTablesToDir}; kept for the old dbPackageRoot callers. */
export function writeContentTablesFile(schema: SchemaDefinition, dbPackageRoot: string, registry: Array<Record<string, unknown>> = []): void {
  writeContentTablesToDir(schema, resolve(dbPackageRoot, 'src', 'generated'), registry)
}
