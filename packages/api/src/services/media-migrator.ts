/**
 * File Name: media-migrator.ts
 * Purpose: The media references inside a content payload: collect every
 *          `med_` id a bundle carries, and rewrite them after an import
 *          assigned new ids. Porter's export, import and Studio provider use
 *          both.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { eq, and, sql } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { mediaAssets } from '@tangen/db'
import type { StorageAdapter } from '@tangen/types'
import type { I18nRow } from './i18n'

/** med_ + 16..64 hex chars - the shapes the platform has ever minted. */
const MEDIA_ID_RE = /med_[0-9a-f]{16,64}/g

/** Collects every med_ id referenced anywhere in a payload (strings only). */
export function collectMediaIds(payload: unknown): Set<string> {
  const found = new Set<string>()
  walk(payload, (s) => {
    for (const m of s.matchAll(MEDIA_ID_RE)) found.add(m[0])
    return s
  })
  return found
}

/** Rewrites med_ ids per the remap inside every string value (non-strings untouched). */
export function applyMediaRemap<T>(value: T, remap: Map<string, string>): T {
  if (remap.size === 0) return value
  return walk(value, (s) => s.replace(MEDIA_ID_RE, (id) => remap.get(id) ?? id)) as T
}

/** Structure-preserving string-visitor walk. Dates and other class instances pass through. */
function walk(value: unknown, visit: (s: string) => string): unknown {
  if (typeof value === 'string') return visit(value)
  if (Array.isArray(value)) return value.map((v) => walk(v, visit))
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v, visit)]),
    )
  }
  return value
}
