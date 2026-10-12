/**
 * File Name: media-loader.ts
 * Purpose: Expands media field IDs in content query results into full media asset objects
 *   by batch-fetching from the mediaAssets table in a single round-trip. The deep walk
 *   (expandMediaDeep) reaches media at ANY depth the schema declares - group sub-fields,
 *   repeater rows, component blocks and the containers nested inside them - so a
 *   kit.image inside a kit.row column reads the same asset shape a top-level cover does.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm, @tangen/db (mediaAssets), @tangen/types (flattenFields, VariantMeta).
 *   The walk is schema-driven, never value-sniffing: a `med_` string is only an asset
 *   where a media field is declared, so a text prop that happens to hold an id is left
 *   alone. Block defs resolve the way component-relation-expansion resolves them -
 *   inline defs as-is, registry names through the workspace registry, unknown names
 *   dropped rather than thrown (the def may live in an extension that is momentarily
 *   absent). Two passes over one walker: collect ids, batch-load once, substitute.
 *   Nested positions keep a dangling id rather than nulling it, because a block's
 *   other props must survive a deleted asset; top-level keeps its historical null.
 */
import { eq, and, inArray } from 'drizzle-orm'
import { mediaAssets } from '@tangen/db'
import type { SchemaDefinition, ComponentDef } from '@tangen/types'
import type { VariantMeta, VariantsStatus } from '@tangen/types'
import { flattenFields } from '@tangen/types'
import { resolveStorageByIds } from './storage'
import { mapFieldsOfType, declaresFieldType, isRecord, type AnyField, type TypeLike, type FieldVisitor } from './field-walker'
import type { StorageAdapter } from '@tangen/types'

/** What the walker does at one media position. `nested` is false only for a type's own column. */
type MediaVisitor = FieldVisitor

/**
 * Minimal descriptor for a media field extracted from a type definition.
 */
export interface MediaField {
  fieldName: string
}

/**
 * Extracts all media-type field descriptors from a content type definition.
 * @param typeDef - The content type definition to inspect.
 * @returns Array of MediaField descriptors for every field with fieldType 'media'.
 */
export function getMediaFields(typeDef: SchemaDefinition['types'][number]): MediaField[] {
  return flattenFields(typeDef.fields)
    .filter(f => f.fieldType === 'media')
    .map(f => ({ fieldName: f.name }))
}

/** url/thumbnailUrl/variantUrls when the adapter serves keys directly. */
function buildUrlFields(
  row: Record<string, any>,
  meta: Record<string, any>,
  storage: StorageAdapter,
): Record<string, unknown> {
  const url = storage.publicUrl(row.storagePath)
  if (!url) return {}
  const out: Record<string, unknown> = { url }
  if (row.thumbnailPath) out.thumbnailUrl = storage.publicUrl(row.thumbnailPath)
  const variants = (meta.variants ?? {}) as Record<string, { storagePath?: string }>
  const variantUrls: Record<string, string> = {}
  for (const [name, v] of Object.entries(variants)) {
    if (v?.storagePath) {
      const vUrl = storage.publicUrl(v.storagePath)
      if (vUrl) variantUrls[name] = vUrl
    }
  }
  if (Object.keys(variantUrls).length > 0) out.variantUrls = variantUrls
  return out
}

