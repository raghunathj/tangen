/**
 * File Name: publish-cascade.ts
 * Purpose: Surface-agnostic publish dependency resolver (PC-1). Given a root
 *   object, finds the required `relation` fields — including relations nested
 *   inside repeater / component / group container fields — whose targets are not
 *   yet published, recurses into those targets, guards cycles, flags targets that
 *   can't publish as blockers, and returns a topologically ordered publish plan.
 *   Reused by every publish surface (REST, GraphQL, SDK, ctx.tangen) through the
 *   shared publish core.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: pure over an injected RowLoader (no db/HTTP coupling) so it
 *   is trivially testable; `makeDbRowLoader` adapts a drizzle client for callers.
 */
import { eq, and } from 'drizzle-orm'
import { contentTables } from '@tangen/db/content-tables'
import type { SchemaDefinition, FieldDefinition } from '@tangen/types'
import { publishValidationError } from './field-validator'

/** A related object reference discovered while walking a record. */
export interface RelationRef {
  typeName: string
  id: string
}

/** One node in the publish plan. */
export interface CascadeNode {
  typeName: string
  /** Human label for the type (e.g. "Pin Code City") — falls back to typeName. */
  typeLabel: string
  id: string
  title: string
  status: string
  /** Set when the node cannot be published — why. */
  reason?: string
}

export interface PublishPlan {
  /** True when there is anything to cascade or any blocker. */
  needsCascade: boolean
  /** Non-published targets that would be published alongside the root. */
  dependencies: CascadeNode[]
  /** Targets that cannot be published (their own required fields fail). */
  blockers: CascadeNode[]
  /** Topological publish order: dependencies first, the root last. */
  order: CascadeNode[]
}

/** Loads a content row by type + id (workspace/env scoping is the loader's job). */
export type RowLoader = (typeName: string, id: string) => Promise<Record<string, unknown> | null>

const key = (typeName: string, id: string) => `${typeName}:${id}`

/** Extract target ids from a relation field value (single or `many`). */
function relationIds(value: unknown, many: boolean): string[] {
  if (value == null) return []
  if (many) {
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
    if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
      const inner = value.slice(1, -1)
      return inner ? inner.split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean) : []
    }
    return []
  }
  return typeof value === 'string' && value.length > 0 ? [value] : []
}

/**
 * Recursively collect **required** `relation` targets from a record, descending
 * into repeater rows, component blocks (keyed by `_type`/`_component`), and
 * groups (nested object or flat storage).
 */
export function collectRequiredRelations(
  fields: FieldDefinition[],
  value: Record<string, unknown> | null | undefined,
): RelationRef[] {
  const refs: RelationRef[] = []
  const v = value ?? {}
  for (const f of fields) {
    const fv = (v as Record<string, unknown>)[f.name]
    const cfg = (f.config ?? {}) as Record<string, any>
    switch (f.fieldType) {
      case 'relation': {
        if (!f.required || !cfg.targetType) break
        for (const id of relationIds(fv, cfg.many === true)) refs.push({ typeName: cfg.targetType, id })
        break
      }
      case 'repeater': {
        const sub = (cfg.fields ?? []) as FieldDefinition[]
        if (Array.isArray(fv)) for (const row of fv) refs.push(...collectRequiredRelations(sub, row as Record<string, unknown>))
        break
      }
      case 'component': {
        const defs = (cfg.components ?? []) as Array<{ name: string; fields: FieldDefinition[] }>
        if (Array.isArray(fv)) {
          for (const block of fv as Record<string, unknown>[]) {
            const bt = (block._type ?? block._component) as string | undefined
            const def = defs.find((d) => d.name === bt)
            if (def) refs.push(...collectRequiredRelations(def.fields, block))
          }
        }
        break
      }
      case 'group': {
        const sub = (cfg.groupFields ?? []) as FieldDefinition[]
        // Nested object storage → descend into it; flat storage → sub-fields live
        // on the same record.
        const gv = fv && typeof fv === 'object' && !Array.isArray(fv) ? (fv as Record<string, unknown>) : v
        refs.push(...collectRequiredRelations(sub, gv))
        break
      }
    }
  }
  return refs
}

