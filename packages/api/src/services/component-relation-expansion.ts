/**
 * File Name: component-relation-expansion.ts
 * Purpose: CR-3 — resolve-and-filter reads for relations nested inside component
 *   blocks (the ACF model): at depth ≥ 1 the nested ids are batch-loaded and replaced
 *   with target objects IN THE RESPONSE; ids that no longer resolve are filtered
 *   (many) / nulled (single); DISABLED target types keep their raw id (same skip as
 *   top-level expansion). Storage is never rewritten — a million rows with dangling
 *   ids cost nothing until they're read, and then they just read clean.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { inArray } from 'drizzle-orm'
import { and, eq } from 'drizzle-orm'
import { flattenFields, type SchemaDefinition, type FieldDefinition, type ComponentDef } from '@tangen/types'
import { applyPublishedSnapshot } from './local-client'
import { resolveComponentRefs, mapNestedRelationIds, relationSubfieldsIn, mapRowRelationIds, relationRowFieldsIn, type ComponentBlockValue } from '@tangen/schema'

export type NestedLoader = (typeName: string, ids: string[]) => Promise<Map<string, Record<string, unknown>>>

export interface ExpandComponentRelationsOpts {
  registry: ComponentDef[]
  schema: SchemaDefinition
  loadByIds: NestedLoader
  /** Remaining expansion depth (default 1 = resolve targets, stop). */
  depth?: number
  /** NR-4: recurse into resolved targets (their own relations/blocks) with remaining depth. */
  expandTarget?: (rows: Record<string, unknown>[], typeName: string, remainingDepth: number) => Promise<Record<string, unknown>[]>
}

