/**
 * File Name: search-log.ts
 * Purpose: C1 — search query logging for analytics, done via a background task so
 *          it never delays a search response. searchLogJob decides whether to log
 *          (gated on analytics.enabled + a non-empty term) and builds the job;
 *          the `tangen-search-log-query` task inserts the row. No PII is stored —
 *          only the term, result count, audience, and timestamp.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { randomUUID } from 'node:crypto'
import { searchQueryLog } from '@tangen/db'
import { registerPlatformTask, type TaskJobData } from './task-queue'

export const SEARCH_LOG_TASK = 'tangen-search-log-query'

export interface SearchLogPayload {
  audience: 'internal' | 'public'
  term: string
  resultCount: number
}

/**
 * Build a log job, or null to skip (analytics disabled, or a blank term). The
 * term is trimmed. Callers enqueue the result fire-and-forget.
 */
export function searchLogJob(opts: {
  enabled: boolean
  workspaceId: string
  audience: 'internal' | 'public'
  term: string
  resultCount: number
}): TaskJobData | null {
  if (!opts.enabled) return null
  const term = opts.term.trim()
  if (!term) return null
  return {
    workspaceId: opts.workspaceId,
    taskId: SEARCH_LOG_TASK,
    payload: { audience: opts.audience, term, resultCount: opts.resultCount } satisfies SearchLogPayload,
  }
}

/** Insert one query-log row (worker-side). */
export async function runSearchLogJob(
  db: any,
  job: { workspaceId: string; payload: SearchLogPayload },
): Promise<void> {
  await db.insert(searchQueryLog).values({
    id: randomUUID(),
    workspaceId: job.workspaceId,
    audience: job.payload.audience,
    term: job.payload.term,
    resultCount: job.payload.resultCount,
  })
}

/** Registers the `tangen-search-log-query` platform task (closes over db). */
export function registerSearchLogTask(db: any): void {
  registerPlatformTask({
    id: SEARCH_LOG_TASK,
    description: 'Records a search query for analytics (no PII)',
    handler: async (jobCtx: any, payload: unknown) => {
      await runSearchLogJob(db, {
        workspaceId: jobCtx.workspaceId,
        payload: payload as SearchLogPayload,
      })
    },
  })
}
