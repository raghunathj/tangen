/**
 * File Name: porter-import.ts
 * Purpose: Import-side validation (Porter I-T1). Nothing writes until the
 *   bundle passes two gates: the format version (refuse newer majors) and
 *   the field-level schema fingerprint diffed against the TARGET env
 *   through the same A-T5 service every other Porter transport uses.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { porterProviderScope } from './extension-server'
import type { BundleManifest } from '@tangen/porter'
import { assertSupportedFormat } from '@tangen/porter'
import { computeSchemaDiff, loadTypeSchemas, type TypeSchema, type SchemaDiffEntry } from './schema-diff'

export interface BundleValidation {
  ok: boolean
  /** Per-type blockers: mismatched or missing-in-target bundle types. */
  blockers: SchemaDiffEntry[]
}

/**
 * The universal schema gate, bundle edition: the manifest's fingerprint is
 * the SOURCE side of the diff; extra types in the target are harmless.
 */
export async function validateBundleAgainstEnv(
  db: any,
  manifest: BundleManifest,
): Promise<BundleValidation> {
  assertSupportedFormat(manifest)
  const target = await loadTypeSchemas(db)
  const diff = computeSchemaDiff((manifest.schema ?? []) as TypeSchema[], target)
  const blockers = diff.entries.filter(
    (e) => e.status === 'mismatched' || e.status === 'missing_in_target',
  )
  return { ok: blockers.length === 0, blockers }
}

/**
 * Every component name an environment can render - the union of every
 * `components` list across its component fields. This is what a promoted
 * page's block types are checked against.
 */
export async function loadAvailableBlockTypes(db: any): Promise<string[]> {
  const out = new Set<string>()
  for (const t of await loadTypeSchemas(db)) {
    for (const f of (t as { fields?: Array<{ config?: unknown }> }).fields ?? []) {
      const comps = (f.config as { components?: unknown } | undefined)?.components
      if (!Array.isArray(comps)) continue
      for (const c of comps) {
        const name = typeof c === 'string' ? c : (c as { name?: unknown } | null)?.name
        if (typeof name === 'string' && name) out.add(name)
      }
    }
  }
  return [...out]
}

// ── import planning (I-T2) ───────────────────────────────────────────────────

import { eq, and, inArray, sql as dsql } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { mediaAssets } from '@tangen/db'
import type { StorageAdapter } from '@tangen/types'
import { openBundleReader } from '@tangen/porter'
import { collectBlockTypes, classifyMissingBlockTypes, type BlockTypeBlocker } from './porter-blocks'

export interface ImportOptions {
  /** DECIDED default 'match': id -> slug (handle) -> create. 'new' ignores both. */
  identityMode: 'match' | 'new'
  /** DECIDED default 'preserve': existing objects keep their target status;
   *  new objects arrive with the bundle's status. */
  statusMode: 'preserve' | 'mirror' | 'drafts'
}

export interface ImportItemPlan {
  typeName: string
  /** The object's id inside the bundle. */
  bundleId: string
  /** The id it will occupy in the target. */
  targetId: string
  action: 'create' | 'update'
  matchedBy?: 'id' | 'slug'
  title: string | null
  /** The slug it will carry (suffixed in 'new' mode when taken). */
  slug: string | null
}

export interface ImportMediaPlan {
  bundleId: string
  targetId: string
  action: 'create' | 'update' | 'reuse'
  sha256?: string
  filename?: string
}

export interface ImportPlan {
  items: ImportItemPlan[]
  media: ImportMediaPlan[]
  counts: Record<string, number>
  /**
   * Blocks the TARGET cannot render. The schema gate never saw these,
   * because they live inside component field VALUES rather than in the
   * schema - so a page using an undeployed component used to import
   * cleanly and appear blank on the live site.
   */
  blockTypeBlockers: BlockTypeBlocker[]
  /** bundle object/media id -> target id, for reference remapping at commit. */
  idRemap: Record<string, string>
}

export interface PlanBundleImportInput {
  db: any
  workspaceId: string
  /**
   * Every component name the TARGET can render. Required rather than
   * resolved here on purpose: a caller that forgets would silently skip the
   * check, and a safety gate that can quietly do nothing is worse than none.
   */
  availableBlockTypes: string[]
  bundleStorage: StorageAdapter
  bundleId: string
  tables: Record<string, any>
  options: ImportOptions
}

