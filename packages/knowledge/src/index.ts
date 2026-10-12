/**
 * File Name: index.ts
 * Purpose: @tangen/knowledge — RAG for Tangen CMS as an independent,
 *          optionally-installed package: config resolution, the pgvector
 *          chunk store (SQL over an injected executor), chunker, embedding
 *          adapters, and search/ask orchestration. The API and CLI import
 *          this lazily and only when a workspace enables knowledge.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends ONLY on @tangen/types.
 */
export {
  resolveKnowledgeConfig, requireEmbeddingsConfig, PROVIDER_MENU,
  knowledgeTypes, knowledgeFields, knowledgeTables, typeAudience,
  type ResolvedKnowledgeConfig,
} from './config'
export { getEmbeddingAdapter, splitAdapterName, vectorSpaceName } from './embeddings'
export { buildAskPrompt, buildCitations, type AskCitation } from './ask'
export { extractText, type DocumentExtractor, type ExtractResult } from './extract'
export {
  syncObject, syncTableRow, syncDocument, syncQa, removeSource, estimateWords,
  type IndexerDeps, type IndexResult,
} from './indexer'
export { createQaStore, type QaStore, type KnowledgeQaRow, type QaUpsert } from './qa'
export { createInsightsStore, type InsightsStore, type QueryLogEntry, type QueryInsightRow } from './insights'
export { chunkText, valueToText, contentHash, type TextChunk, type ChunkOptions } from './chunker'
export {
  createKnowledgeStore, friendlyVectorError,
  type KnowledgeStore, type KnowledgeChunk, type KnowledgeHit,
  type SqlExec, type SourceKind, type PreflightResult,
} from './store'
