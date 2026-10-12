/**
 * File Name: relation-integrity.ts
 * Purpose: B3 — referential integrity for relation fields on archive (delete route).
 *   `config.onDelete` on a relation field decides what happens when a REFERENCED entry
 *   is archived: 'restrict' blocks with a 409 listing the referring entries;
 *   'setNull' (the default) clears the reference — single columns go NULL, many-arrays
 *   drop the id. Declarative, so the builder UI and schema AI can represent it.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { and, eq, ne, sql } from 'drizzle-orm'
import { flattenFields } from '@tangen/types'
import { relationSubfieldsIn } from '@tangen/schema'
import type { SchemaDefinition, ComponentDef } from '@tangen/types'

export type OnDeleteBehavior = 'restrict' | 'setNull'

export interface ReferringField {
  typeName: string
  fieldName: string
  many: boolean
  onDelete: OnDeleteBehavior
}

/** Every relation field in the schema that targets `typeName`, with its behavior. */
export function relationFieldsTargeting(schema: SchemaDefinition, typeName: string): ReferringField[] {
  const out: ReferringField[] = []
  for (const type of schema.types) {
    for (const f of flattenFields(type.fields ?? [])) {
      if (f.fieldType !== 'relation') continue
      const cfg = (f.config ?? {}) as { targetType?: string; many?: boolean; onDelete?: string }
      if (cfg.targetType !== typeName) continue
      out.push({
        typeName: type.name,
        fieldName: f.name,
        many: cfg.many === true,
        onDelete: cfg.onDelete === 'restrict' ? 'restrict' : 'setNull',
      })
    }
  }
  return out
}

/** Ids in a many-relation value (real array or pg text literal "{a,b}"). */
function idsOf(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
    const inner = val.slice(1, -1)
    return inner ? inner.split(',').map((s) => s.trim()).filter(Boolean) : []
  }
  return []
}

/**
 * The stored value after removing a reference to `id` — null clears the column.
 * Single: NULL when it pointed at the id. Many: the id removed; NULL when emptied.
 */
export function removeIdFromRelationValue(value: unknown, id: string, many: boolean): unknown {
  if (!many) return value === id ? null : value
  const next = idsOf(value).filter((v) => v !== id)
  return next.length > 0 ? next : null
}

export interface Blocker { type: string; id: string; title: string | null }

/**
 * Enforce onDelete for one about-to-be-archived entry. Throws nothing itself —
 * returns blockers (restrict) for the route to 409 on, and performs the setNull
 * updates. Archived referrers are frozen history: they neither block nor get rewritten.
 */
export async function enforceOnDelete(
  db: any,
  contentTables: Record<string, any>,
  schema: SchemaDefinition,
  opts: { typeName: string; id: string; workspaceId: string},
): Promise<Blocker[]> {
  const refs = relationFieldsTargeting(schema, opts.typeName)
  if (refs.length === 0) return []

  const blockers: Blocker[] = []
  const MAX_BLOCKERS = 10

  for (const ref of refs) {
    const table = contentTables[ref.typeName]
    if (!table) continue
    const col = table[ref.fieldName]
    if (!col) continue
    // Single stores the bare id; many stores an array/pg literal containing it.
    // Ids are unique cuid-style tokens, so a containment match cannot false-positive.
    const matches = ref.many
      ? sql`${col}::text LIKE ${'%' + opts.id + '%'}`
      : eq(col, opts.id)
    const scope = and(
      eq(table.workspaceId, opts.workspaceId),
      ne(table.status, 'archived'),
      matches,
    )

    if (ref.onDelete === 'restrict') {
      const rows = await db.select({ id: table.id, title: table.title }).from(table).where(scope).limit(MAX_BLOCKERS)
      for (const r of rows) blockers.push({ type: ref.typeName, id: r.id, title: (r.title as string | null) ?? null })
      continue
    }

    // setNull — rewrite each referring row's value in JS (pg-literal arrays make a
    // pure-SQL removal fragile), row counts here are picker-scale, not bulk-scale.
    const rows = await db.select({ id: table.id, val: col }).from(table).where(scope)
    for (const r of rows) {
      const next = removeIdFromRelationValue(r.val, opts.id, ref.many)
      await db.update(table)
        .set({ [ref.fieldName]: next, updatedAt: new Date() })
        .where(and(eq(table.id, r.id), eq(table.workspaceId, opts.workspaceId)))
    }
  }

  return blockers
}

/**
 * TL-3 — publish blockers: a REQUIRED relation field whose target type is disabled
 * cannot satisfy its requirement (the target is unavailable), so publishing must fail.
 * Value-independent: even a stored id is unusable while the target type is off.
 * Optional relations publish fine (the raw id rides along unexpanded).
 */
export function disabledRelationPublishBlockers(
  schema: SchemaDefinition,
  typeDef: { fields: unknown[] },
): Record<string, string> {
  const disabled = new Set(schema.types.filter((t) => t.disabled === true).map((t) => t.name))
  if (disabled.size === 0) return {}
  const errors: Record<string, string> = {}
  for (const f of flattenFields(typeDef.fields as never[]) as Array<{ name: string; label: string; fieldType: string; required?: boolean; config?: { targetType?: string } }>) {
    if (f.fieldType !== 'relation' || f.required !== true) continue
    const target = f.config?.targetType
    if (target && disabled.has(target)) {
      errors[f.name] = `${f.label} is temporarily unavailable - its content type is disabled`
    }
  }
  return errors
}

// ── CR-4: component-nested references ─────────────────────────────────────────

export interface ComponentRelationRefs {
  /** Reusable registry components with a relation sub-field targeting the type. */
  registry: Array<{ componentName: string; subfield: string }>
  /** Inline component defs (embedded in a type's field config) with such a sub-field. */
  inline: Array<{ typeName: string; fieldName: string; componentName: string; subfield: string }>
}

/**
 * Relation sub-fields nested in COMPONENTS that target `typeName`. Registry
 * components are reported once (detaching edits the component everywhere it's used);
 * inline defs are reported per owning type/field. Deleting the type must detach both.
 */
export function componentRelationRefsTargeting(
  schema: SchemaDefinition,
  registry: ComponentDef[],
  typeName: string,
): ComponentRelationRefs {
  const out: ComponentRelationRefs = { registry: [], inline: [] }

  for (const comp of registry) {
    for (const hit of relationSubfieldsIn([comp], registry)) {
      if (hit.targetType === typeName && hit.componentName === comp.name) {
        out.registry.push({ componentName: comp.name, subfield: hit.subfield })
      }
    }
  }

  for (const type of schema.types) {
    if (type.name === typeName) continue
    for (const f of flattenFields(type.fields ?? [])) {
      if (f.fieldType !== 'component') continue
      const refs = ((f.config as { components?: unknown })?.components ?? []) as Array<string | ComponentDef>
      for (const ref of refs) {
        if (typeof ref === 'string') continue   // registry refs are reported above
        for (const hit of relationSubfieldsIn([ref], registry)) {
          if (hit.targetType === typeName) {
            out.inline.push({ typeName: type.name, fieldName: f.name, componentName: hit.componentName, subfield: hit.subfield })
          }
        }
      }
    }
  }

  return out
}
