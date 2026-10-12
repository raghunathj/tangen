/**
 * File Name: media-usage.ts
 * Purpose: Reverse-reference scan for a media asset — which content entries
 *          reference a given media id, so the delete flow can show "where used"
 *          and block removal until it's disconnected (mirrors relation-integrity
 *          for relations). Media ids are unique tokens, so a containment match on
 *          the (media text + jsonb container) columns can't false-positive.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { and, eq, ne, or, sql } from 'drizzle-orm'
import type { SchemaDefinition } from '@tangen/types'

export interface MediaUsage {
  /** Content type name. */
  type: string
  /** Human label for the type. */
  typeLabel: string
  /** Referencing entry id. */
  id: string
  /** Referencing entry title (may be null/untitled). */
  title: string | null
}

// Field types whose column may hold a media id: a `media` text column, or a jsonb
// container that can nest a media/Image node (richtext, repeater, component,
// group, object, json).
const MEDIA_BEARING_TYPES = new Set(['media', 'richtext', 'repeater', 'component', 'group', 'object', 'json'])

/** Top-level column names on a type whose stored value could contain a media id. */
export function mediaBearingColumns(type: { fields?: Array<{ name: string; fieldType: string }> }): string[] {
  return (type.fields ?? []).filter((f) => MEDIA_BEARING_TYPES.has(f.fieldType)).map((f) => f.name)
}

/**
 * Content entries (non-archived) that reference `mediaId`, across every type.
 * Scans each type's media + container columns for the id token; capped at `limit`.
 */
export async function findMediaUsage(
  db: any,
  contentTables: Record<string, any>,
  schema: SchemaDefinition,
  opts: { mediaId: string; workspaceId: string; limit?: number },
): Promise<MediaUsage[]> {
  const out: MediaUsage[] = []
  const max = opts.limit ?? 20
  const like = `%${opts.mediaId}%`

  for (const type of schema.types) {
    if (out.length >= max) break
    const table = contentTables[type.name]
    if (!table) continue
    const cols = mediaBearingColumns(type).map((n) => table[n]).filter(Boolean)
    if (cols.length === 0) continue

    const matches = cols.map((c) => sql`${c}::text LIKE ${like}`)
    const anyMatch = matches.length === 1 ? matches[0] : or(...matches)
    const rows = await db
      .select({ id: table.id, title: table.title })
      .from(table)
      .where(and(
        eq(table.workspaceId, opts.workspaceId),
        ne(table.status, 'archived'),
        anyMatch,
      ))
      .limit(max - out.length)

    for (const r of rows) {
      out.push({
        type: type.name,
        typeLabel: (type as { label?: string }).label ?? type.name,
        id: r.id,
        title: (r.title as string | null) ?? null,
      })
      if (out.length >= max) break
    }
  }
  return out
}
