/**
 * File Name: shared.ts
 * Purpose: Pure helpers + record shapes shared by the Variants server entry,
 *          its admin UI, and the tests - variant naming/slugs, copyable field
 *          extraction, takeover window validation, store prefixes, task ids.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Zero-dependency and side-effect free by design; the
 *          server entry composes these over ctx.tangen / ctx.store.
 */

// ── Store prefixes / task ids / labels (persisted - never change casually) ──
export const LINEAGE_PREFIX = 'lineage:'
export const EXPERIMENT_PREFIX = 'experiment:'
export const TAKEOVER_PREFIX = 'takeover:'
export const APPLY_TASK = 'ext:variants:apply-takeover'
export const REVERT_TASK = 'ext:variants:revert-takeover'
export const LABEL_VARIANT_BASE = 'variant:base'
export const labelVariantOf = (baseObjectId: string): string => `variant:of:${baseObjectId}`

// ── Record shapes (extension store payloads) ────────────────────────────────

/** Lineage of one variant sibling, keyed `lineage:<variantId>`. */
export interface LineageRecord {
  variantId: string
  baseObjectId: string
  typeName: string
  createdBy?: string
  createdAt: string
}

/** One experiment, keyed `experiment:<experimentId>`. */
export interface ExperimentRecord {
  experimentId: string
  typeName: string
  baseObjectId: string
  variantObjectId: string
  /** Percentage of visitors (0-100) bucketed into the variant. */
  split: number
  status: 'running' | 'stopped'
  startedAt: string
  stoppedAt?: string
  createdBy?: string
}

/** One timed takeover, keyed `takeover:<takeoverId>`. */
export interface TakeoverRecord {
  takeoverId: string
  typeName: string
  /** The object being taken over (usually a base/homepage object). */
  objectId: string
  /** The variant whose values are applied during the window. */
  variantObjectId: string
  startAt: string
  endAt: string
  status: 'scheduled' | 'active' | 'done' | 'cancelled' | 'blocked'
  /** Draft snapshot of the target captured at scheduling time. */
  snapshot: { title?: string; values: Record<string, unknown> }
  /** Why an apply/revert was blocked (e.g. a review gate refused the publish). */
  reason?: string
  createdBy?: string
  createdAt: string
  appliedAt?: string
  revertedAt?: string
  cancelledAt?: string
}

// ── Variant naming ──────────────────────────────────────────────────────────

/** Letter for the nth variant (1 → 'B'): the base object is implicitly "A". */
export function variantLetter(n: number): string {
  return String.fromCharCode(65 + Math.max(1, Math.floor(n)))
}

/** Sibling title: `<base title> (Variant B)`. */
export function variantTitle(baseTitle: string, letter: string): string {
  return `${baseTitle} (Variant ${letter})`
}

/** Minimal slugifier for the no-base-slug fallback (mirrors platform slugs). */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Slug candidate for a variant sibling: `<base-slug>-variant-<letter>` with
 * an attempt counter appended from the second try (`-2`, `-3`, ...) so the
 * caller can probe for uniqueness.
 */
export function variantSlugCandidate(baseSlug: string, letter: string, attempt: number, fallbackTitle = 'variant'): string {
  const root = baseSlug && baseSlug.trim() ? baseSlug.trim() : slugify(fallbackTitle)
  const core = `${root}-variant-${letter.toLowerCase()}`
  return attempt <= 1 ? core : `${core}-${attempt}`
}

// ── Field copying ───────────────────────────────────────────────────────────

/**
 * System columns + response-added keys that must never be copied onto a
 * sibling (matches the generated table's systemCols plus read-path additions).
 */
const NON_FIELD_KEYS = new Set([
  'id', 'workspaceId', 'title', 'slug', 'status', 'type',
  'publishedAt', 'publishedBy', 'publishedValues', 'scheduledAt',
  'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
  'hasDraftChanges', 'i18n',
])

/** True for read-path expansions of media/relation ids ({ id, url, ... }). */
function isExpandedRef(v: unknown): v is { id: string } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    && typeof (v as { id?: unknown }).id === 'string'
    && ('url' in (v as object) || 'filename' in (v as object) || 'mimeType' in (v as object))
}

/**
 * Extracts the copyable FIELD values from a local-client read of an object:
 * drops system columns and collapses read-path media expansions back to ids
 * so the result round-trips through `create({ title, values })`/`update()`.
 */
export function copyableFieldValues(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (NON_FIELD_KEYS.has(key)) continue
    if (isExpandedRef(value)) { out[key] = value.id; continue }
    if (Array.isArray(value) && value.length > 0 && value.every(isExpandedRef)) {
      out[key] = value.map((v) => (v as { id: string }).id)
      continue
    }
    out[key] = value
  }
  return out
}

// ── Takeover window validation ──────────────────────────────────────────────

export interface TakeoverWindow {
  error?: string
  startDelaySeconds: number
  endDelaySeconds: number
}

/**
 * Validates a takeover window: both ISO datetimes parse, the start is in the
 * future, and the end is after the start. Returns queue delays in seconds.
 */
export function validateTakeoverWindow(startAt: string, endAt: string, now: Date = new Date()): TakeoverWindow {
  const start = new Date(startAt)
  const end = new Date(endAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: 'startAt and endAt must be valid ISO datetimes', startDelaySeconds: 0, endDelaySeconds: 0 }
  }
  if (start.getTime() <= now.getTime()) {
    return { error: 'startAt must be in the future', startDelaySeconds: 0, endDelaySeconds: 0 }
  }
  if (end.getTime() <= start.getTime()) {
    return { error: 'endAt must be after startAt', startDelaySeconds: 0, endDelaySeconds: 0 }
  }
  return {
    startDelaySeconds: Math.ceil((start.getTime() - now.getTime()) / 1000),
    endDelaySeconds: Math.ceil((end.getTime() - now.getTime()) / 1000),
  }
}
