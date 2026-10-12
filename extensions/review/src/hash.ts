/**
 * File Name: hash.ts
 * Purpose: Deterministic content hashing for the review gate. approvedHash is
 *          computed over the object's draft content (title + slug + field
 *          values) at APPROVE time and compared against the publish-time
 *          nextData - a mismatch means the content changed after approval.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: SERVER-ONLY (node:crypto) - never import from the
 *          browser barrel (src/index.ts). The two sides of the comparison
 *          come from different read paths (an approve-time ctx.tangen read
 *          vs the raw hook nextData), so values are canonicalized first:
 *          system/read-path columns dropped, Dates -> ISO strings, numeric
 *          strings and numbers unified, expanded media assets collapsed
 *          back to their ids, keys sorted, null/absent treated the same.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Keys that are not content: system columns (both camelCase rows and
 * snake_case raw rows) and read-path decorations. `i18n` is NOT here - see
 * canonicalizeI18n: translations ARE content and are hash-covered (L1).
 */
const EXCLUDED_KEYS = new Set([
  'id', 'type', 'status',
  'workspaceId', 'workspace_id',
  'publishedAt', 'published_at', 'publishedBy', 'published_by',
  'publishedValues', 'published_values',
  'scheduledAt', 'scheduled_at',
  'createdAt', 'created_at', 'createdBy', 'created_by',
  'updatedAt', 'updated_at', 'updatedBy', 'updated_by',
  'deletedAt', 'deleted_at',
  'hasDraftChanges',
])

/** The side-table map's own plumbing key - a locale marker, not a value. */
const I18N_KEY = 'i18n'

/** Numeric-looking strings ("42", "-1.5") - unified with real numbers so a
 *  pg-driver string and a coerced number hash identically. Leading zeros
 *  ("007") stay strings on purpose. */
const NUMERIC_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/

function isMediaAsset(v: Record<string, unknown>): boolean {
  return typeof v.id === 'string' &&
    ('url' in v || 'mimeType' in v || 'mime_type' in v || 'filename' in v)
}

/**
 * Canonical form of one value. Returns undefined for "absent" (null,
 * undefined, NaN) - object members with undefined canonical values are
 * dropped, array slots become null (position matters in arrays).
 */
export function canonicalizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return undefined
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : undefined
  if (typeof v === 'string') return NUMERIC_RE.test(v) ? String(Number(v)) : v
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.map((item) => canonicalizeValue(item) ?? null)
  if (typeof v === 'object') {
    const rec = v as Record<string, unknown>
    // Expanded media assets (approve-time reads expand them; raw rows hold ids)
    if (isMediaAsset(rec)) return rec.id
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(rec).sort()) {
      const cv = canonicalizeValue(rec[key])
      if (cv !== undefined) out[key] = cv
    }
    return out
  }
  return String(v)
}

/**
 * Canonical form of the `i18n` translations map (locale -> field values).
 *
 * The two sides of the gate reach it differently: the approve-time read asks
 * for every locale and ALWAYS attaches a map (empty when the object has no
 * translations), while the publish paths attach one only when side rows
 * exist. Empty locale entries and an empty map therefore collapse to
 * "absent", which is also what keeps base-only content hashing byte for byte
 * as it did before translations were covered - existing approvals in
 * workspaces without translations are never invalidated by this.
 */
function canonicalizeI18n(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, unknown> = {}
  for (const locale of Object.keys(value as Record<string, unknown>).sort()) {
    const entry = canonicalizeValue((value as Record<string, unknown>)[locale])
    // A side row whose localized columns are all NULL carries no content.
    if (entry && typeof entry === 'object' && Object.keys(entry).length > 0) out[locale] = entry
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Canonical content projection of a row/nextData: non-system keys only. */
export function canonicalizeContent(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    if (EXCLUDED_KEYS.has(key)) continue
    const cv = key === I18N_KEY ? canonicalizeI18n(record[key]) : canonicalizeValue(record[key])
    if (cv !== undefined) out[key] = cv
  }
  return out
}

/**
 * The stable content hash both sides of the gate compute:
 * sha256 over the key-sorted JSON of the canonical content projection.
 */
export function contentHash(record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeContent(record)))
    .digest('hex')
}

/** The host's per-extension MAC, as `ctx.sign`. */
export type ApprovalSigner = (payload: string) => string

/**
 * The format marker on a signed approval.
 *
 * A MAC and a bare sha256 are both 64 hex characters, so without this an
 * approval recorded before signing would be indistinguishable from a forged
 * one, and the gate could only say "content changed" about both. With it the
 * stored value says which scheme wrote it, and an approval that predates
 * signing gets its own, accurate message (isLegacyApproval).
 */
const MAC_PREFIX = 'v1:'

/**
 * What `approvedHash` stores: the content hash, MAC'd by the host.
 *
 * The bare hash was forgeable. A review record lives in `extension_data`,
 * which the Admin's panel-data route can write with ordinary content-write
 * permission, and the hashing algorithm is public - so an editor could
 * compute a passing value for their own content offline and satisfy the
 * publish gate. The MAC is keyed by a deployment secret the member cannot
 * read, so writing the row no longer means being able to fill it.
 *
 * Null when the host cannot sign. Callers must treat that as "cannot verify"
 * and refuse; falling back to the bare hash would restore the hole.
 */
export function approvalMac(sign: ApprovalSigner | undefined, record: Record<string, unknown>): string | null {
  return sign ? MAC_PREFIX + sign(contentHash(record)) : null
}

/**
 * Whether a stored `approvedHash` still vouches for this content.
 *
 * Fail-closed in every direction that is not a match: no stored value, a host
 * that cannot sign, a value in the pre-signing format, or content that moved.
 * The caller distinguishes WHY only to word the message (isLegacyApproval);
 * the verdict is the same, and so is the remedy.
 */
export function approvalMatches(
  sign: ApprovalSigner | undefined,
  approvedHash: string | undefined,
  record: Record<string, unknown>,
): boolean {
  if (!approvedHash) return false
  const expected = approvalMac(sign, record)
  if (expected === null || expected.length !== approvedHash.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(approvedHash))
}

/**
 * An approval recorded before approvals were signed: unverifiable rather than
 * wrong. The gate refuses it - the safe direction - and says so in those
 * words, because telling an editor their content changed when it did not
 * sends them looking for an edit that is not there.
 */
export function isLegacyApproval(approvedHash: string | undefined): boolean {
  return !!approvedHash && !approvedHash.startsWith(MAC_PREFIX)
}
