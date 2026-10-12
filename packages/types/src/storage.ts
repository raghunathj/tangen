/**
 * File Name: storage.ts
 * Purpose: The media storage adapter contract — pluggable backends (local
 *          disk, S3-compatible object stores, custom adapters) configured
 *          per workspace and overridable per environment.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Keys are the provider-agnostic `storagePath` values
 *          already stored on media rows ({ws}/{env}/{assetId}/file.ext).
 *          Adapters never see request context — pure byte/key operations.
 */

/** A streamable body for media delivery routes. */
export interface StorageStreamResult {
  /** Response-ready body (local: Bun.file Blob; s3: readable stream/blob). */
  body: ReadableStream | Blob
  size?: number
  contentType?: string
}

/**
 * The pluggable storage backend. Built-ins: 'local' (disk) and 's3'
 * (any S3-compatible store — AWS S3, Cloudflare R2, DigitalOcean Spaces,
 * MinIO, GCS interop). Site developers may pass their own implementation
 * via StorageConfig.adapter.
 */
export interface StorageAdapter {
  readonly name: string
  write(key: string, data: Uint8Array, opts?: { contentType?: string }): Promise<void>
  /** Full object bytes, or null when the key doesn't exist. */
  read(key: string): Promise<Uint8Array | null>
  /** Streamable body for delivery, or null when the key doesn't exist. */
  stream(key: string): Promise<StorageStreamResult | null>
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  /** Removes every object under the prefix (asset directories). */
  deletePrefix(prefix: string): Promise<void>
  /**
   * Directly fetchable URL for the key (CDN / public bucket / presigned),
   * or null — the platform then proxies through its media routes.
   */
  publicUrl(key: string): string | null
}

/**
 * Storage configuration — `app/config/storage.ts`, registered as the
 * workspace config's `storage` key; the deployment's `STORAGE_*` variables override it
 * per environment (e.g. local in development, R2 in production).
 */
export interface StorageConfig {
  /** Built-in adapter name or a custom StorageAdapter instance. Default 'local'. */
  adapter?: 'local' | 's3' | StorageAdapter

  // ── local ──
  /** Base directory (default: the MEDIA_DIR deployment variable, else {project-root}/public/media). */
  mediaDir?: string

  // ── s3 (S3 / R2 / Spaces / MinIO / GCS-interop — pick by endpoint) ──
  bucket?: string
  /** e.g. https://<account>.r2.cloudflarestorage.com — omit for AWS S3. */
  endpoint?: string
  region?: string
  /**
   * The NAME of the deployment variable holding the access key (a reference,
   * e.g. 'R2_ACCESS_KEY_ID'); AWS_ACCESS_KEY_ID when omitted. Material never
   * enters a config file.
   */
  accessKeyId?: string
  /** The NAME of the variable holding the secret key; AWS_SECRET_ACCESS_KEY when omitted. */
  secretAccessKey?: string
  /** Key prefix inside the bucket. Default 'media/'. */
  keyPrefix?: string
  /** Public/CDN base — publicUrl(key) = `${publicBaseUrl}/${key}`. */
  publicBaseUrl?: string
  /** Private buckets: presigned GET URLs instead of proxying. */
  signedUrls?: boolean | { expirySeconds?: number }
}

/** Identity helper for StorageConfig — enables inference in app/config/storage.ts. */
export function defineStorageConfig(config: StorageConfig): StorageConfig {
  return config
}
