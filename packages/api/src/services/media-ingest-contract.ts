/**
 * File Name: media-ingest-contract.ts
 * Purpose: The seam through which a non-media surface asks media to ingest a
 *          file. Core owns the contract; the media capability owns the
 *          implementation and registers it when it is enabled.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This file exists to fix a measured leak and to fix it in
 *          the right direction. `routes/ai/image.ts` imported
 *          `services/media-ingest` to store a generated image; that module
 *          reaches `services/image-processor`, which imports `sharp`. So a
 *          server with the media capability switched OFF still resolved the
 *          native image library, because AI reached it by another path. It is
 *          the reason gating media measured +1.2 MB instead of anything
 *          larger.
 *
 *          The alternative fixes were both worse. Duplicating the ingest logic
 *          inside AI would put two copies of storage, variant and record
 *          handling in the codebase, and they would drift. Making media a
 *          static dependency of AI would keep the leak and add a second one in
 *          the other direction.
 *
 *          Dependency direction: AI depends on this CONTRACT, never on the
 *          media implementation. Media registers itself. Nothing here imports
 *          media, and the types are structural for exactly that reason: a
 *          `import type { IngestOptions } from './media-ingest'` would be
 *          erased at runtime but is still a static edge, and the reachability
 *          gate would rightly call it a leak.
 *
 *          When media is off, `getMediaIngest()` returns null and the caller
 *          says so plainly. An AI image it cannot store is a refusal with a
 *          reason, not a crash and not a silently dropped file.
 */

/** What the caller has: request-scoped handles, no media types. */
export interface MediaIngestContext {
  db: unknown
  workspaceId: string
  workspaceProjects: unknown[] | undefined
}

/** A file to store. Structural on purpose: see the note above. */
export interface MediaIngestRequest {
  buffer: Buffer
  mimeType: string
  originalName: string
  folderId?: string | null
  altText?: string | null
  createdBy?: string | null
  /**
   * Processing options a field declares. Loosely typed at the seam on
   * purpose: naming `ImageVariant` here would mean importing a media type,
   * and a type-only import is still a static edge in the boot graph.
   */
  fieldVariants?: unknown[]
  skipPresets?: boolean
  imageOverrides?: { quality?: number; format?: unknown }
  /** Provenance for a generated asset: provider, model, prompt. */
  ai?: { provider: string; model: string; prompt: string }
  /** Extra metadata merged into the asset record. */
  extraMetadata?: Record<string, unknown>
}

/** What media hands back. The asset row, loosely typed at the seam. */
export type MediaIngestResult = Record<string, unknown>

/** The capability's side of the contract. */
export interface MediaIngestService {
  ingest(ctx: MediaIngestContext, req: MediaIngestRequest): Promise<MediaIngestResult>
  /** The id of a folder with this name, creating it when absent. */
  folderFor(db: unknown, workspaceId: string, name: string): Promise<string>
}

let service: MediaIngestService | null = null

/**
 * Registered by the media capability. Called from its `register()`, so a
 * process without media never resolves the implementation.
 */
export function registerMediaIngest(impl: MediaIngestService): void {
  service = impl
}

/** The implementation, or null when the media capability is not enabled. */
export function getMediaIngest(): MediaIngestService | null {
  return service
}

/** Test seam: forget the registration between suites. */
export function resetMediaIngest(): void {
  service = null
}
