/**
 * File Name: search.ts
 * Purpose: Search platform config (Settings → Search). Query-log analytics is a
 *   CODE decision: a site can disable logging and set a retention window, but the
 *   platform hard-caps retention at 3 months. Synonyms + recommendations are
 *   managed in the admin UI, not here.
 *
 * Author: Raghunath J
 * License: MIT
 */

/**
 * Per-custom-table search opt-in (`CustomTableDefinition.search`). Off by default;
 * set to expose the table's rows as pickable results for recommendations/curation.
 */
export interface TableSearchConfig {
  /** Expose this table for the recommendations picker. */
  recommendable?: boolean
  /** Audiences it's pickable for. Default: ['internal']. */
  audience?: ('internal' | 'public')[]
  /** Column used as the display title (default: 'title' or 'name'). */
  titleColumn?: string
}

/** Workspace Search settings (`search:` in the workspace config). */
export interface SearchConfig {
  analytics?: {
    /** Log search queries for the Settings → Search dashboard. Default: true. */
    enabled?: boolean
    /**
     * Days to keep query logs. Default 30; the platform HARD-CAPS this at 90
     * (3 months) regardless of what's configured. No PII is stored.
     */
    retentionDays?: number
  }
}