/** Streams the bundle and plans every item with ZERO writes. */
export async function planBundleImport(input: PlanBundleImportInput): Promise<ImportPlan> {
  const { db, workspaceId } = input
  const reader = await openBundleReader(input.bundleStorage, input.bundleId)
  assertSupportedFormat(reader.manifest)

  const items: ImportItemPlan[] = []
  const idRemap: Record<string, string> = {}
  /** Gathered as rows stream past, so this costs no second pass. */
  const usedBlockTypes = new Set<string>()
  const usedSlugs = new Map<string, Set<string>>()   // typeName -> slugs claimed this plan

  for (const sectionName of Object.keys(reader.manifest.sections)) {
    if (!sectionName.startsWith('objects/')) continue
    const typeName = sectionName.slice('objects/'.length)
    const table = input.tables[typeName]
    if (!table) continue
    const claimed = usedSlugs.get(typeName) ?? new Set<string>()
    usedSlugs.set(typeName, claimed)

    for await (const entry of reader.readSection(sectionName)) {
      const row = (entry as any).row as Record<string, unknown>
      const bundleId = row.id as string
      const slug = (row.slug as string | null | undefined) ?? null
      const title = (row.title as string | null | undefined) ?? null
      for (const t of collectBlockTypes(row)) usedBlockTypes.add(t)

      if (input.options.identityMode === 'new') {
        const targetId = mintId()
        const finalSlug = slug
          ? await freeSlug(db, table, workspaceId, slug, claimed)
          : null
        if (finalSlug) claimed.add(finalSlug)
        items.push({ typeName, bundleId, targetId, action: 'create', title, slug: finalSlug })
        idRemap[bundleId] = targetId
        continue
      }

      // cascade: id -> slug -> create
      const [byId] = await db.select({ id: table.id }).from(table)
        .where(and(eq(table.id, bundleId), eq(table.workspaceId, workspaceId)))
        .limit(1)
      if (byId) {
        items.push({ typeName, bundleId, targetId: bundleId, action: 'update', matchedBy: 'id', title, slug })
        idRemap[bundleId] = bundleId
        continue
      }
      if (slug) {
        const [bySlug] = await db.select({ id: table.id }).from(table)
          .where(and(eq(table.slug, slug), eq(table.workspaceId, workspaceId)))
          .limit(1)
        if (bySlug) {
          items.push({ typeName, bundleId, targetId: bySlug.id as string, action: 'update', matchedBy: 'slug', title, slug })
          idRemap[bundleId] = bySlug.id as string
          continue
        }
      }
      items.push({ typeName, bundleId, targetId: bundleId, action: 'create', title, slug })
      idRemap[bundleId] = bundleId
    }
  }

  // ── media: id -> sha256 -> create ─────────────────────────────────────────
  const media: ImportMediaPlan[] = []
  for await (const entry of reader.readSection('media/index')) {
    const asset = (entry as any).asset as Record<string, unknown>
    const sha256 = (entry as any).sha256 as string | undefined
    const filename = (entry as any).filename as string | undefined
    const bundleAssetId = asset.id as string

    const [byId] = await db.select({ id: mediaAssets.id }).from(mediaAssets)
      .where(and(
        eq(mediaAssets.id, bundleAssetId),
        eq(mediaAssets.workspaceId, workspaceId),
        ))
      .limit(1)
    if (byId) {
      media.push({ bundleId: bundleAssetId, targetId: bundleAssetId, action: 'update', sha256, filename })
      idRemap[bundleAssetId] = bundleAssetId
      continue
    }
    if (sha256) {
      const [byHash] = await db.select({ id: mediaAssets.id }).from(mediaAssets)
        .where(and(
          eq(mediaAssets.workspaceId, workspaceId),
          dsql`${mediaAssets.metadata}->>'sha256' = ${sha256}`,
        ))
        .limit(1)
      if (byHash) {
        media.push({ bundleId: bundleAssetId, targetId: byHash.id as string, action: 'reuse', sha256, filename })
        idRemap[bundleAssetId] = byHash.id as string
        continue
      }
    }
    // media_assets identity is id-ONLY (no composite key): a same-instance
    // import must mint a fresh id when the bundle id lives in ANOTHER env.
    let targetId = bundleAssetId
    if (input.options.identityMode === 'new') {
      targetId = `med_${randomBytes(12).toString('hex')}`
    } else {
      const [anywhere] = await db.select({ id: mediaAssets.id }).from(mediaAssets)
        .where(eq(mediaAssets.id, bundleAssetId))
        .limit(1)
      if (anywhere) targetId = `med_${randomBytes(12).toString('hex')}`
    }
    media.push({ bundleId: bundleAssetId, targetId, action: 'create', sha256, filename })
    idRemap[bundleAssetId] = targetId
  }

  const counts: Record<string, number> = {}
  for (const item of items) counts[item.action] = (counts[item.action] ?? 0) + 1
  const blockTypeBlockers = classifyMissingBlockTypes([...usedBlockTypes], input.availableBlockTypes)

  return { items, media, counts, idRemap, blockTypeBlockers }
}

