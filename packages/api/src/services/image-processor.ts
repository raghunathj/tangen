/**
 * File Name: image-processor.ts
 * Purpose: Processes uploaded images into resized/reformatted variants using sharp,
 *   including workspace presets, per-field overrides, and the system thumbnail.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: sharp for image transformation, @tangen/types
 *   (ImageVariant). sharp is loaded LAZILY and is an OPTIONAL dependency
 *   (closure plan Phase 7, Unit 5): it is a native module worth 19.1 MB, and
 *   a deployment that never processes an image should neither install nor
 *   load it. A deployment that does, and cannot, gets the sentence below
 *   rather than a module-resolution stack.
 */
import type { ImageVariant } from '@tangen/types'

/** The one sentence a caller sees when image processing is asked for without sharp. */
export const SHARP_MISSING =
  'image processing is unavailable: the optional "sharp" dependency is not installed. Run `bun add sharp` (or `npm i sharp`) in the project that runs @tangen/api, then restart.'

/** The callable sharp factory - `sharp(buffer)` - not the module namespace. */
type SharpFactory = (typeof import('sharp'))['default']
let sharpModule: SharpFactory | null = null

/**
 * The sharp module, loaded once on first use. Throws SHARP_MISSING when the
 * optional dependency is absent or will not load on this platform - never a
 * bare resolution error, and never a silent no-op that would write an
 * unprocessed image as if it had been processed.
 */
export async function loadSharp(): Promise<SharpFactory> {
  if (sharpModule) return sharpModule
  try {
    const mod = await import('sharp')
    sharpModule = (mod.default ?? (mod as unknown as SharpFactory))
  } catch (err) {
    throw new Error(`${SHARP_MISSING} (${(err as Error).message.split('\n')[0]?.slice(0, 120) ?? 'load failed'})`)
  }
  return sharpModule
}

/** Test seam: hand the loader a module (or null to make the next load re-resolve). */
export function __setSharpForTests(mod: unknown): void {
  sharpModule = mod as SharpFactory | null
}

// ─── System thumbnail ─────────────────────────────────────────────────────────

/**
 * Fixed spec for the auto-generated system thumbnail (_thumb) produced on every upload.
 * Always 400×400 WebP at quality 70, fitted inside without enlargement.
 */
export const SYSTEM_THUMBNAIL_SPEC: ImageVariant = {
  name: '_thumb',
  width: 400,
  height: 400,
  fit: 'inside',
  format: 'webp',
  quality: 70,
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Output shape returned by processVariant after sharp transforms an input buffer.
 */
export interface ProcessedVariant {
  outputBuffer: Buffer
  width: number
  height: number
  format: string
  sizeBytes: number
}

// ─── resolveVariants ─────────────────────────────────────────────────────────

/**
 * Returns the ordered list of user-defined variants to generate for an upload.
 * System thumbnail is NOT included here — it is always generated separately.
 *
 * Field variants with the same name as a workspace preset override the preset.
 * @param workspacePresets - Workspace-level variant definitions keyed by variant name.
 * @param fieldVariants - Per-field variants that override matching workspace presets.
 * @param skipPresets - When true, workspace presets are ignored entirely.
 * @returns Deduplicated, ordered list of variants to generate.
 */
export function resolveVariants(
  workspacePresets: Record<string, ImageVariant> | undefined,
  fieldVariants: ImageVariant[] | undefined,
  skipPresets: boolean,
): ImageVariant[] {
  const map = new Map<string, ImageVariant>()

  if (!skipPresets && workspacePresets) {
    for (const [, variant] of Object.entries(workspacePresets)) {
      map.set(variant.name, variant)
    }
  }

  for (const variant of fieldVariants ?? []) {
    map.set(variant.name, variant) // field variants override same-named presets
  }

  return [...map.values()]
}

// ─── applyImageOverrides ─────────────────────────────────────────────────────

/**
 * Applies a media field's schema-level quality/format override to every
 * resolved variant — geometry is untouched. `format: 'original'` opts the
 * field out of format conversion (see processVariant). Returns the input
 * list unchanged when there is nothing to apply.
 * @param variants - Variants resolved from workspace presets + field config.
 * @param overrides - The field's `imageOverrides` config, if any.
 */
export function applyImageOverrides(
  variants: ImageVariant[],
  overrides: { quality?: number; format?: ImageVariant['format'] } | undefined,
): ImageVariant[] {
  if (!overrides || (overrides.quality === undefined && overrides.format === undefined)) {
    return variants
  }
  return variants.map((v) => ({
    ...v,
    ...(overrides.format !== undefined ? { format: overrides.format } : {}),
    ...(overrides.quality !== undefined ? { quality: overrides.quality } : {}),
  }))
}

// ─── processVariant ───────────────────────────────────────────────────────────

/**
 * Resizes and re-encodes an image buffer according to an ImageVariant specification.
 * @param inputBuffer - Raw image bytes to transform.
 * @param variant - Target dimensions, format, and quality settings.
 * @returns Processed image bytes along with resulting dimensions and size.
 */
/** Formats sharp can re-encode; 'original' sources outside this fall back to webp. */
const ENCODABLE_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff'])

export async function processVariant(
  inputBuffer: Buffer,
  variant: ImageVariant,
): Promise<ProcessedVariant> {
  let format = variant.format ?? 'webp'
  if (format === 'original') {
    // resize without format conversion — keep whatever came in
    const meta = await (await loadSharp())(inputBuffer).metadata()
    format = (meta.format && ENCODABLE_FORMATS.has(meta.format) ? meta.format : 'webp') as any
  }
  const quality = variant.quality ?? 85

  const { data, info } = await (await loadSharp())(inputBuffer)
    .resize({
      width: variant.width,
      height: variant.height,
      fit: (variant.fit ?? 'inside') as any,
      position: (variant.position ?? 'center') as any,
      withoutEnlargement: true,
    })
    .toFormat(format as any, { quality })
    .toBuffer({ resolveWithObject: true })

  return {
    outputBuffer: data,
    width: info.width,
    height: info.height,
    format,
    sizeBytes: info.size,
  }
}

// ─── processSystemThumbnail ───────────────────────────────────────────────────

/**
 * Generates the system thumbnail for an upload using SYSTEM_THUMBNAIL_SPEC.
 * @param inputBuffer - Raw image bytes of the original upload.
 * @returns The processed 400×400 WebP thumbnail variant.
 */
export async function processSystemThumbnail(
  inputBuffer: Buffer,
): Promise<ProcessedVariant> {
  return processVariant(inputBuffer, SYSTEM_THUMBNAIL_SPEC)
}

// ─── extractDimensions ────────────────────────────────────────────────────────

/**
 * Reads the pixel dimensions of an image buffer without fully decoding it.
 * @param buffer - Raw image bytes to inspect.
 * @returns Width and height in pixels, or null if the dimensions cannot be determined.
 */
export async function extractDimensions(
  buffer: Buffer,
): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await (await loadSharp())(buffer).metadata()
    if (meta.width && meta.height) return { width: meta.width, height: meta.height }
    return null
  } catch {
    return null
  }
}
