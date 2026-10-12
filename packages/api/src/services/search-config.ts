/**
 * File Name: search-config.ts
 * Purpose: Resolves the effective Search analytics settings from workspace config.
 *          Query logging is a CODE decision (a site developer can disable it and
 *          set a retention window), so this is the single place those knobs are
 *          read + bounded: retention is hard-capped at 3 months regardless of
 *          config, and logging defaults ON.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { SearchConfig } from '@tangen/types'

/** Retention is never longer than 3 months, whatever a site configures. */
export const MAX_RETENTION_DAYS = 90
const DEFAULT_RETENTION_DAYS = 30

interface ProjectLike {
  search?: SearchConfig
  config?: { search?: SearchConfig }
}

function searchConfigOf(project: ProjectLike | undefined): SearchConfig | undefined {
  return project?.config?.search ?? project?.search
}

export interface ResolvedSearchAnalytics {
  enabled: boolean
  /** Days to keep query logs — clamped to [1, MAX_RETENTION_DAYS]. */
  retentionDays: number
}

/**
 * @returns `{ enabled, retentionDays }` — logging on by default; retention
 * defaults to 30 days and is clamped to 1..90 (3-month hard cap).
 */
export function resolveSearchAnalytics(project: ProjectLike | undefined): ResolvedSearchAnalytics {
  const a = searchConfigOf(project)?.analytics
  const configured = a?.retentionDays ?? DEFAULT_RETENTION_DAYS
  const retentionDays = Math.min(MAX_RETENTION_DAYS, Math.max(1, Math.floor(configured)))
  return { enabled: a?.enabled !== false, retentionDays }
}
