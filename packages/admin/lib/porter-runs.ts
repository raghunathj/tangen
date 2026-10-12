/**
 * File Name: porter-runs.ts
 * Purpose: Pure helpers for the Porter runs surface (M-T4) - progress math,
 *   activity detection for the polling loop, and the human counts line.
 */

export interface PorterRun {
  id: string
  kind: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  scope?: { typeName?: string }
  counts: Record<string, number>
  totalItems: number
  processedItems: number
  resultsParts: number
  error: string | null
  createdAt: string
  finishedAt: string | null
}

/** 0..100, safe for totalItems 0 (indeterminate -> 0 until finished). */
export function progressPercent(run: Pick<PorterRun, 'totalItems' | 'processedItems' | 'status'>): number {
  if (run.totalItems <= 0) return run.status === 'completed' ? 100 : 0
  return Math.min(100, Math.round((run.processedItems / run.totalItems) * 100))
}

/** Active runs drive the polling loop. */
export function isRunActive(run: Pick<PorterRun, 'status'>): boolean {
  return run.status === 'pending' || run.status === 'running'
}

const COUNT_ORDER = ['created', 'overwritten', 'unchanged', 'skipped', 'replaced', 'failed'] as const

/** "3 created · 1 overwritten · 2 failed" - zero counts omitted, stable order. */
export function runCountsLine(run: Pick<PorterRun, 'counts'>): string {
  const parts: string[] = []
  for (const key of COUNT_ORDER) {
    const n = run.counts?.[key] ?? 0
    if (n > 0) parts.push(`${n} ${key}`)
  }
  return parts.join(' · ')
}

/** Parses a JSONL results payload into entries (tolerates trailing newline). */
export function parseResultsJsonl(text: string): Record<string, unknown>[] {
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}
