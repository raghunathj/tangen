/**
 * File Name: tags.ts
 * Purpose: System-tags service over the polymorphic `entity_tags` table. One place
 *   every surface (REST, local client, MCP, admin) tags + filters records across
 *   content / submissions / members / media. Free-form tags, normalized on write;
 *   env-scoped; `source` records who added them.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { DbClient } from '@tangen/db'
import { entityTags } from '@tangen/db'

const MAX_TAG_LEN = 50

/** Trim + collapse internal whitespace + cap length. Returns null for empty. */
export function normalizeTag(raw: unknown): string | null {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!s) return null
  return s.slice(0, MAX_TAG_LEN)
}

/** Normalize + de-duplicate (case-sensitive, preserving first-seen order). */
export function normalizeTags(raws: unknown): string[] {
  const arr = Array.isArray(raws) ? raws : raws == null ? [] : [raws]
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of arr) {
    const t = normalizeTag(r)
    if (t && !seen.has(t)) { seen.add(t); out.push(t) }
  }
  return out
}

/** Namespaced entity_type for a content type. Other kinds use their bare name. */
export function contentEntityType(typeName: string): string {
  return `content:${typeName}`
}

/**
 * Label filter operators. Set ops act on discrete labels; substring ops match on
 * label NAMES. 'none' is an exclusion (records having NONE of the labels).
 */
export type LabelOp = 'all' | 'any' | 'none' | 'contains' | 'starts' | 'ends'
export const SUBSTRING_LABEL_OPS: LabelOp[] = ['contains', 'starts', 'ends']

/**
 * Parse a `labels` query filter into { tags, op }. Accepts a bare array/string
 * (op 'all'), a set-op object `{ all|any|in|none: [...] }`, or a substring-op
 * object `{ contains|starts|ends: 'x' }`. Null when there's nothing to filter on.
 */
export function extractLabelFilter(v: unknown): { tags: string[]; op: LabelOp } | null {
  if (v == null) return null
  if (Array.isArray(v)) { const t = normalizeTags(v); return t.length ? { tags: t, op: 'all' } : null }
  if (typeof v === 'string') { const t = normalizeTags(v); return t.length ? { tags: t, op: 'all' } : null }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.all)) { const t = normalizeTags(o.all); if (t.length) return { tags: t, op: 'all' } }
    if (Array.isArray(o.any) || Array.isArray(o.in)) { const t = normalizeTags((o.any ?? o.in) as unknown[]); if (t.length) return { tags: t, op: 'any' } }
    if (Array.isArray(o.none)) { const t = normalizeTags(o.none); if (t.length) return { tags: t, op: 'none' } }
    for (const op of SUBSTRING_LABEL_OPS) {
      if (o[op] != null) { const t = normalizeTag(o[op]); if (t) return { tags: [t], op } }
    }
  }
  return null
}

export type TagScope = { workspaceId: string; entityType: string; entityId: string }
export type TagSource = 'user' | 'system' | 'mcp' | 'api' | (string & {})
export type TagWriteOpts = { source?: TagSource; by?: string | null }

/** Add tags to an entity (idempotent — existing (…,tag) rows are left as-is). */
export async function addTags(db: DbClient, scope: TagScope, rawTags: unknown, opts: TagWriteOpts = {}): Promise<string[]> {
  const tags = normalizeTags(rawTags)
  if (!tags.length) return []
  await db.insert(entityTags).values(tags.map((tag) => ({
    workspaceId: scope.workspaceId, entityType: scope.entityType, entityId: scope.entityId,
    tag, source: opts.source ?? 'user', createdBy: opts.by ?? null,
  }))).onConflictDoNothing()
  return tags
}

/** Remove specific tags from an entity. */
export async function removeTags(db: DbClient, scope: TagScope, rawTags: unknown): Promise<void> {
  const tags = normalizeTags(rawTags)
  if (!tags.length) return
  await db.delete(entityTags).where(and(
    eq(entityTags.workspaceId, scope.workspaceId), eq(entityTags.entityType, scope.entityType), eq(entityTags.entityId, scope.entityId),
    inArray(entityTags.tag, tags),
  ))
}

/**
 * Replace an entity's tags FOR A GIVEN SOURCE with `rawTags` (default 'user') —
 * so a user editing tags never wipes system/extension-added tags. Diffs to avoid
 * churning unchanged rows.
 */
