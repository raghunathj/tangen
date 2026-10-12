/**
 * File Name: rename.ts
 * Purpose: Normalising a block's custom name.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Clearing a name returns UNDEFINED rather than an empty
 *          string, so `blockLabel` falls back to the derived name - storing
 *          "" would pin the row to a blank label forever.
 */

/** Longest custom name a tree row can show without becoming unreadable. */
export const LABEL_MAX_CHARS = 60

export function normalizeLabel(raw: string): string | undefined {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (text === '') return undefined
  return text.length > LABEL_MAX_CHARS ? text.slice(0, LABEL_MAX_CHARS) : text
}