function buildAssetShape(row: Record<string, any>, locale?: string | null, storage?: StorageAdapter): Record<string, unknown> {
  const meta = (row.metadata ?? {}) as Record<string, any>
  // Per-locale editorial overrides (metadata.i18n) — alt text follows the read locale
  const i18nAlt = locale ? meta.i18n?.[locale]?.altText : undefined
  return {
    id: row.id,
    folderId: row.folderId ?? null,
    filename: row.filename,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width ?? null,
    height: row.height ?? null,
    altText: (typeof i18nAlt === 'string' && i18nAlt ? i18nAlt : row.altText) ?? null,
    tags: row.tags ?? [],
    storagePath: row.storagePath,
    thumbnailPath: row.thumbnailPath ?? null,
    // Which backend holds the files — null for pre-adapter (local) rows
    storage: typeof meta.storage === 'string' && meta.storage ? meta.storage : null,
    // Direct URLs when the storage adapter exposes them (CDN/public bucket);
    // absent → clients keep using the platform's /media proxy routes
    ...(storage ? buildUrlFields(row, meta, storage) : {}),
    variantsStatus: (meta.variantsStatus ?? 'complete') as VariantsStatus,
    variants: (meta.variants ?? {}) as Record<string, VariantMeta>,
    createdAt: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : String(row.createdAt ?? ''),
    createdBy: row.createdBy ?? null,
    localeAssets: meta.localeAssets && typeof meta.localeAssets === 'object' && Object.keys(meta.localeAssets).length > 0
      ? (meta.localeAssets as Record<string, string>)
      : null,
  }
}

/**
 * Replaces media field IDs in a result set with their full asset objects from the DB.
 * All asset IDs across all media fields are collected and fetched in a single query.
 * Fields whose ID has no matching asset are set to null.
 * @param rows - Content rows whose media fields contain asset ID strings.
 * @param mediaFields - Descriptors of which fields to expand.
 * @param db - Drizzle database client.
 * @param workspaceId - Workspace scope for the asset lookup.
 * @param locale - Non-default locale of the read; assets with a variant for it
 *   (metadata.localeAssets) are swapped for the variant asset.
 * @returns A new array of rows with media IDs replaced by asset shape objects.
 */
export async function expandMediaFields(
  rows: Record<string, unknown>[],
  mediaFields: MediaField[],
  db: any,
  workspaceId: string,
  locale?: string | null,
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0 || mediaFields.length === 0) return rows

  // Collect all unique media IDs across every media field in one pass
  const allIds = [
    ...new Set(
      mediaFields.flatMap(({ fieldName }) =>
        rows
          .map(r => r[fieldName])
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ),
  ]

  const assetMap = await loadAssetMap(allIds, db, workspaceId, locale)

  return rows.map(row => {
    const expanded = { ...row }
    for (const { fieldName } of mediaFields) {
      const id = row[fieldName]
      expanded[fieldName] =
        typeof id === 'string' && id.length > 0
          ? (assetMap.get(id) ?? null)
          : null
    }
    return expanded
  })
}

/**
 * Batch-loads asset shapes for a set of ids in one query (plus one more for
 * locale variants when a locale is read). Shared by the top-level and the deep
 * expansion so both produce the identical shape.
 */
async function loadAssetMap(
  allIds: string[],
  db: any,
  workspaceId: string,
  locale?: string | null,
): Promise<Map<string, Record<string, unknown>>> {
  const assetMap = new Map<string, Record<string, unknown>>()
  if (allIds.length === 0) return assetMap
  const storage = resolveStorageByIds(workspaceId)

  const assetRows = (await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        inArray(mediaAssets.id, allIds),
        eq(mediaAssets.workspaceId, workspaceId),
        ),
    )) as Record<string, any>[]

  for (const r of assetRows) {
    assetMap.set(r.id as string, buildAssetShape(r, locale, storage))
  }

  // Locale variants: swap each asset for its per-locale variant asset
  if (locale) {
    const variantIds = [
      ...new Set(
        assetRows
          .map(r => (r.metadata as any)?.localeAssets?.[locale])
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ]
    if (variantIds.length > 0) {
      const variantRows = (await db
        .select()
        .from(mediaAssets)
        .where(
          and(
            inArray(mediaAssets.id, variantIds),
            eq(mediaAssets.workspaceId, workspaceId),
            ),
        )) as Record<string, any>[]
      const variantMap = new Map(variantRows.map(r => [r.id as string, buildAssetShape(r, undefined, storage)]))
      for (const r of assetRows) {
        const variantId = (r.metadata as any)?.localeAssets?.[locale]
        const variant = variantId ? variantMap.get(variantId) : undefined
        if (variant) {
          assetMap.set(r.id as string, { ...variant, localizedFrom: r.id as string })
        }
      }
    }
  }

  return assetMap
}

