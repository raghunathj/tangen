/**
 * File Name: field-walker.ts
 * Purpose: One schema-driven walk over a content row's values, reaching every
 *          position where a given field type can appear: top-level columns,
 *          group sub-fields, repeater rows, component blocks and the
 *          containers nested inside them. Media expansion used to own this
 *          walk privately; link resolution needs exactly the same reach, so
 *          the walk lives here and both read it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The walk is schema-driven, never value-sniffing: a
 *          value only counts where the schema declares a field of that type,
 *          so a text prop that happens to look like an id is left alone.
 *          Block defs resolve tolerantly - inline defs as-is, registry names
 *          looked up, unknown names skipped rather than thrown, because the
 *          def may live in an extension that is momentarily absent. Returns
 *          the SAME object when nothing changed, so callers keep structural
 *          sharing.
 */
import type { ComponentDef } from '@tangen/types'

/** Loose field shape: FieldDefinition, SubField and DB-loaded fields all satisfy it. */
export type AnyField = { name: string; fieldType?: string; config?: unknown }
export type TypeLike = { fields: AnyField[] }

/** What the walker does at one position. `nested` is false only for a type's own column. */
export type FieldVisitor = (value: unknown, at: { nested: boolean }) => unknown

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Tolerant def resolution: inline defs as-is, registry names looked up, unknown names dropped. */
export function resolveBlockDefs(refs: unknown, registry: ComponentDef[]): ComponentDef[] {
  const out: ComponentDef[] = []
  for (const ref of (Array.isArray(refs) ? refs : []) as Array<string | ComponentDef>) {
    if (typeof ref === 'string') {
      const found = registry.find((c) => c.name === ref)
      if (found) out.push(found)
    } else if (ref && typeof ref === 'object') {
      out.push(ref)
    }
  }
  return out
}

/**
 * Maps every position of `fieldType` under one values object. `inherited`
 * carries the defs of enclosing blocks, the way nested relation expansion
 * does, so a registry name resolved at the parent still resolves here.
 */
export function mapFieldsOfType(
  values: Record<string, unknown>,
  fields: AnyField[],
  fieldType: string,
  inherited: ComponentDef[],
  registry: ComponentDef[],
  visit: FieldVisitor,
  nested: boolean,
): Record<string, unknown> {
  let out = values
  const set = (key: string, next: unknown) => {
    if (out === values) out = { ...values }
    out[key] = next
  }
  for (const field of fields) {
    const cfg = (field.config ?? {}) as Record<string, unknown>
    if (field.fieldType === 'group') {
      // Group sub-fields are flat siblings of the group (no column, no nesting).
      const inner = mapFieldsOfType(out, (cfg.groupFields ?? []) as AnyField[], fieldType, inherited, registry, visit, nested)
      if (inner !== out) out = inner
      continue
    }
    if (!(field.name in out)) continue
    const value = out[field.name]
    if (field.fieldType === fieldType) {
      const next = visit(value, { nested })
      if (next !== value) set(field.name, next)
    } else if (field.fieldType === 'component' && Array.isArray(value)) {
      const defs = [...resolveBlockDefs(cfg.components, registry), ...inherited]
      const next = mapBlocks(value, defs, fieldType, registry, visit)
      if (next !== value) set(field.name, next)
    } else if (field.fieldType === 'repeater' && Array.isArray(value)) {
      const next = mapRows(value, (cfg.fields ?? []) as AnyField[], fieldType, inherited, registry, visit)
      if (next !== value) set(field.name, next)
    }
  }
  return out
}

function mapBlocks(blocks: unknown[], defs: ComponentDef[], fieldType: string, registry: ComponentDef[], visit: FieldVisitor): unknown[] {
  let changed = false
  const next = blocks.map((block) => {
    if (!isRecord(block)) return block
    const typeName = (block._type ?? block.type) as string | undefined
    const def = defs.find((d) => d.name === typeName)
    if (!def) return block
    // Editor blocks are FLAT ({ _type, prop }); the legacy shape nests under `values`.
    const legacy = isRecord(block.values)
    const source = legacy ? (block.values as Record<string, unknown>) : block
    const mapped = mapFieldsOfType(source, (def.fields ?? []) as unknown as AnyField[], fieldType, defs, registry, visit, true)
    if (mapped === source) return block
    changed = true
    return legacy ? { ...block, values: mapped } : mapped
  })
  return changed ? next : blocks
}

function mapRows(rows: unknown[], fields: AnyField[], fieldType: string, inherited: ComponentDef[], registry: ComponentDef[], visit: FieldVisitor): unknown[] {
  let changed = false
  const next = rows.map((row) => {
    if (!isRecord(row)) return row
    const mapped = mapFieldsOfType(row, fields, fieldType, inherited, registry, visit, true)
    if (mapped !== row) changed = true
    return mapped
  })
  return changed ? next : rows
}

/** True when the type declares a field of this type anywhere (top-level or inside a container). */
export function declaresFieldType(fields: AnyField[], fieldType: string, registry: ComponentDef[], seen: Set<ComponentDef> = new Set()): boolean {
  for (const field of fields) {
    const cfg = (field.config ?? {}) as Record<string, unknown>
    if (field.fieldType === fieldType) return true
    if (field.fieldType === 'group' && declaresFieldType((cfg.groupFields ?? []) as AnyField[], fieldType, registry, seen)) return true
    if (field.fieldType === 'repeater' && declaresFieldType((cfg.fields ?? []) as AnyField[], fieldType, registry, seen)) return true
    if (field.fieldType === 'component') {
      for (const def of resolveBlockDefs(cfg.components, registry)) {
        if (seen.has(def)) continue
        seen.add(def)
        if (declaresFieldType((def.fields ?? []) as unknown as AnyField[], fieldType, registry, seen)) return true
      }
    }
  }
  return false
}
