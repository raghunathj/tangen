/**
 * File Name: porter-export.ts
 * Purpose: Content + media exporter (Porter E-T2). Streams a scoped slice
 *   of one environment into a sealed @tangen/porter bundle: per object the
 *   row, its i18n side rows and its labels; every referenced media asset
 *   as an index entry (sha256 of the bytes - the import side's skip key)
 *   plus the raw file. Scoping: types, labels, status, updatedSince.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A missing media FILE fails the export loudly - a
 *   bundle that silently lacks bytes would import a broken site. Rows
 *   stream in id order per type; media dedupes across objects.
 */
import { porterProviderScope } from './extension-server'
import { eq, and, inArray, gt, asc } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { entityTags, mediaAssets, extensionData } from '@tangen/db'
import type { StorageAdapter } from '@tangen/types'
import { createBundleWriter } from '@tangen/porter'
import { fetchI18nRows } from './i18n'
import { collectMediaIds } from './media-migrator'
import { getPorterProvider, sortProvidersByDependency, type PorterProvider } from './porter-providers'

export interface ExportScope {
  /** Type names to export; empty/absent = every type in `types`. */
  types?: string[]
  /** Only objects carrying at least one of these labels. */
  labels?: string[]
  /** Only objects with this status. */
  status?: string
  /** Only objects updated at/after this ISO timestamp. */
  updatedSince?: string
  /** Export EVERY media asset of the env (not just referenced ones). */
  mediaAll?: boolean
  /** syncProvider keys (forms/flows/...) whose DEFINITIONS ride along in
   *  providers/<key> sections - the only sections import APPLIES for
   *  extension data (the raw extension-data section is archive-only). */
  providers?: string[]
}

export interface ExportInput {
  db: any
  workspaceId: string
  bundleId: string
  /** Where the bundle is written. */
  bundleStorage: StorageAdapter
  /** Where the source media bytes live. */
  mediaStorage: StorageAdapter
  tables: Record<string, any>
  types: { name: string; localized?: boolean }[]
  scope: ExportScope
  /** schema-diff TypeSchema[] of the exported types - the manifest's contract. */
  schemaFingerprint: unknown[]
  createdAt: string
  createdBy: string
  /** Rows per query page (and JSONL flush granularity). */
  pageSize?: number
  /** Export extension_data for the ws+env (carries flow definitions and all
   *  extension state - the KV store's object_id is the key). Default true. */
  includeExtensionData?: boolean
  /** Custom tables to export (rows are ws+env scoped like content). */
  customTables?: { name: string; table: any }[]
  /** Provider resolution - workspace-aware callers pass getWorkspaceProvider
   *  bound to the project so table:* providers resolve; defaults to the
   *  static registry. */
  providerFor?: (key: string) => PorterProvider | undefined
}

export interface ExportOutput {
  bundleId: string
  counts: Record<string, number>
}

