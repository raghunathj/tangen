/**
 * File Name: media-read.ts
 * Purpose: The media read seam an extension gets as `ctx.media.read(id)`
 *          (SEO Manager S3, tasks/plan-seo-next.md): one asset row and the
 *          bytes behind it, through the workspace's storage adapter. Scoped to
 *          the extension's own workspace by the query, never by the caller.
 *          Pure over its deps so a test drives it without a database.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionMediaAsset, StorageAdapter } from '@tangen/types'

export interface MediaReadDeps {
  workspaceId: string
  /** Raw SQL, as the boot's `extExec`. */
  exec: (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>
  storage: Pick<StorageAdapter, 'read'>
}

const SELECT = `SELECT id, filename, mime_type, size_bytes, width, height, alt_text, storage_path FROM media_assets WHERE id = $1 AND workspace_id = $2 LIMIT 1`

/** The asset with its bytes; null when the id is not this workspace's or the file is gone from storage. */
export async function readMediaAsset(deps: MediaReadDeps, mediaId: string): Promise<ExtensionMediaAsset | null> {
  const id = String(mediaId ?? '').trim()
  if (!id) return null
  const rows = await deps.exec(SELECT, [id, deps.workspaceId]).catch(() => [] as Array<Record<string, unknown>>)
  const row = rows[0]
  if (!row) return null
  const bytes = await deps.storage.read(String(row.storage_path ?? '')).catch(() => null)
  if (!bytes) return null
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
  return {
    id: String(row.id), filename: String(row.filename ?? ''), mimeType: String(row.mime_type ?? 'application/octet-stream'),
    sizeBytes: Number(row.size_bytes ?? bytes.byteLength), width: num(row.width), height: num(row.height),
    altText: typeof row.alt_text === 'string' ? row.alt_text : null, bytes,
  }
}
