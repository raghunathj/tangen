/**
 * File Name: dashboard.ts
 * Purpose: Formatting helpers used by dashboard stat widgets — byte sizes, relative timestamps,
 *          and generic stat values.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */

/**
 * Formats a byte count as a human-readable string with the appropriate unit (B, KB, MB, GB, TB).
 * @param bytes - Non-negative byte count
 * @returns A formatted string such as "1.4 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const val = bytes / Math.pow(1024, i)
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * Converts an ISO 8601 date string to a human-friendly relative time phrase (e.g. "3h ago").
 * @param iso - ISO date string to compare against the current time
 * @returns A short relative-time label
 */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Formats a numeric stat value, applying byte formatting when unit is "bytes" or locale-formatted
 * thousands separators otherwise.
 * @param value - Numeric value to format
 * @param unit - Optional unit hint; pass "bytes" to delegate to formatBytes
 * @returns A display-ready string
 */
export function formatStatValue(value: number, unit?: string): string {
  if (unit === 'bytes') return formatBytes(value)
  return value.toLocaleString('en-US')
}
