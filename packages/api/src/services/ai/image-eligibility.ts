/**
 * File Name: image-eligibility.ts
 * Purpose: The ONE image-eligibility predicate for media fields — a field can
 *          receive AI-generated images iff it is a media field whose mime
 *          restriction admits at least one image type and AI is not disabled
 *          on it. Shared by the image endpoint's gate (resolveImageField) and
 *          the object-brief schema's imagePrompt offers, so both surfaces can
 *          never drift apart.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: pure — no schema, no DB.
 */

/**
 * True when a media field's mime restriction admits at least one image type.
 * No restriction (or an empty list) means everything — images included.
 */
export function mediaFieldAcceptsImages(config: { mimeTypes?: string[] } | undefined): boolean {
  const mimes = config?.mimeTypes
  if (!Array.isArray(mimes) || mimes.length === 0) return true
  return mimes.some((m) => String(m).toLowerCase().startsWith('image/'))
}

/**
 * True when a field can be the target of AI image generation: a media field
 * that accepts images with AI not disabled. The image-type check is not
 * overridable — `ai.enabled: true` on a document field stays a no-op.
 */
export function isImageEligibleMediaField(
  field: { fieldType?: string; config?: Record<string, unknown> } | undefined,
): boolean {
  if (!field || field.fieldType !== 'media') return false
  const config = field.config as { mimeTypes?: string[]; ai?: { enabled?: boolean } } | undefined
  if (config?.ai?.enabled === false) return false
  return mediaFieldAcceptsImages(config)
}
