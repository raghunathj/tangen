/**
 * File Name: knowledge.ts
 * Purpose: The Knowledge (RAG) tables, declared where every other system
 *          table is declared. `knowledge_meta` pins the vector space of one
 *          workspace x environment (provider, model, dimensions);
 *          `knowledge_chunks` holds the embedded chunks; `knowledge_qa` the
 *          curated question/answer pairs; `knowledge_queries` the retrieval
 *          log the Insights screen reads.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm/pg-core. Migration 0041 creates these; the
 *          canonical DDL text lives in ../knowledge-schema.ts and the test
 *          proves the migration carries it verbatim. `embedding` is
 *          pgvector's `vector` type; its dimensions are NOT part of the
 *          declaration because they come from the configured embedding model
 *          - `pinKnowledgeVectorSpace` types the column when the space is
 *          pinned. `@tangen/knowledge` itself declares and creates nothing.
 */
import { pgTable, text, integer, real, boolean, bigserial, jsonb, timestamp, primaryKey, index, customType } from 'drizzle-orm/pg-core'

/** pgvector's `vector` column type; dimensions are applied by the vector-space pin, not the declaration. */
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() { return 'vector' },
  toDriver(value: number[]) { return `[${value.join(',')}]` },
})

export const knowledgeMeta = pgTable('knowledge_meta', {
  workspaceId: text('workspace_id').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  dimensions: integer('dimensions').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId] }),
}))

export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  sourceGroup: text('source_group').notNull().default(''),
  field: text('field').notNull().default(''),
  locale: text('locale').notNull().default(''),
  audience: text('audience').notNull().default('public'),
  chunkIndex: integer('chunk_index').notNull().default(0),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  metadata: jsonb('metadata'),
  embedding: vector('embedding').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  scopeIdx: index('knowledge_chunks_scope_idx').on(t.workspaceId, t.sourceKind, t.sourceId),
}))

export const knowledgeQa = pgTable('knowledge_qa', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  audience: text('audience').notNull().default('public'),
  enabled: boolean('enabled').notNull().default(true),
  updatedBy: text('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  scopeIdx: index('knowledge_qa_scope_idx').on(t.workspaceId),
}))

export const knowledgeQueries = pgTable('knowledge_queries', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  query: text('query').notNull(),
  source: text('source').notNull(),
  audience: text('audience').notNull().default('public'),
  locale: text('locale').notNull().default(''),
  topScore: real('top_score'),
  hitCount: integer('hit_count').notNull().default(0),
  answered: boolean('answered').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  scopeIdx: index('knowledge_queries_scope_idx').on(t.workspaceId, t.createdAt),
}))
