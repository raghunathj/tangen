/**
 * File Name: indexer.ts
 * Purpose: Indexing orchestration — turns one source (content object, table
 *          row, file) into chunks and keeps the store in sync: hash-skip
 *          when nothing changed, replace when it did, delete on removal.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure orchestration over the injected store + adapter;
 *          the host decides WHEN to call (publish hooks, CLI backfill).
 */
import type { EmbeddingAdapter, ObjectTypeDefinition } from '@tangen/types'
import { chunkText, valueToText, contentHash, type ChunkOptions } from './chunker'
import { knowledgeFields, typeAudience } from './config'
import type { KnowledgeStore, KnowledgeChunk, SourceKind } from './store'

export interface IndexerDeps {
  store: KnowledgeStore
  adapter: EmbeddingAdapter
  chunking: ChunkOptions
  workspaceId: string
}

export interface IndexResult {
  action: 'indexed' | 'skipped' | 'removed' | 'empty'
  chunks: number
}

interface SourceText {
  field: string
  text: string
  /** '' = default locale. */
  locale?: string
}

async function syncSource(
  deps: IndexerDeps,
  scope: { sourceKind: SourceKind; sourceId: string; sourceGroup: string; audience?: string },
  texts: SourceText[],
  metadata: Record<string, unknown> = {},
): Promise<IndexResult> {
  const pieces = texts
    .map((t) => ({ field: t.field, locale: t.locale ?? '', chunks: chunkText(t.text, deps.chunking) }))
    .filter((p) => p.chunks.length > 0)

  if (pieces.length === 0) {
    await deps.store.deleteSource(deps.workspaceId, scope.sourceKind, scope.sourceId)
    return { action: 'empty', chunks: 0 }
  }

  const flat = pieces.flatMap((p) => p.chunks.map((c) => ({ field: p.field, locale: p.locale, content: c.content })))
  const audience = scope.audience ?? 'public'
  // Audience participates in the hash — flipping it re-embeds (stale-ACL guard)
  const hashes = flat.map((c) => contentHash(`${audience} ${c.locale} ${c.field} ${c.content}`))

  // Skip when the exact chunk set already exists (order-insensitive)
  const existing = await deps.store.sourceHashes(deps.workspaceId, scope.sourceKind, scope.sourceId)
  if (existing.length > 0 && existing.length === new Set(hashes).size
      && hashes.every((h) => existing.includes(h))) {
    return { action: 'skipped', chunks: flat.length }
  }

  const embeddings = await deps.adapter.embed(flat.map((c) => c.content))
  const rows: KnowledgeChunk[] = flat.map((c, i) => ({
    workspaceId: deps.workspaceId,
    sourceKind: scope.sourceKind,
    sourceId: scope.sourceId,
    sourceGroup: scope.sourceGroup,
    field: c.field,
    locale: c.locale,
    audience,
    chunkIndex: i,
    content: c.content,
    contentHash: hashes[i],
    metadata,
    embedding: embeddings[i],
  }))
  await deps.store.replaceSource(rows, {
    workspaceId: deps.workspaceId, sourceKind: scope.sourceKind, sourceId: scope.sourceId,
  })
  return { action: 'indexed', chunks: rows.length }
}

/**
 * Index one published content object (title + opted-in fields). Pass the
 * side-table translations as opts.i18n ({ locale: { field: value } }) to
 * embed per-locale chunks — retrieval never mixes languages (chunks carry
 * their locale; '' = default).
 */
export async function syncObject(
  deps: IndexerDeps,
  type: ObjectTypeDefinition,
  row: Record<string, unknown>,
  opts: { i18n?: Record<string, Record<string, unknown>> } = {},
): Promise<IndexResult> {
  const fields = knowledgeFields(type)
  const texts: SourceText[] = [
    { field: 'title', text: valueToText(row.title) },
    ...fields.map((f) => ({ field: f, text: valueToText(row[f]) })),
  ]
  for (const [locale, values] of Object.entries(opts.i18n ?? {})) {
    if (!locale) continue
    if (values.title != null) texts.push({ field: 'title', locale, text: valueToText(values.title) })
    for (const f of fields) {
      if (values[f] != null) texts.push({ field: f, locale, text: valueToText(values[f]) })
    }
  }
  return syncSource(
    deps,
    { sourceKind: 'object', sourceId: String(row.id), sourceGroup: type.name, audience: typeAudience(type) },
    texts.filter((t) => t.text.trim().length > 0),
    { title: row.title ?? null, slug: row.slug ?? null, type: type.name },
  )
}

/** Remove a source (unpublish, archive, delete). */
export async function removeSource(
  deps: Pick<IndexerDeps, 'store' | 'workspaceId'>,
  sourceKind: SourceKind,
  sourceId: string,
): Promise<IndexResult> {
  await deps.store.deleteSource(deps.workspaceId, sourceKind, sourceId)
  return { action: 'removed', chunks: 0 }
}

/** Index one custom-table row over its opted-in columns. */
export async function syncTableRow(
  deps: IndexerDeps,
  table: { name: string; columns: string[]; audience?: string },
  row: Record<string, unknown>,
): Promise<IndexResult> {
  const texts = table.columns
    .map((c) => ({ field: c, text: valueToText(row[c]) }))
    .filter((t) => t.text.trim().length > 0)
  return syncSource(
    deps,
    { sourceKind: 'table', sourceId: String(row.id), sourceGroup: table.name, audience: table.audience },
    texts,
    { table: table.name },
  )
}

/** Index one repo file / extracted document. */
export async function syncDocument(
  deps: IndexerDeps,
  doc: { sourceKind: 'file' | 'asset'; sourceId: string; group: string; text: string; audience?: string; metadata?: Record<string, unknown> },
): Promise<IndexResult> {
  return syncSource(
    deps,
    { sourceKind: doc.sourceKind, sourceId: doc.sourceId, sourceGroup: doc.group, audience: doc.audience },
    [{ field: '', text: doc.text }],
    doc.metadata ?? {},
  )
}

/**
 * Index one curated Q&A pair (question + answer as one passage; the
 * question doubles as the citation title). Disabled pairs are removed —
 * the row survives for re-enabling, the chunks don't.
 */
export async function syncQa(
  deps: IndexerDeps,
  qa: { id: string; question: string; answer: string; audience?: string; enabled?: boolean },
): Promise<IndexResult> {
  if (qa.enabled === false) return removeSource(deps, 'qa', qa.id)
  return syncSource(
    deps,
    { sourceKind: 'qa', sourceId: qa.id, sourceGroup: 'qa', audience: qa.audience },
    [{ field: '', text: `${qa.question}\n\n${qa.answer}` }],
    { title: qa.question, qa: true },
  )
}

/** Rough word count for CLI cost estimates (tokens ≈ words × 1.3). */
export function estimateWords(texts: string[]): number {
  return texts.reduce((n, t) => n + (t.trim() ? t.trim().split(/\s+/).length : 0), 0)
}