// ─── Deep walk: media at any depth the schema declares ────────────────────────
// The walk itself lives in field-walker.ts - link resolution needs the same
// reach, and one walker means the two can never disagree about where a field
// of a given type can appear.

/** An asset object a read already expanded: carries an id string (the url may be absent on local storage). */
function isExpandedAsset(v: unknown): v is Record<string, unknown> & { id: string } {
  return isRecord(v) && typeof v.id === 'string' && v.id.length > 0
}

const mapMediaIn = (
  values: Record<string, unknown>,
  fields: AnyField[],
  inherited: ComponentDef[],
  registry: ComponentDef[],
  visit: MediaVisitor,
  nested: boolean,
) => mapFieldsOfType(values, fields, 'media', inherited, registry, visit, nested)

const declaresMedia = (fields: AnyField[], registry: ComponentDef[], seen: Set<ComponentDef>) =>
  declaresFieldType(fields, 'media', registry, seen)

/**
 * Every media asset id referenced by `rows` at any schema-declared position.
 * Already-expanded objects are not ids and are skipped.
 */
export function collectMediaIds(rows: Record<string, unknown>[], typeDef: TypeLike, registry: ComponentDef[] = []): Set<string> {
  const ids = new Set<string>()
  const collect: MediaVisitor = (value) => {
    if (typeof value === 'string' && value.length > 0) ids.add(value)
    return value
  }
  for (const row of rows) mapMediaIn(row, typeDef.fields, [], registry, collect, false)
  return ids
}

/**
 * Replaces media ids with asset objects at EVERY position the type declares:
 * top-level columns, group sub-fields, repeater rows, component blocks and the
 * containers nested inside them (columns, loop templates, children). One asset
 * query for the whole row set; locale variants are honoured exactly as the
 * top-level expansion honours them.
 *
 * Idempotent: a value that is already an asset object passes through, so a row
 * that was expanded once can be expanded again at no cost. A nested id with no
 * matching asset stays an id (the block's other props must survive a deleted
 * asset); a top-level one becomes null, which is the contract top-level reads
 * have always had.
 *
 * @param registry - The workspace's reusable components, for blocks declared
 *   by name. Optional: inline defs (the Builder Kit, most site blocks) need
 *   none, and an unknown name is skipped rather than thrown.
 */
export async function expandMediaDeep(
  rows: Record<string, unknown>[],
  typeDef: TypeLike,
  registry: ComponentDef[] | null | undefined,
  db: any,
  workspaceId: string,
  locale?: string | null,
): Promise<Record<string, unknown>[]> {
  const reg = registry ?? []
  if (rows.length === 0 || !declaresMedia(typeDef.fields, reg, new Set())) return rows

  const ids = collectMediaIds(rows, typeDef, reg)
  const assetMap = await loadAssetMap([...ids], db, workspaceId, locale)

  const expand: MediaVisitor = (value, { nested }) => {
    if (typeof value === 'string' && value.length > 0) {
      return assetMap.get(value) ?? (nested ? value : null)
    }
    if (isExpandedAsset(value)) return value
    return nested ? value : null
  }
  return rows.map((row) => mapMediaIn(row, typeDef.fields, [], reg, expand, false))
}

/**
 * Write-side inverse: folds an expanded asset object back to its id at every
 * media position, so a client that echoes a deep-expanded read (the editor's
 * autosave, a custom route copying an object) stores ids in JSONB, never a
 * snapshot of the asset. Ids, nulls and fields absent from the payload pass
 * through; returns the same object when nothing needed folding.
 */
export function collapseMediaDeep(
  values: Record<string, unknown>,
  typeDef: TypeLike,
  registry: ComponentDef[] | null | undefined,
): Record<string, unknown> {
  const collapse: MediaVisitor = (value) => (isExpandedAsset(value) ? value.id : value)
  return mapMediaIn(values, typeDef.fields, [], registry ?? [], collapse, false)
}
