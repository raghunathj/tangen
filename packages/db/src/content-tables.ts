/**
 * File Name: content-tables.ts
 * Purpose: The RUNTIME registry of content tables: one Drizzle table object
 *          per content type the process serves, built from the schema
 *          registry rows of those environments - never from a generated file.
 *          A process serving several environments on one database gets the
 *          physical UNION of their tables, so which environment ran
 *          `tangen push` last can never decide what the process can read.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `contentTables` and `contentI18nTables` are MUTABLE
 *          maps with a stable identity - every consumer imports them once and
 *          reads `contentTables[type]` per request; `setContentTables`
 *          replaces their entries in place at boot and on every schema
 *          change. The generated `app/generated/content-tables.ts` remains
 *          codegen and type support (tangen-types.d.ts) and is not loaded here.
 */
import { pgTable, text, numeric, boolean, timestamp, jsonb, primaryKey } from 'drizzle-orm/pg-core'
import type { ColumnKind, ContentTableSpec, ContentI18nTableSpec } from '@tangen/types'

export type ContentTableMap = Record<string, unknown>

/** The content tables this process serves, by type name. Filled by setContentTables. */
export const contentTables: ContentTableMap = {}
/** The localized side tables (`<type>_i18n`), by type name. */
export const contentI18nTables: ContentTableMap = {}

/** The Drizzle column for one column kind - the same rule codegen writes down. */
export function drizzleColumnFor(name: string, kind: ColumnKind) {
  switch (kind) {
    case 'NUMERIC': return numeric(name)
    case 'BOOLEAN': return boolean(name)
    case 'TIMESTAMPTZ': return timestamp(name, { withTimezone: true })
    case 'JSONB': return jsonb(name)
    case 'TEXT[]': return text(name).array()
    // NUMRANGE is read and written as its string literal ("[1,10]"); PG casts on write.
    case 'NUMRANGE':
    case 'TEXT':
    default: return text(name)
  }
}

function systemCols() {
  return {
    // Identity is COMPOSITE - (id) - declared per table below.
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    title: text('title'),
    slug: text('slug'),
    status: text('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: text('published_by'),
    publishedValues: jsonb('published_values'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    /** Who scheduled the publish (a member or key id): the actor the scheduler publishes AS (kernel K4). */
    scheduledBy: text('scheduled_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    /** The actor KIND behind each attribution id (kernel K5): member | api_key | system | site_user. A system actor has no id, but it has a kind. */
    createdByKind: text('created_by_kind'),
    updatedByKind: text('updated_by_kind'),
    publishedByKind: text('published_by_kind'),
  }
}

/** One content table object from its spec: the system columns plus the field columns. */
export function buildContentTable(spec: ContentTableSpec) {
  const cols: Record<string, any> = { ...systemCols() }
  for (const c of spec.columns) cols[c.name] = drizzleColumnFor(c.name, c.kind)
  return pgTable(spec.name, cols, (t: any) => ({ pk: primaryKey({ columns: [t.id] }) }))
}

/** One localized side table object from its spec. */
export function buildContentI18nTable(spec: ContentI18nTableSpec) {
  const cols: Record<string, any> = {
    objectId: text('object_id').notNull(),
    locale: text('locale').notNull(),
    __title: text('__title'),
  }
  for (const c of spec.columns) cols[c.name] = drizzleColumnFor(c.name, c.kind)
  cols.updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  return pgTable(`${spec.type}_i18n`, cols, (t: any) => ({ pk: primaryKey({ columns: [t.objectId, t.locale] }) }))
}

export interface BuiltContentTables { contentTables: ContentTableMap; contentI18nTables: ContentTableMap }

/** Every table object for a set of specs (the union a process serves). */
export function buildContentTables(tables: ContentTableSpec[], i18n: ContentI18nTableSpec[] = []): BuiltContentTables {
  const out: BuiltContentTables = { contentTables: {}, contentI18nTables: {} }
  for (const spec of tables) out.contentTables[spec.name] = buildContentTable(spec)
  for (const spec of i18n) out.contentI18nTables[spec.type] = buildContentI18nTable(spec)
  return out
}

/** Replaces the registry's entries in place; the exported maps keep their identity. */
export function setContentTables(built: BuiltContentTables): void {
  for (const k of Object.keys(contentTables)) delete contentTables[k]
  for (const k of Object.keys(contentI18nTables)) delete contentI18nTables[k]
  Object.assign(contentTables, built.contentTables)
  Object.assign(contentI18nTables, built.contentI18nTables)
}

/** Tests only: an empty registry. */
export function resetContentTables(): void {
  setContentTables({ contentTables: {}, contentI18nTables: {} })
}