/** Tolerant ref resolution — unknown registry names are dropped, never thrown. */
function safeDefs(refs: unknown, registry: ComponentDef[]): ComponentDef[] {
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
 * Expand relation ids nested in the component fields of `rows`. Two passes over the
 * same walker: collect ids per target type, batch-load, then substitute. Disabled
 * target types are excluded from loading — their ids pass through raw.
 */
export async function expandComponentRelations(
  rows: Record<string, unknown>[],
  typeDef: { fields: FieldDefinition[] },
  opts: ExpandComponentRelationsOpts,
): Promise<Record<string, unknown>[]> {
  // NR-2: repeater fields expand too — blocks and rows are both containers
  const compFields = flattenFields(typeDef.fields).filter((f) => f.fieldType === 'component' || f.fieldType === 'repeater')
  if (compFields.length === 0 || rows.length === 0) return rows

  const disabled = new Set(opts.schema.types.filter((t) => t.disabled === true).map((t) => t.name))
  const known = new Set(opts.schema.types.map((t) => t.name))

  // Which targets can we resolve at all? (unknown type = deleted → ids filter to null)
  const fieldDefs = new Map<string, ComponentDef[]>()
  const rowFieldDefs = new Map<string, Array<Record<string, unknown>>>()
  let anyRelations = false
  for (const f of compFields) {
    if (f.fieldType === 'repeater') {
      const rowFields = ((f.config as { fields?: unknown })?.fields ?? []) as Array<Record<string, unknown>>
      rowFieldDefs.set(f.name, rowFields)
      if (relationRowFieldsIn(rowFields, opts.registry).length > 0) anyRelations = true
      continue
    }
    const defs = safeDefs((f.config as { components?: unknown })?.components, opts.registry)
    fieldDefs.set(f.name, defs)
    if (relationSubfieldsIn(defs, opts.registry).length > 0) anyRelations = true
  }
  if (!anyRelations) return rows

  // Pass 1 — collect ids per target type (identity mapping, collector side effect).
  const wanted = new Map<string, Set<string>>()
  for (const row of rows) {
    for (const f of compFields) {
      const blocks = row[f.name]
      if (!Array.isArray(blocks)) continue
      const collector = (id: string, target: string) => {
        if (!disabled.has(target) && known.has(target)) {
          const set = wanted.get(target) ?? new Set<string>()
          set.add(id)
          wanted.set(target, set)
        }
        return id
      }
      if (f.fieldType === 'repeater') {
        mapRowRelationIds(blocks as never, rowFieldDefs.get(f.name) ?? [], opts.registry, collector)
      } else {
        mapNestedRelationIds(blocks as ComponentBlockValue[], fieldDefs.get(f.name)!, collector)
      }
    }
  }
  if (wanted.size === 0) return rows

  // Batch-load per target type.
  const loaded = new Map<string, Map<string, Record<string, unknown>>>()
  const depth = Math.max(1, opts.depth ?? 1)
  for (const [typeName, ids] of wanted) {
    const map = await opts.loadByIds(typeName, [...ids])
    // NR-4: deep chains — expand the targets' own relations/blocks while depth remains
    if (depth > 1 && opts.expandTarget && map.size > 0) {
      const expanded = await opts.expandTarget([...map.values()], typeName, depth - 1)
      const byId = new Map(expanded.map((r) => [String(r.id), r]))
      for (const id of [...map.keys()]) {
        const hit = byId.get(id)
        if (hit) map.set(id, hit)
      }
    }
    loaded.set(typeName, map)
  }

  // Pass 2 — substitute: resolved object | raw id (disabled) | null (gone).
  return rows.map((row) => {
    const next = { ...row }
    for (const f of compFields) {
      const blocks = next[f.name]
      if (!Array.isArray(blocks)) continue
      const substitute = (id: string, target: string) => {
        if (disabled.has(target)) return id                     // skipped, same as top-level
        const hit = loaded.get(target)?.get(id)
        return hit ? { ...hit, type: target } : null            // resolve or filter
      }
      next[f.name] = f.fieldType === 'repeater'
        ? mapRowRelationIds(blocks as never, rowFieldDefs.get(f.name) ?? [], opts.registry, substitute)
        : mapNestedRelationIds(blocks as ComponentBlockValue[], fieldDefs.get(f.name)!, substitute)
    }
    return next
  })
}

/**
 * NR-4 — the recursion step for deep chains: expands a batch of resolved
 * TARGET rows (their top-level relations, object refs, and container-nested
 * relations) with the remaining depth. Built once per request by the routes.
 */
export function makeTargetExpander(deps: {
  db: any
  schema: SchemaDefinition
  workspaceId: string
  publicView: boolean
  registry: ComponentDef[]
}): (rows: Record<string, unknown>[], typeName: string, remainingDepth: number) => Promise<Record<string, unknown>[]> {
  const expander = async (rows: Record<string, unknown>[], typeName: string, remainingDepth: number): Promise<Record<string, unknown>[]> => {
    const targetDef = deps.schema.types.find((t) => t.name === typeName)
    if (!targetDef || rows.length === 0) return rows
    const { getRelationFields, expandRelations } = await import('./relation-loader')
    const { getObjectFields, expandObjectFields } = await import('./object-loader')
    const contentTablesMod = await import('@tangen/db/content-tables')
    const contentTables = (contentTablesMod as { contentTables: Record<string, unknown> }).contentTables
    let out = await expandRelations(rows, getRelationFields(targetDef), deps.db, deps.workspaceId, {
      schema: deps.schema, depth: remainingDepth, publicView: deps.publicView,
    })
    out = await expandObjectFields(out, getObjectFields(targetDef), deps.db, deps.workspaceId, deps.schema, remainingDepth, deps.publicView)
    out = await expandComponentRelations(out, targetDef as never, {
      registry: deps.registry,
      schema: deps.schema,
      loadByIds: makeNestedLoader(deps.db, contentTables as Record<string, any>, deps.workspaceId, deps.publicView),
      depth: remainingDepth,
      expandTarget: expander,
    })
    return out
  }
  return expander
}

/** Production loader — batch by ids within the workspace/env scope. */
export function makeNestedLoader(db: any, contentTables: Record<string, any>, workspaceId: string, publicView = false): NestedLoader {
  return async (typeName, ids) => {
    const table = contentTables[typeName]
    if (!table || ids.length === 0) return new Map()
    let rows = await db
      .select()
      .from(table)
      .where(and(
        eq(table.workspaceId, workspaceId), inArray(table.id, ids),
        ...(publicView ? [eq(table.status, 'published')] : []),
      )) as Record<string, unknown>[]
    if (publicView) rows = applyPublishedSnapshot(rows, 'published')
    return new Map(rows.map((r: Record<string, unknown>) => [r.id as string, r]))
  }
}

/**
 * BL-3 — repeater rows need a stable `_key` for per-locale overlays (and the
 * editor generates one for new rows). Legacy rows saved before keys existed get
 * one lazily on the next write. Walks top-level repeaters and repeaters nested
 * inside component blocks (defs resolved via the registry).
 */
export function ensureContainerRowKeys(
  typeDef: { fields: FieldDefinition[] },
  registry: ComponentDef[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const newKey = () => Math.random().toString(36).slice(2, 14)
  const keyRows = (rows: unknown): unknown => {
    if (!Array.isArray(rows)) return rows
    return rows.map((r) =>
      r && typeof r === 'object' && !Array.isArray(r) && typeof (r as Record<string, unknown>)._key !== 'string'
        ? { ...(r as Record<string, unknown>), _key: newKey() }
        : r,
    )
  }
  const keyBlocks = (blocks: unknown, defs: ComponentDef[]): unknown => {
    if (!Array.isArray(blocks)) return blocks
    return blocks.map((block) => {
      const b = block as Record<string, unknown>
      const def = defs.find((d) => d.name === ((b?._type ?? b?.type) as string))
      if (!def) return block
      let next = b
      for (const sf of def.fields ?? []) {
        const cfg = (sf.config ?? {}) as { fields?: unknown; components?: unknown }
        if (sf.fieldType === 'repeater' && Array.isArray(next[sf.name])) {
          next = { ...next, [sf.name]: keyRows(next[sf.name]) }
        } else if (sf.fieldType === 'component' && Array.isArray(next[sf.name])) {
          next = { ...next, [sf.name]: keyBlocks(next[sf.name], [...safeDefs(cfg.components, registry), ...defs]) }
        }
      }
      return next
    })
  }

  const out = { ...values }
  for (const f of flattenFields(typeDef.fields)) {
    if (!(f.name in out)) continue
    const cfg = (f.config ?? {}) as { components?: unknown }
    if (f.fieldType === 'repeater') out[f.name] = keyRows(out[f.name])
    else if (f.fieldType === 'component') out[f.name] = keyBlocks(out[f.name], safeDefs(cfg.components, registry))
  }
  return out
}
