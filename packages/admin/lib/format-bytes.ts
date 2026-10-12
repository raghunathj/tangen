/**
 * File Name: format-bytes.ts
 * Purpose: A byte count as people read it: 0 B, 12 KB, 4.2 MB, 1.5 GB.
 *
 * Author: Raghunath J
 * License: MIT
 */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number | null | undefined): string {
  const n = typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  if (n === 0) return '0 B'
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / Math.pow(1024, i)
  return `${i === 0 ? Math.round(v) : v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${UNITS[i]}`
}
