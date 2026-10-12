/**
 * File Name: s3.ts
 * Purpose: S3-protocol storage adapter via Bun's native S3 client — one
 *          adapter covers AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO,
 *          and GCS in S3-interop mode (selected purely by endpoint config).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Zero dependencies — Bun.S3Client is built in.
 *          Credentials fall back to the standard AWS env vars when omitted.
 *          The Bun client is injectable for tests (never opens sockets there).
 */
import type { StorageAdapter, StorageConfig, StorageStreamResult } from '@tangen/types'

/** The subset of Bun.S3Client this adapter uses — injectable for tests. */
export interface S3ClientLike {
  file(key: string): {
    exists(): Promise<boolean>
    arrayBuffer(): Promise<ArrayBuffer>
    stream(): ReadableStream
    stat(): Promise<{ size: number; type?: string }>
  }
  write(key: string, data: Uint8Array, opts?: { type?: string }): Promise<number | void>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  presign(key: string, opts?: { expiresIn?: number; method?: string }): string
  list(opts?: { prefix?: string; maxKeys?: number; startAfter?: string }): Promise<{
    contents?: Array<{ key: string }>
    isTruncated?: boolean
  }>
}

/**
 * Validates config and builds the native Bun client. Exported so the Studio
 * delivery store can share one factory (and one config shape) with media.
 */
export function createS3Client(config: StorageConfig): S3ClientLike {
  if (!config.bucket) {
    throw new Error(
      "storage(s3): 'bucket' is required - set it in app/config/storage.ts " +
      '(plus endpoint for R2/Spaces/MinIO/GCS-interop; omit endpoint for AWS S3)',
    )
  }
  return new Bun.S3Client({
    bucket: config.bucket,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.region ? { region: config.region } : {}),
    // Fall back to standard AWS env vars when not configured explicitly
    // Credentials arrive resolved (storage.accessKeyId / secretAccessKey through the accessor); never read here.
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  }) as unknown as S3ClientLike
}

/**
 * Creates the S3-compatible adapter. Keys map to
 * `${keyPrefix ?? 'media/'}${storagePath}` inside the bucket.
 */
export function createS3Storage(
  config: StorageConfig,
  client: S3ClientLike = createS3Client(config),
): StorageAdapter {
  const rawPrefix = config.keyPrefix ?? 'media/'
  const prefix = rawPrefix === '' ? '' : rawPrefix.replace(/\/*$/, '/')
  const keyFor = (key: string) => `${prefix}${key.replace(/^\/+/, '')}`

  const publicBase = config.publicBaseUrl?.replace(/\/+$/, '')
  const signed = config.signedUrls
  const signedExpiry =
    typeof signed === 'object' ? (signed.expirySeconds ?? 3600) : 3600

  return {
    name: 's3',

    async write(key, data, opts) {
      await client.write(keyFor(key), data, opts?.contentType ? { type: opts.contentType } : undefined)
    },

    async read(key) {
      const file = client.file(keyFor(key))
      if (!(await file.exists())) return null
      return new Uint8Array(await file.arrayBuffer())
    },

    async stream(key): Promise<StorageStreamResult | null> {
      const file = client.file(keyFor(key))
      if (!(await file.exists())) return null
      const stat = await file.stat().catch(() => null)
      return {
        body: file.stream(),
        size: stat?.size,
        contentType: stat?.type,
      }
    },

    async exists(key) {
      return client.exists(keyFor(key))
    },

    async delete(key) {
      await client.delete(keyFor(key))
    },

    async deletePrefix(rawPrefixKey) {
      const listPrefix = keyFor(rawPrefixKey)
      let startAfter: string | undefined
      // Page through list results until exhausted — buckets can hold more
      // than one page of variants/transforms per prefix.
      for (;;) {
        const page = await client.list({ prefix: listPrefix, maxKeys: 1000, startAfter })
        const keys = (page.contents ?? []).map((o) => o.key)
        if (keys.length === 0) break
        await Promise.all(keys.map((k) => client.delete(k)))
        if (!page.isTruncated) break
        startAfter = keys[keys.length - 1]
      }
    },

    publicUrl(key) {
      if (publicBase) return `${publicBase}/${keyFor(key)}`
      if (signed) return client.presign(keyFor(key), { expiresIn: signedExpiry, method: 'GET' })
      return null
    },
  }
}