export async function setTags(db: DbClient, scope: TagScope, rawTags: unknown, opts: TagWriteOpts = {}): Promise<string[]> {
  const source = opts.source ?? 'user'
  const next = normalizeTags(rawTags)
  const current = await db.select({ tag: entityTags.tag }).from(entityTags).where(and(
    eq(entityTags.workspaceId, scope.workspaceId), eq(entityTags.entityType, scope.entityType), eq(entityTags.entityId, scope.entityId),
    eq(entityTags.source, source),
  ))
  const currentSet = new Set(current.map((r) => r.tag))
  const nextSet = new Set(next)
  const toAdd = next.filter((t) => !currentSet.has(t))
  const toRemove = [...currentSet].filter((t) => !nextSet.has(t))
  if (toAdd.length) await addTags(db, scope, toAdd, opts)
  if (toRemove.length) {
    await db.delete(entityTags).where(and(
      eq(entityTags.workspaceId, scope.workspaceId), eq(entityTags.entityType, scope.entityType), eq(entityTags.entityId, scope.entityId),
      eq(entityTags.source, source), inArray(entityTags.tag, toRemove),
    ))
  }
  return next
}

/** All tags on one entity (any source), sorted. */
export async function listTags(db: DbClient, scope: TagScope): Promise<string[]> {
  const rows = await db.select({ tag: entityTags.tag }).from(entityTags).where(and(
    eq(entityTags.workspaceId, scope.workspaceId), eq(entityTags.entityType, scope.entityType), eq(entityTags.entityId, scope.entityId),
  )).orderBy(entityTags.tag)
  return rows.map((r) => r.tag)
}

/** Batch tags for many entities of one type → { entityId: tags[] } (for list views). */
export async function listTagsForEntities(
  db: DbClient,
  q: { workspaceId: string; entityType: string; entityIds: string[] },
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  if (!q.entityIds.length) return out
  const rows = await db.select({ entityId: entityTags.entityId, tag: entityTags.tag }).from(entityTags).where(and(
    eq(entityTags.workspaceId, q.workspaceId), eq(entityTags.entityType, q.entityType), inArray(entityTags.entityId, q.entityIds),
  )).orderBy(entityTags.tag)
  for (const r of rows) (out[r.entityId] ??= []).push(r.tag)
  return out
}

/** Distinct tags for autocomplete — within one entity_type (or all content via prefix). */
export async function distinctTags(
  db: DbClient,
  q: { workspaceId: string; entityType?: string; entityTypePrefix?: string; query?: string; limit?: number },
): Promise<string[]> {
  const conds = [eq(entityTags.workspaceId, q.workspaceId)]
  if (q.entityType) conds.push(eq(entityTags.entityType, q.entityType))
  else if (q.entityTypePrefix) conds.push(sql`${entityTags.entityType} LIKE ${q.entityTypePrefix + '%'}`)
  if (q.query) conds.push(sql`${entityTags.tag} ILIKE ${'%' + q.query + '%'}`)
  const rows = await db.selectDistinct({ tag: entityTags.tag }).from(entityTags)
    .where(and(...conds)).orderBy(entityTags.tag).limit(q.limit ?? 50)
  return rows.map((r) => r.tag)
}

/**
 * Entity ids of one type MATCHING the label condition. For set ops (all/any/none)
 * `tags` are exact labels; for substring ops (contains/starts/ends) `tags[0]` is a
 * substring matched against label NAMES (ILIKE). NOTE: for 'none' this returns the
 * ids that HAVE any of the tags — the caller excludes them (id NOT IN …). Used to
 * filter content queries / lists by label.
 */
export async function filterEntityIds(
  db: DbClient,
  q: { workspaceId: string; entityType: string; tags: unknown; op?: LabelOp },
): Promise<string[]> {
  const op = q.op ?? 'all'
  const tags = normalizeTags(q.tags)
  if (!tags.length) return []
  const tagCond = op === 'contains' ? sql`${entityTags.tag} ILIKE ${'%' + tags[0] + '%'}`
    : op === 'starts' ? sql`${entityTags.tag} ILIKE ${tags[0] + '%'}`
    : op === 'ends' ? sql`${entityTags.tag} ILIKE ${'%' + tags[0]}`
    : inArray(entityTags.tag, tags)   // all / any / none use exact membership
  const base = and(
    eq(entityTags.workspaceId, q.workspaceId), eq(entityTags.entityType, q.entityType), tagCond,
  )
  if (op === 'all') {
    const rows = await db.select({ entityId: entityTags.entityId }).from(entityTags)
      .where(base).groupBy(entityTags.entityId)
      .having(sql`count(distinct ${entityTags.tag}) = ${tags.length}`)
    return rows.map((r) => r.entityId)
  }
  const rows = await db.selectDistinct({ entityId: entityTags.entityId }).from(entityTags).where(base)
  return rows.map((r) => r.entityId)
}
