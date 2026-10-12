/**
 * File Name: run-detail.ts
 * Purpose: What a run's last column says (the user, 2026-09-20: "whats the
 *          use of detail column?"). It held the error text and nothing else,
 *          so on a page where everything succeeded it was an empty column.
 *
 *          Every kind of run records something worth reading, in its own
 *          shape: a URL cron keeps the status it got back, the health sweep
 *          keeps what it checked, a retried task keeps which attempt this
 *          was. One function reads them, so the column is empty only when
 *          there is genuinely nothing to say.
 *
 * Author: Raghunath J
 * License: MIT
 */

export interface RunDetailInput {
  kind: string
  status: string
  error?: string | null
  attempt?: number | null
  meta?: Record<string, unknown> | null
}

export interface RunDetail {
  text: string
  /** True for a failure, which the column reads in the danger colour. */
  failed: boolean
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** What to show, or null when the run has nothing to add to its status. */
export function runDetail(run: RunDetailInput): RunDetail | null {
  // A failure explains itself first: the reason is the detail.
  if (run.error) return { text: run.error, failed: true }

  const meta = run.meta ?? {}

  // The connection health sweep: what it looked at.
  const checked = num(meta.checked)
  if (checked !== undefined) {
    const parts = [`${checked} checked`]
    const failed = num(meta.failed)
    const skipped = num(meta.skipped)
    if (failed) parts.push(`${failed} failed`)
    if (skipped) parts.push(`${skipped} skipped`)
    return { text: parts.join(', '), failed: false }
  }

  // A URL trigger: the status the far end answered with.
  const status = num(meta.status)
  if (status !== undefined) return { text: `HTTP ${status}`, failed: status >= 400 }

  // A cron that enqueues a task: which task it enqueued.
  if (meta.action === 'task' && typeof meta.taskId === 'string') {
    return { text: `queued ${meta.taskId}`, failed: false }
  }

  // A task that needed more than one go. The first attempt is not news.
  const attempt = num(run.attempt)
  if (attempt !== undefined && attempt > 1) return { text: `attempt ${attempt}`, failed: false }

  return null
}
