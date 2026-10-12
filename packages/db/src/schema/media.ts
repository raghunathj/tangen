/**
 * File Name: media.ts
 * Purpose: Drizzle schema for the `media_folders` and `media_assets` tables, which
 *          together model a hierarchical media library for uploaded files and images.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: mediaFolders supports nesting via self-referential parentId.
 *                     mediaAssets references mediaFolders for folder placement.
 *                     storagePath is the provider-specific path (S3 key, local path, etc.).
 */
import { pgTable, text, timestamp, integer, bigint, jsonb, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Stores hierarchical folder nodes for organising media assets; parentId is nullable
 * to represent root-level folders.
 */
export const mediaFolders = pgTable('media_folders', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Stores uploaded media file records including MIME type, dimensions, alt text, tags,
 * storage path, and an optional thumbnail path for image previews.
 */
export const mediaAssets = pgTable('media_assets', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  folderId: text('folder_id').references(() => mediaFolders.id),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  width: integer('width'),
  height: integer('height'),
  altText: text('alt_text'),
  tags: text('tags').array().notNull().default(sql`'{}'`),
  metadata: jsonb('metadata').notNull().default(sql`'{}'`),
  storagePath: text('storage_path').notNull(),
  thumbnailPath: text('thumbnail_path'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
}, (t) => ({
  workspaceIdx: index('media_assets_workspace_idx').on(t.workspaceId),
  folderIdx: index('media_assets_folder_idx').on(t.folderId),
}))
