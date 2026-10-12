/**
 * File Name: object-snapshot.ts
 * Purpose: One content object as a comparable, freezable whole: its main row,
 *          its translation side rows, its labels and its extension data. A
 *          Release freezes this at approval (`frozen_payload`) and compares
 *          the live draft against it before publishing; the fingerprint is
 *          key-order-insensitive and ignores identity and bookkeeping columns.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Grown out of the environment-to-environment content
 *          migrator, which is gone (tasks/remove-environments-programme.md,
 *          stage R4): a snapshot now describes one object in one workspace.
 */
import { and, eq } from 'drizzle-orm'
import { entityTags, extensionData } from '@tangen/db'
import { fetchI18nRows, type I18nRow } from './i18n'

export interface FrozenObjectSource {
  /** The main row including its identity columns (id, workspaceId). */
  row: Record<string, unknown>
  i18nRows: I18nRow[]
  tags: Record<string, unknown>[]
  ext: Record<string, unknown>[]
}

/** The object as it is right now: draft values, translations, labels, extension data. Null when it does not exist. */
export async function readObjectSource(db: any, workspaceId: string, typeName: string, table: any, objectId: string): Promise<FrozenObjectSource | null> {
  const [row] = await db.select().from(table)
    .where(and(eq(table.id, objectId), eq(table.workspaceId, workspaceId)))
    .limit(1)
  if (!row) return null
  return {
    row: row as Record<string, unknown>,
    i18nRows: await fetchI18nRows(db, typeName, [objectId], 'all'),
    tags: await db.select().from(entityTags).where(and(eq(entityTags.workspaceId, workspaceId), eq(entityTags.entityType, `content:${typeName}`), eq(entityTags.entityId, objectId))) as Record<string, unknown>[],
    ext: await db.select().from(extensionData).where(and(eq(extensionData.workspaceId, workspaceId), eq(extensionData.objectId, objectId))) as Record<string, unknown>[],
  }
}

/** JSON round-trips turn timestamps into strings; drizzle wants Dates back on timestamp columns. */
function reviveDates<T extends Record<string, unknown>>(row: T, table: any): T {
  const out: Record<string, unknown> = { ...row }
  for (const [key, value] of Object.entries(out)) {
    const col = table?.[key]
    if (typeof value === 'string' && col && (col.columnType === 'PgTimestamp' || col.columnType === 'PgTimestampString')) out[key] = new Date(value)
  }
  return out as T
}

export function reviveFrozen(frozen: FrozenObjectSource, table: any): FrozenObjectSource {
  return {
    row: reviveDates(frozen.row, table),
    i18nRows: frozen.i18nRows,
    tags: frozen.tags.map((t) => reviveDates(t, entityTags)),
    ext: frozen.ext.map((e) => reviveDates(e, extensionData)),
  }
}

/** Keys that identify a row or record bookkeeping rather than carry content - never compared. */
const MAIN_IDENTITY_KEYS = new Set(['id', 'workspaceId', 'updatedAt', 'updatedBy', 'createdAt', 'createdBy', 'publishedAt', 'publishedBy', 'publishedValues', 'status', 'scheduledAt'])
const I18N_IDENTITY_KEYS = new Set(['objectId', 'locale', 'updatedAt'])

/** Deep key-order-insensitive canonical form (Dates -> ISO via toJSON): what a jsonb round trip cannot change. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}
const canonical = canonicalJson

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value instanceof Date) return value.toJSON()
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).sort()
        .map((k) => [k, sortDeep((value as Record<string, unknown>)[k])]),
    )
  }
  return value
}

/** The draft content of the main row: field values, title and slug, nothing that records when or by whom. */
export function draftContentOf(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !MAIN_IDENTITY_KEYS.has(k)))
}

function copyableSide(row: I18nRow): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !I18N_IDENTITY_KEYS.has(k)))
}

/** Comparable fingerprint of everything a publish would make live. */
export function fingerprintObject(source: FrozenObjectSource | null): string {
  if (!source) return canonical({ main: null, i18n: [], tags: [], ext: [] })
  return canonical({
    main: draftContentOf(source.row),
    i18n: [...source.i18nRows]
      .sort((a, b) => a.locale.localeCompare(b.locale))
      .map((r) => ({ locale: r.locale, ...copyableSide(r) })),
    tags: [...source.tags].sort((a, b) => String(a.tag).localeCompare(String(b.tag)))
      .map((t) => ({ tag: t.tag, source: t.source })),
    ext: [...source.ext].sort((a, b) => String(a.extensionId).localeCompare(String(b.extensionId)))
      .map((e) => ({ extensionId: e.extensionId, data: e.data })),
  })
}
