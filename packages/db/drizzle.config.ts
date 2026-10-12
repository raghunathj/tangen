/**
 * File Name: drizzle.config.ts
 * Purpose: Drizzle Kit configuration for managing system (non-content) database tables.
 *          Scopes Drizzle migrations exclusively to fixed system tables so that
 *          content tables managed by `tangen push` are never accidentally altered.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: DATABASE_URL environment variable must be set at migration time.
 *                     The tablesFilter allowlist is the critical guard — keep it in sync
 *                     with any new system tables added to src/schema/index.ts.
 */
import { defineConfig } from "drizzle-kit";

// Only manage the fixed system tables. Content tables (e.g. "post", "author") are
// created and owned by `tangen push` — Drizzle must never touch them.
const SYSTEM_TABLES = [
  "workspaces",
  "environments",
  "members",
  "api_keys",
  "refresh_tokens",
  "object_types",
  "fields",
  "_revisions",
  "audit_log",
  "media_assets",
  "media_folders",
  "webhooks",
  "webhook_deliveries",
  "saved_views",
  "member_env_roles",
  "workspace_domains",
  "releases",
  "release_items",
  "form_submissions",
  "forms",
  "workspace_installed_apps",
  "extension_data",
  "ai_settings",
  "ai_chats",
  "search_query_log",
  "search_synonyms",
  "search_recommendations",
  "workspace_activity",
  "promotion_log",
  "knowledge_meta",
  "knowledge_chunks",
  "knowledge_qa",
  "knowledge_queries",
];

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  tablesFilter: SYSTEM_TABLES,
});