export async function exportContentToBundle(input: ExportInput): Promise<ExportOutput> {
  const { db, workspaceId } = input
  const pageSize = input.pageSize ?? 200
  const writer = createBundleWriter(input.bundleStorage, input.bundleId, { flushEvery: pageSize })

  const wantedTypes = input.types.filter(
    (t) => !input.scope.types || input.scope.types.length === 0 || input.scope.types.includes(t.name),
  )

  const referencedMedia = new Set<string>()

  for (const type of wantedTypes) {
    const table = input.tables[type.name]
    if (!table) continue
    const section = writer.section(`objects/${type.name}`)
    const entityType = `content:${type.name}`

    // Label scope resolves to an id allow-list up front (empty -> nothing).
    let labelIds: Set<string> | null = null
    if (input.scope.labels && input.scope.labels.length > 0) {
      const rows = await db.select({ entityId: entityTags.entityId }).from(entityTags)
        .where(and(
          eq(entityTags.workspaceId, workspaceId),
          eq(entityTags.entityType, entityType),
          inArray(entityTags.tag, input.scope.labels),
        )) as { entityId: string }[]
      labelIds = new Set(rows.map((r) => r.entityId))
      if (labelIds.size === 0) { await section.close(); continue }
    }

    const conds: any[] = [eq(table.workspaceId, workspaceId)]
    if (input.scope.status) conds.push(eq(table.status, input.scope.status))
    if (input.scope.updatedSince) conds.push(gt(table.updatedAt, new Date(input.scope.updatedSince)))
    if (labelIds) conds.push(inArray(table.id, [...labelIds]))

    for (let offset = 0; ; offset += pageSize) {
      const rows = await db.select().from(table)
        .where(and(...conds))
        .orderBy(asc(table.id))
        .limit(pageSize)
        .offset(offset) as Record<string, unknown>[]
      if (rows.length === 0) break

      const ids = rows.map((r) => r.id as string)
      const i18nRows = await fetchI18nRows(db, type.name, ids, 'all')
      const tagRows = await db.select({ entityId: entityTags.entityId, tag: entityTags.tag }).from(entityTags)
        .where(and(
          eq(entityTags.workspaceId, workspaceId),
          eq(entityTags.entityType, entityType),
          inArray(entityTags.entityId, ids),
        )) as { entityId: string; tag: string }[]

      for (const row of rows) {
        const id = row.id as string
        for (const med of collectMediaIds(row)) referencedMedia.add(med)
        const i18n = i18nRows.filter((r) => r.objectId === id)
        for (const med of collectMediaIds(i18n)) referencedMedia.add(med)
        section.append({
          row,
          i18n,
          labels: tagRows.filter((t) => t.entityId === id).map((t) => t.tag).sort(),
        })
      }
      if (rows.length < pageSize) break
    }
    await section.close()
  }

  // ── syncProvider rows are resolved HERE, before the media section, even
  // though their sections are written further down: a provider that declares
  // `mediaIds` (Studio's classes, presets and font files) contributes to the
  // SAME referenced-media set content does, so the bytes ride the ordinary
  // media/index section and the import plan remaps their ids like any other
  // reference. A provider that declares nothing is untouched. ─────────────
  const exportProviderFor = input.providerFor ?? getPorterProvider
  const orderedProviderKeys = sortProvidersByDependency(
    input.scope.providers ?? [],
    (k) => exportProviderFor(k)?.dependsOn ?? [],
  )
  const providerRows = new Map<string, Record<string, unknown>[]>()
  for (const key of orderedProviderKeys) {
    const provider = exportProviderFor(key)
    if (!provider) continue
    const scope = porterProviderScope(provider, db, workspaceId)
    const rows = await provider.exportRows(scope.db, workspaceId, { store: scope.store })
    providerRows.set(key, rows)
    for (const id of provider.mediaIds?.(rows) ?? []) referencedMedia.add(id)
  }

  // ── media: index + bytes, deduped. mediaAll ships the whole library ──────
  const mediaSection = writer.section('media/index')
  if (input.scope.mediaAll || referencedMedia.size > 0) {
    const mediaConds = [
      eq(mediaAssets.workspaceId, workspaceId),
      ]
    if (!input.scope.mediaAll) mediaConds.push(inArray(mediaAssets.id, [...referencedMedia]))
    if (input.scope.mediaAll && input.scope.updatedSince) {
      mediaConds.push(gt(mediaAssets.createdAt, new Date(input.scope.updatedSince)))
    }
    const assets = await db.select().from(mediaAssets)
      .where(and(...mediaConds)) as Record<string, any>[]

    for (const asset of assets) {
      const bytes = await input.mediaStorage.read(asset.storagePath as string)
      if (!bytes) {
        throw new Error(`media file missing for ${asset.id}: ${asset.storagePath}`)
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const filename = (asset.filename as string) || 'original'
      await writer.writeMediaFile(asset.id as string, filename, bytes, asset.mimeType as string)
      mediaSection.append({ asset, sha256, filename })
    }
  }
  await mediaSection.close()

  // ── extension data (flow definitions ride here - ctx.store is
  // extension_data with object_id as the KV key) ────────────────────────────
  if (input.includeExtensionData !== false) {
    const section = writer.section('extension-data')
    for (let offset = 0; ; offset += pageSize) {
      const rows = await db.select().from(extensionData)
        .where(and(eq(extensionData.workspaceId, workspaceId)))
        .orderBy(asc(extensionData.id))
        .limit(pageSize)
        .offset(offset) as Record<string, unknown>[]
      if (rows.length === 0) break
      for (const row of rows) section.append(row)
      if (rows.length < pageSize) break
    }
    await section.close()
  }

  // ── syncProvider definitions (forms/flows/... - the applied sections) ─────
  for (const key of orderedProviderKeys) {
    const rows = providerRows.get(key)
    if (!rows) continue
    const section = writer.section(`providers/${key}`)
    for (const row of rows) section.append(row)
    await section.close()
  }

  // ── custom tables ─────────────────────────────────────────────────────────
  for (const custom of input.customTables ?? []) {
    const section = writer.section(`custom-tables/${custom.name}`)
    const t = custom.table
    for (let offset = 0; ; offset += pageSize) {
      const rows = await db.select().from(t)
        .where(eq(t.workspaceId, workspaceId))
        .orderBy(asc(t.id))
        .limit(pageSize)
        .offset(offset) as Record<string, unknown>[]
      if (rows.length === 0) break
      for (const row of rows) section.append(row)
      if (rows.length < pageSize) break
    }
    await section.close()
  }

  await writer.seal({
    workspaceId,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    schema: input.schemaFingerprint,
    scope: input.scope as Record<string, unknown>,
  })

  // The writer tracked honest per-section counts; read them back off the
  // sealed manifest so callers get one truth.
  const manifestBytes = await input.bundleStorage.read(`porter/bundles/${input.bundleId}/manifest.json`)
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes!))
  return { bundleId: input.bundleId, counts: manifest.counts }
}
