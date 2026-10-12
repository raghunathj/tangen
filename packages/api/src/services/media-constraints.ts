/**
 * File Name: media-constraints.ts
 * Purpose: Save-time enforcement of media field constraints (accept
 *          categories + mimeTypes) — API writers can't attach a video to an
 *          image field any more than the admin picker allows it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Async (asset MIME lookup) — runs alongside the sync
 *          validateFieldValues in the object create/update routes. Uses the
 *          shared matchesMediaConstraint from @tangen/types so admin and
 *          server agree forever.
 */
import { inArray } from 'drizzle-orm'
import { mediaAssets } from '@tangen/db'
import { matchesMediaConstraint, type FieldDefinition } from '@tangen/types'

/** Extracts the asset id from a media field value (id string or asset object). */
export function extractAssetId(value: unknown): string | null {
  if (typeof value === 'string' && value) return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' && id) return id
  }
  return null
}

/**
 * Validates every constrained media field in `values` against the referenced
 * assets' MIME types. Returns field → error message (empty when clean).
 * Unknown asset ids error too — a save must not reference missing media.
 */
export async function validateMediaConstraints(
  db: any,
  fields: FieldDefinition[],
  values: Record<string, unknown>,
): Promise<Record<string, string>> {
  const checks: Array<{ field: FieldDefinition; assetId: string }> = []
  for (const field of fields) {
    if (field.fieldType !== 'media') continue
    const accept = (field.config as { accept?: string[] }).accept
    const mimeTypes = (field.config as { mimeTypes?: string[] }).mimeTypes
    if (!(accept?.length || mimeTypes?.length)) continue
    const assetId = extractAssetId(values[field.name])
    if (assetId) checks.push({ field, assetId })
  }
  if (checks.length === 0) return {}

  const rows = await db
    .select({ id: mediaAssets.id, mimeType: mediaAssets.mimeType })
    .from(mediaAssets)
    .where(inArray(mediaAssets.id, [...new Set(checks.map((c) => c.assetId))]))
  const mimeById = new Map((rows as Array<{ id: string; mimeType: string }>).map((r) => [r.id, r.mimeType]))

  const errors: Record<string, string> = {}
  for (const { field, assetId } of checks) {
    const mime = mimeById.get(assetId)
    const accept = (field.config as { accept?: string[] }).accept
    const mimeTypes = (field.config as { mimeTypes?: string[] }).mimeTypes
    if (!mime) {
      errors[field.name] = `References a media asset that does not exist (${assetId})`
      continue
    }
    if (!matchesMediaConstraint(mime, accept as any, mimeTypes)) {
      const allowed = [
        ...(accept ?? []),
        ...(mimeTypes ?? []),
      ].join(', ')
      errors[field.name] = `File type ${mime} is not allowed here (allowed: ${allowed})`
    }
  }
  return errors
}
