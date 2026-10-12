/**
 * File Name: search-sync.ts
 * Purpose: The one call a content route makes to keep search in step.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A route should not know which engine is configured, nor
 *   whether it writes transactionally. It calls this from inside the
 *   transaction it already has; a transactional engine joins that transaction,
 *   and an eventual one is left to the queue that is registered for it.
 *
 *   Failures are NOT swallowed. If the search write fails under a transactional
 *   engine the mutation must roll back with it - that atomicity is the reason
 *   for writing here rather than afterwards, and catching the error would throw
 *   it away.
 */
import { indexContentInTransaction, removeContentInTransaction } from './content-search-writer'
import type { SearchEngine } from './search-engine'

type Ctx = { searchEngineRef?: { current: unknown } | null; schema?: { types?: Array<{ name: string; fields?: unknown[] }> } }

/** The engine this request should use, if one is configured. */
export function engineFrom(ctx: Ctx): SearchEngine | undefined {
  return (ctx?.searchEngineRef?.current as SearchEngine | undefined) ?? undefined
}

/**
 * What the search capability decorates onto every request.
 *
 * Core content routes must not import the search tree - a gated capability that
 * is statically reachable from the entry point is not gated, and there is a
 * test that says so. So search hands the routes a function instead, and a
 * deployment without search decorates nothing and the routes call nothing.
 */
export interface SearchSync {
  current: unknown
  onWrite(ctx: Ctx, tx: unknown, args: { workspaceId: string; typeName: string; objectId: string; row: Record<string, unknown> }): Promise<boolean>
  onDelete(ctx: Ctx, tx: unknown, args: { workspaceId: string; typeName: string; objectId: string }): Promise<boolean>
}

/** Build the decoration. Called once, by the search capability. */
export function makeSearchSync(ref: { current: unknown }): SearchSync {
  return {
    get current() { return ref.current },
    onWrite: (ctx, tx, args) => syncSearchOnWrite({ ...ctx, searchEngineRef: ref }, tx, args),
    onDelete: (ctx, tx, args) => syncSearchOnDelete({ ...ctx, searchEngineRef: ref }, tx, args),
  }
}

/**
 * Index a created or updated object as part of the mutation.
 * @returns true when the engine wrote; false when the queue will.
 */
export async function syncSearchOnWrite(
  ctx: Ctx,
  tx: unknown,
  args: { workspaceId: string; typeName: string; objectId: string; row: Record<string, unknown> },
): Promise<boolean> {
  const engine = engineFrom(ctx)
  if (!engine) return false
  const typeDef = ctx.schema?.types?.find((t) => t.name === args.typeName)
  if (!typeDef) return false
  return indexContentInTransaction(engine, {
    workspaceId: args.workspaceId, typeSlug: args.typeName,
    objectId: args.objectId, row: args.row,
    typeDef: typeDef as { name: string; fields: Array<{ name: string; fieldType?: string; config?: Record<string, unknown> }> },
  }, tx)
}

/** Remove a deleted object as part of the mutation that deleted it. */
export async function syncSearchOnDelete(
  ctx: Ctx,
  tx: unknown,
  args: { workspaceId: string; typeName: string; objectId: string },
): Promise<boolean> {
  return removeContentInTransaction(engineFrom(ctx), {
    workspaceId: args.workspaceId, typeSlug: args.typeName, objectId: args.objectId,
  }, tx)
}
