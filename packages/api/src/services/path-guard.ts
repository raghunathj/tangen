/**
 * File Name: path-guard.ts
 * Purpose: The save-time half of the content-path work (slice 3 of
 *          tasks/plan-content-paths.md): refuses a parent that would make an
 *          object its own ancestor, or a tree deeper than an address can hold.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The READ path already survives a loop - the resolver's
 *          recursive query carries a `seen` array - so this is not about
 *          rendering correctly. It is about telling an editor BEFORE they
 *          create the problem, because the alternative is a branch of pages
 *          that quietly becomes unreachable and a picker that showed nothing
 *          wrong at the time.
 *
 *          One query, whatever the depth. It walks UP from the PROPOSED parent
 *          rather than down from the object, because up is bounded by the
 *          tree's height while down is bounded by its size.
 */
import { sql } from 'drizzle-orm'
import { PATH_MAX_SEGMENTS } from '@tangen/schema'
import type { ObjectTypeDefinition } from '@tangen/types'

/**
 * The field a type walks up through: its own single-valued self-relation,
 * which `hierarchical: true` auto-provides. Found by TARGET rather than by
 * name, so a hand-declared parent under another name still works, and a
 * `many` self-relation ("related pages") is correctly not one.
 */
export function parentFieldOf(typeDef: ObjectTypeDefinition): string | null {
  for (const f of typeDef.fields ?? []) {
    if (f.fieldType !== 'relation') continue
    const c = f.config as { targetType?: string; many?: boolean } | undefined
    if (c?.targetType === typeDef.name && c?.many !== true) return f.name
  }
  return null
}

export interface ParentCycleInput {
  workspaceId: string
  typeName: string
  /** The self-relation to walk, from `parentFieldOf`. */
  parentField: string
  /** The object being written. On create this names a row that does not exist yet. */
  objectId: string
  /** The proposed parent. `null` clears it and can never cycle. */
  parentId: string | null
  /**
   * The longest ancestor chain allowed, counting the object itself. Defaults
   * to the address ceiling, since a tree deeper than an address can hold
   * produces objects with no address at all.
   */
  maxDepth?: number
}

/** Thrown with a message written for an editor, not for a log. */
export class ParentCycleError extends Error {
  readonly code: string
  constructor(message: string, code: 'PARENT_CYCLE' | 'PARENT_TOO_DEEP') {
    super(message)
    this.name = 'ParentCycleError'
    this.code = code
  }
}

const rowsOf = (res: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

/**
 * Refuses a parent that would close a loop, or sink the object deeper than an
 * address can hold. Resolves silently when the move is fine.
 *
 * A parent in another workspace, or one that does not exist, is not this
 * guard's business: it finds no chain, so there is no cycle to refuse. The
 * reference itself is the relation validator's concern.
 */
export async function assertNoParentCycle(db: any, input: ParentCycleInput): Promise<void> {
  const { workspaceId, typeName, parentField, objectId, parentId } = input
  if (!parentId) return                                  // clearing it can never cycle
  const maxDepth = input.maxDepth ?? PATH_MAX_SEGMENTS

  if (parentId === objectId) {
    throw new ParentCycleError(
      `A ${typeName} cannot be its own parent.`,
      'PARENT_CYCLE',
    )
  }

  const t = sql.identifier(typeName)
  const p = sql.identifier(parentField)
  // `seen` guards against a loop that already exists in the data - written
  // before this guard did, or straight through SQL - which would otherwise
  // spin here while refusing an unrelated edit.
  const res = await db.execute(sql`
    WITH RECURSIVE up AS (
      SELECT id, slug, ${p} AS next, 1 AS depth, ARRAY[id] AS seen
        FROM ${t}
       WHERE workspace_id = ${workspaceId} AND id = ${parentId}
      UNION ALL
      SELECT n.id, n.slug, n.${p}, u.depth + 1, u.seen || n.id
        FROM ${t} n
        JOIN up u ON n.id = u.next
       WHERE n.workspace_id = ${workspaceId}
         AND u.depth <= ${maxDepth + 1}
         AND NOT (n.id = ANY(u.seen))
    )
    SELECT id, slug, depth FROM up ORDER BY depth`)
  const chain = rowsOf(res)

  const hit = chain.find((r) => String(r.id) === objectId)
  if (hit) {
    // The three-hop version of this is the one nobody spots: about's parent
    // set to team, which sits under company, which sits under about. Naming
    // both ends is what makes the message actionable.
    const self = chain[0]
    throw new ParentCycleError(
      `This ${typeName} cannot sit under "${String(self?.slug ?? parentId)}", because that is already `
      + `below "${String(hit.slug ?? objectId)}". A ${typeName} cannot be its own ancestor.`,
      'PARENT_CYCLE',
    )
  }

  // +1 for the object itself, which is about to join the bottom of the chain.
  const depth = chain.length + 1
  if (depth > maxDepth) {
    throw new ParentCycleError(
      `This would put the ${typeName} ${depth} levels deep. An address may hold at most ${maxDepth} segments.`,
      'PARENT_TOO_DEEP',
    )
  }
}

/**
 * The platform's own hierarchy check, shaped for the write path: finds the
 * type's self-relation, and refuses the write when the value being written
 * for it would close a loop or sink the tree past an address.
 *
 * Does nothing at all for a type with no self-relation, or a write that is
 * not touching it - which is almost every write, so the common path costs one
 * array scan and no query.
 */
export async function assertHierarchyOnWrite(
  db: any,
  projects: ReadonlyArray<{ workspaceId?: string; schemas?: ObjectTypeDefinition[] }>,
  ctx: { workspaceId: string; typeName: string; objectId: string; nextData: Record<string, unknown> | null },
): Promise<void> {
  if (!ctx.nextData) return
  const project = projects.find((p) => p.workspaceId === ctx.workspaceId)
  const typeDef = (project?.schemas ?? []).find((t) => t.name === ctx.typeName)
  if (!typeDef) return
  const parentField = parentFieldOf(typeDef)
  if (!parentField) return
  // `in`, not truthiness: a partial update that is not touching the parent
  // must not be checked, while one CLEARING it must still be seen.
  if (!(parentField in ctx.nextData)) return
  const value = ctx.nextData[parentField]
  await assertNoParentCycle(db, {
    workspaceId: ctx.workspaceId,
    typeName: ctx.typeName,
    parentField,
    objectId: ctx.objectId,
    parentId: typeof value === 'string' && value !== '' ? value : null,
  })
}