/**
 * Build the publish plan for a root object: which non-published required-relation
 * targets (at any nesting depth, recursively) would be published with it, which
 * are blockers, and the order to publish them in.
 */
export async function resolvePublishPlan(opts: {
  schema: SchemaDefinition
  typeName: string
  id: string
  loadRow: RowLoader
}): Promise<PublishPlan> {
  const { schema, typeName, id, loadRow } = opts
  const typeOf = (name: string) => schema.types.find((t) => t.name === name)

  const dependencies: CascadeNode[] = []
  const blockers: CascadeNode[] = []
  const order: CascadeNode[] = []
  const visited = new Set<string>([key(typeName, id)]) // the root is never its own dependency

  // Post-order DFS: a node's dependencies are emitted to `order` before the node.
  async function visit(tName: string, tId: string): Promise<void> {
    const def = typeOf(tName)
    const row = await loadRow(tName, tId)
    if (!def || !row) return

    for (const ref of collectRequiredRelations(def.fields, row)) {
      const k = key(ref.typeName, ref.id)
      if (visited.has(k)) continue
      visited.add(k)
      const targetDef = typeOf(ref.typeName)
      const targetRow = await loadRow(ref.typeName, ref.id)
      if (!targetDef || !targetRow) continue
      if (targetRow.status === 'published') continue // already live - nothing to do

      const node: CascadeNode = {
        typeName: ref.typeName,
        typeLabel: targetDef.label ?? ref.typeName,
        id: ref.id,
        title: String(targetRow.title ?? ref.id),
        status: String(targetRow.status ?? 'draft'),
      }
      const reason = publishValidationError(targetDef, targetRow)
      if (reason) {
        node.reason = reason
        blockers.push(node)
        continue // don't recurse through an unpublishable node
      }
      // recurse into this dependency's own required relations first (deps-first order)
      await visit(ref.typeName, ref.id)
      dependencies.push(node)
      order.push(node)
    }
  }

  await visit(typeName, id)

  // Publish the root last.
  const rootRow = await loadRow(typeName, id)
  order.push({ typeName, typeLabel: typeOf(typeName)?.label ?? typeName, id, title: String(rootRow?.title ?? id), status: String(rootRow?.status ?? 'draft') })

  return { needsCascade: dependencies.length > 0 || blockers.length > 0, dependencies, blockers, order }
}

/** Thrown by `cascadePublish` when a dependency can't be published — carries the
 * full plan so callers can surface blockers (with deep links) on any surface. */
export class CascadeBlockedError extends Error {
  constructor(public readonly plan: PublishPlan) {
    super('Publish blocked - one or more required related objects cannot be published')
    this.name = 'CascadeBlockedError'
  }
}

/**
 * Orchestrate a cascade publish: resolve the plan, abort (throw
 * `CascadeBlockedError`) if any dependency is a blocker — **nothing is published
 * in that case** — otherwise publish every node in dependency order (deps first,
 * root last) via the caller-supplied `publishOne`. Surface-agnostic: each surface
 * passes its own per-type publish function (REST handler / local client), so the
 * cascade behaves identically everywhere while each keeps its own hooks/events.
 */
export async function cascadePublish(opts: {
  schema: SchemaDefinition
  typeName: string
  id: string
  loadRow: RowLoader
  publishOne: (typeName: string, id: string) => Promise<void>
}): Promise<{ plan: PublishPlan; publishedOrder: CascadeNode[] }> {
  const plan = await resolvePublishPlan(opts)
  if (plan.blockers.length > 0) throw new CascadeBlockedError(plan)
  for (const node of plan.order) await opts.publishOne(node.typeName, node.id)
  return { plan, publishedOrder: plan.order }
}

/** Adapts a drizzle client into a RowLoader scoped to a workspace/env. */
export function makeDbRowLoader(db: any, workspaceId: string): RowLoader {
  return async (typeName, id) => {
    const table = (contentTables as Record<string, any>)[typeName]
    if (!table) return null
    const rows = await db
      .select()
      .from(table)
      .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
      .limit(1)
    return (rows[0] as Record<string, unknown>) ?? null
  }
}