function mintId(): string {
  return randomBytes(16).toString('hex')
}

/** First free variant of a slug: base, base-2, base-3 ... (db + plan-claimed). */
async function freeSlug(
  db: any,
  table: any,
  workspaceId: string,
  base: string,
  claimed: Set<string>,
): Promise<string> {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`
    if (claimed.has(candidate)) continue
    const [row] = await db.select({ id: table.id }).from(table)
      .where(and(eq(table.slug, candidate), eq(table.workspaceId, workspaceId)))
      .limit(1)
    if (!row) return candidate
  }
}

// ── import commit (I-T3) ─────────────────────────────────────────────────────

import { entityTags } from '@tangen/db'
import { getTableColumns } from 'drizzle-orm'
import { deleteI18nRows, upsertI18nRow } from './i18n'
import { createRevision } from '../lib/revisions'
import { getPorterProvider, sortProvidersByDependency, type PorterProvider, type PorterProviderResult } from './porter-providers'

/** JSONL round-trips Dates as ISO strings - timestamp columns want Dates back. */
function coerceRowForTable(table: any, values: Record<string, unknown>): Record<string, unknown> {
  const columns = getTableColumns(table) as Record<string, { dataType?: string }>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (columns[key]?.dataType === 'date' && typeof value === 'string') {
      const d = new Date(value)
      out[key] = Number.isNaN(d.getTime()) ? value : d
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * Commit works from an ALREADY-planned import, so it does not need the
 * target's vocabulary - planning resolved that, and the worker refuses to
 * reach commit when the plan reported blockers.
 */
export interface CommitBundleImportInput extends Omit<PlanBundleImportInput, 'availableBlockTypes'> {
  mediaStorage: StorageAdapter
  plan: ImportPlan
  createdBy: string
  /** Version-history parity: per-type revision settings (typeName -> typeId
   *  + maxVersions). Types absent from the map get no snapshot (unknown type
   *  or versioning disabled) - callers resolve from the target env schema. */
  revision?: Record<string, { typeId: string; maxVersions?: number }>
  /** Provider resolution - workspace-aware callers pass getWorkspaceProvider
   *  bound to the project so table:* providers resolve; defaults to the
   *  static registry. */
  providerFor?: (key: string) => PorterProvider | undefined
  /** R-T5 fast path: fetches media bytes that are NOT in the bundle (they
   *  travelled by presigned URL instead). Tried only when the bundle has no
   *  bytes for an asset; absence of both fails the asset honestly. */
  mediaFetch?: (assetId: string, filename: string) => Promise<Uint8Array | null>
}

export interface ImportResultEntry {
  typeName: string
  targetId: string
  bundleId: string
  outcome: 'created' | 'updated' | 'failed'
  error?: string
}

export interface CommitBundleImportOutput {
  results: ImportResultEntry[]
  mediaWritten: number
  failed: number
  /** Per-provider definition counts (providers/<key> sections applied). */
  providers?: Record<string, PorterProviderResult>
}

/** Keys never copied from a bundle row into a target row. */
const ROW_IDENTITY_KEYS = new Set(['id', 'workspaceId'])
/** Publish-state keys governed by statusMode. */
const STATUS_KEYS = ['status', 'publishedAt', 'publishedBy', 'publishedValues', 'scheduledAt'] as const

/** Applies the plan: media first (references must resolve), then objects. */
export async function commitBundleImport(input: CommitBundleImportInput): Promise<CommitBundleImportOutput> {
  const { db, workspaceId, plan } = input
  const reader = await openBundleReader(input.bundleStorage, input.bundleId)
  const results: ImportResultEntry[] = []
  let mediaWritten = 0

  // ── media first ───────────────────────────────────────────────────────────
  const mediaPlanById = new Map(plan.media.map((m) => [m.bundleId, m]))
  for await (const entry of reader.readSection('media/index')) {
    const asset = (entry as any).asset as Record<string, any>
    const sha256 = (entry as any).sha256 as string | undefined
    const filename = ((entry as any).filename as string | undefined) || 'original'
    const m = mediaPlanById.get(asset.id as string)
    if (!m) continue

    if (m.action === 'reuse') continue   // byte-identical target asset already exists

    // Skip bytes when the target already holds this exact content (failover
    // rule: never re-upload what is already there).
    let writeBytes = true
    if (m.action === 'update') {
      const [existing] = await db.select({ metadata: mediaAssets.metadata }).from(mediaAssets)
        .where(and(eq(mediaAssets.id, m.targetId), eq(mediaAssets.workspaceId, workspaceId)))
        .limit(1)
      if (existing && (existing.metadata as any)?.sha256 === sha256 && sha256) writeBytes = false
    }

    const storagePath = `${workspaceId}/${m.targetId}/${filename}`
    if (writeBytes) {
      const bytes = await reader.readMediaFile(asset.id as string, filename)
        ?? await input.mediaFetch?.(asset.id as string, filename)
        ?? null
      if (!bytes) throw new Error(`bundle is missing media bytes for ${asset.id}`)
      await input.mediaStorage.write(storagePath, bytes, { contentType: asset.mimeType as string })
      mediaWritten += 1
    }

    const rowValues = {
      ...Object.fromEntries(Object.entries(asset).filter(([k]) => !ROW_IDENTITY_KEYS.has(k))),
      id: m.targetId,
      workspaceId,
      folderId: null,   // folders are env-local structure
      storagePath,
      thumbnailPath: null,
      metadata: { ...((asset.metadata as Record<string, unknown>) ?? {}), sha256, importedFrom: asset.id },
    }
    const coerced = coerceRowForTable(mediaAssets, rowValues)
    if (m.action === 'update') {
      await db.update(mediaAssets).set(coerced)
        .where(and(eq(mediaAssets.id, m.targetId), eq(mediaAssets.workspaceId, workspaceId)))
    } else {
      await db.insert(mediaAssets).values(coerced)
    }
  }

  // ── objects, per-item transactions ───────────────────────────────────────
  const itemsByBundleId = new Map(plan.items.map((i) => [`${i.typeName}:${i.bundleId}`, i]))
  for (const sectionName of Object.keys(reader.manifest.sections)) {
    if (!sectionName.startsWith('objects/')) continue
    const typeName = sectionName.slice('objects/'.length)
    const table = input.tables[typeName]
    if (!table) continue
    const entityType = `content:${typeName}`

    for await (const entry of reader.readSection(sectionName)) {
      const bundleRow = (entry as any).row as Record<string, unknown>
      const i18nRows = ((entry as any).i18n ?? []) as Record<string, unknown>[]
      const labels = ((entry as any).labels ?? []) as string[]
      const item = itemsByBundleId.get(`${typeName}:${bundleRow.id as string}`)
      if (!item) continue

      try {
        await db.transaction(async (tx: any) => {
          const remapped = applyIdRemap(bundleRow, plan.idRemap) as Record<string, unknown>
          let fields = Object.fromEntries(
            Object.entries(remapped).filter(([k]) => !ROW_IDENTITY_KEYS.has(k)),
          )
          if (item.slug !== undefined) fields.slug = item.slug

          if (input.options.statusMode === 'drafts') {
            fields = { ...fields, status: 'draft', publishedAt: null, publishedBy: null, publishedValues: null, scheduledAt: null }
          } else if (input.options.statusMode === 'preserve' && item.action === 'update') {
            for (const k of STATUS_KEYS) delete (fields as Record<string, unknown>)[k]
          }
          // mirror: bundle values pass through untouched

          const coercedFields = coerceRowForTable(table, fields)
          if (item.action === 'update') {
            await tx.update(table).set(coercedFields)
              .where(and(eq(table.id, item.targetId), eq(table.workspaceId, workspaceId)))
          } else {
            await tx.insert(table).values({ ...coercedFields, id: item.targetId, workspaceId })
          }

          // C5: importing as drafts takes the row offline, so its extension
          // state comes offline with it. Without this an object forced to
          // draft on import keeps the target environment's last published
          // extension snapshot, and reads as unchanged since publish.
          if (input.options.statusMode === 'drafts') {
            const { syncPublishedExtensionData } = await import('../hooks/runner')
            await syncPublishedExtensionData(tx, null, workspaceId, item.targetId, 'draft')
          }

          // i18n full-replace (guarded: types without a side table have none)
          await deleteI18nRows(tx, typeName, [item.targetId])
          for (const side of i18nRows) {
            const values = applyIdRemap(
              Object.fromEntries(Object.entries(side).filter(([k]) => !['objectId', 'locale', 'updatedAt'].includes(k))),
              plan.idRemap,
            ) as Record<string, unknown>
            await upsertI18nRow(tx, typeName, item.targetId, side.locale as string, values)
          }

          // labels full-replace
          await tx.delete(entityTags).where(and(
            eq(entityTags.workspaceId, workspaceId),
            eq(entityTags.entityType, entityType),
            eq(entityTags.entityId, item.targetId),
          ))
          for (const tag of labels) {
            await tx.insert(entityTags).values({
              workspaceId, entityType, entityId: item.targetId,
              tag, source: 'user', createdBy: input.createdBy,
            })
          }

          // Version snapshot of what was just written (versionType
          // 'migration') - the import shows up in history like a save.
          const rev = input.revision?.[typeName]
          if (rev) {
            await createRevision(tx, {
              objectId: item.targetId,
              workspaceId,
              typeId: rev.typeId,
              typeName,
              row: { ...coercedFields, id: item.targetId, workspaceId },
              createdBy: input.createdBy,
              maxVersions: rev.maxVersions,
              versionType: 'migration',
            })
          }
        })
        results.push({
          typeName,
          targetId: item.targetId,
          bundleId: item.bundleId,
          outcome: item.action === 'update' ? 'updated' : 'created',
        })
      } catch (err: any) {
        results.push({
          typeName,
          targetId: item.targetId,
          bundleId: item.bundleId,
          outcome: 'failed',
          error: String(err?.message ?? err),
        })
      }
    }
  }

  // ── syncProvider definitions (forms/flows/custom tables) ─────────────────
  // Parents import before children (dependsOn from table references), so an
  // 8-table graph resolves every foreign key on the first pass.
  const providers: Record<string, PorterProviderResult> = {}
  const providerFor = input.providerFor ?? getPorterProvider
  const providerKeys = Object.keys(reader.manifest.sections)
    .filter((s2) => s2.startsWith('providers/'))
    .map((s2) => s2.slice('providers/'.length))
  const orderedKeys = sortProvidersByDependency(providerKeys, (k) => providerFor(k)?.dependsOn ?? [])
  for (const key of orderedKeys) {
    const provider = providerFor(key)
    if (!provider) continue   // receiver has no such provider - section stays archival
    const rows: Record<string, unknown>[] = []
    for await (const entry of reader.readSection(`providers/${key}`)) rows.push(entry as Record<string, unknown>)
    try {
      // The plan's remap goes WITH the rows: a provider that carries media
      // references (Studio's classes and presets) has to follow its assets
      // to the ids they took in the target, exactly as content does.
      const scope = porterProviderScope(provider, db, workspaceId)
      providers[key] = await provider.importRows(scope.db, workspaceId, rows, { idRemap: plan.idRemap, store: scope.store })
    } catch (err: any) {
      results.push({ typeName: `provider:${key}`, targetId: key, bundleId: key, outcome: 'failed', error: String(err?.message ?? err) })
    }
  }

  const failed = results.filter((r) => r.outcome === 'failed').length
  return { results, mediaWritten, failed, providers }
}

/**
 * Rewrites bundle ids to target ids everywhere a reference can live: whole
 * string values, array elements and med_ tokens inside larger strings.
 * Nested repeater/component content ids inside rich text are NOT touched
 * (documented limitation until the provider contract).
 */
export function applyIdRemap(value: unknown, remap: Record<string, string>): unknown {
  if (typeof value === 'string') {
    const direct = remap[value]
    if (direct) return direct
    return value.replace(/med_[0-9a-f]{16,64}/g, (id) => remap[id] ?? id)
  }
  if (Array.isArray(value)) return value.map((v) => applyIdRemap(v, remap))
  if (value && typeof value === 'object' && (value as any).constructor === Object) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, applyIdRemap(v, remap)]),
    )
  }
  return value
}
