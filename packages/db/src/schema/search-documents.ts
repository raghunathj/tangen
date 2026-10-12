/**
 * File Name: search-documents.ts
 * Purpose: The content-search index, held in PostgreSQL rather than in the
 *   application process.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Identity is (workspace, environment, source, type,
 *   object, LOCALE). The locale is part of it because `cfg` - the text-search
 *   configuration - is per row: a French document must be stemmed and queried
 *   as French, and one row holding every translation could only be stemmed once.
 *
 *   `search_vector` is a GENERATED column (migration 0038) computed from `cfg`,
 *   so it is deliberately absent here: nothing writes it, and typing it would
 *   invite something to try. `cfg` is `regconfig` in the database and is only
 *   ever written through the engine's raw upsert, which casts explicitly.
 */
import { pgTable, text, boolean, jsonb, timestamp, primaryKey, index } from 'drizzle-orm/pg-core'

export const searchDocuments = pgTable('search_documents', {
  workspaceId: text('workspace_id').notNull(),
  /** 'content' | 'media' | 'ext:<extensionId>:<sourceId>' - and the unit of uninstall. */
  source: text('source').notNull(),
  typeSlug: text('type_slug').notNull(),
  objectId: text('object_id').notNull(),
  /** '' for content that is not localized. Part of the identity, never a filter afterthought. */
  locale: text('locale').notNull().default(''),
  /** PostgreSQL text-search configuration name; `simple` is the honest fallback. */
  cfg: text('cfg').notNull().default('simple'),
  title: text('title').notNull().default(''),
  slug: text('slug'),
  body: text('body').notNull().default(''),
  /** Bounded snippet source - ts_headline is linear in the text handed to it. */
  excerpt: text('excerpt').notNull().default(''),
  status: text('status').notNull().default('draft'),
  isPublished: boolean('is_published').notNull().default(false),
  metadata: jsonb('metadata').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId, t.source, t.typeSlug, t.objectId, t.locale] }),
  slugIdx: index('search_documents_slug').on(t.workspaceId, t.slug),
  scopeIdx: index('search_documents_scope').on(t.workspaceId, t.isPublished, t.typeSlug),
  objectIdx: index('search_documents_object').on(t.workspaceId, t.source, t.objectId),
}))

export type SearchDocumentRow = typeof searchDocuments.$inferSelect
