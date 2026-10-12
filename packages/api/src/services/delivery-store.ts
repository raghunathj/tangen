/**
 * File Name: delivery-store.ts
 * Purpose: Where published Studio artifacts live - a platform table by
 *          default, object storage when configured - and the resolver that
 *          picks one per workspace and environment.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Artifacts used to live in `extension_data`, which was
 *          right as a zero-config first home and wrong as a permanent one.
 *          That is ONE shared KV table for every extension, and artifacts
 *          are the wrong shape for it: three rows per publish, immutable and
 *          never deleted because rollback depends on them, so the row count
 *          grows without bound beside flows, review and porter data.
 *
 *          So artifacts get a table of their own, `delivery_artifacts`,
 *          keyed by workspace, env and path. It is PLATFORM-owned: the
 *          delivery route reads it whether or not Studio is installed,
 *          which is the guarantee the route exists to keep. A bucket is the
 *          other backend, for a site that wants a CDN in front; it reuses
 *          the media S3 factory, so one config shape buys both.
 *
 *          Both sit behind the compiler's three-method Delivery Provider
 *          contract, and the rest of the platform never learns which one it
 *          got. `resolveDeliveryProvider` mirrors `resolveStorage`: config
 *          decides, the table is the default, and the result for a bucket
 *          is memoized because the client holds connection state.
 *
 *          Existing artifacts are NOT migrated in bulk. A read-miss in the
 *          new store is answered from the old rows and copied across - one
 *          artifact, one log line - and the old rows stay untouched this
 *          release, so a rollback of the release is a no-op.
 */
import type { WorkspaceProject, StorageConfig } from '@tangen/types'
import { getLogger } from '@tangen/logging'
import { kvDelivery, type DeliveryProvider, type KeyValueStore } from '@tangen/studio-compiler'
import { createExtensionStore } from './extension-server'
import { createS3Client, type S3ClientLike } from './storage/s3'
import { contentTypeFor } from '../routes/delivery/serve'

export { contentTypeFor }

const log = () => getLogger(['tangen', 'api', 'delivery'])

/** The raw driver call both backends and the legacy store speak. */
export type SqlExec = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>

/** Studio owns the legacy rows, but only as their author. */
const LEGACY_OWNER_EXTENSION = 'studio'

/** Where a bucket keeps artifacts unless the config says otherwise. */
const DEFAULT_KEY_PREFIX = 'delivery/'

/** The only prefix under which rows are mutable: a route pointer moves on every publish. */
const POINTER_PREFIX = 'tangen/routes/'

/** Storage backends the config may name. */
export type DeliveryStorageKind = 'table' | 's3'

/** Escapes a prefix for a LIKE pattern, so `_` in a route stays literal. */
function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, '\\$&')}%`
}

/**
 * A Delivery Provider over the `delivery_artifacts` table.
 *
 * Build rows are immutable by construction: a conflicting write is a
 * `DO NOTHING`, so the bytes first published under a content hash are the
 * bytes that stay - and if a caller ever tried to change them, the
 * compiler's read-back verify would see the old bytes and refuse to move
 * the pointer. Pointer rows are the one mutable thing and are upserted.
 */
export function tableDelivery(exec: SqlExec, workspaceId: string): DeliveryProvider {
  const scope = [workspaceId]
  return {
    async read(path) {
      const rows = await exec(
        `SELECT body FROM delivery_artifacts
          WHERE workspace_id = $1 AND path = $2 LIMIT 1`,
        [...scope, path],
      )
      const body = rows[0]?.body
      // Missing reads as null so an unpublished route is a 404, not a 500.
      return typeof body === 'string' ? body : null
    },

    async write(path, body) {
      const onConflict = path.startsWith(POINTER_PREFIX)
        ? 'DO UPDATE SET body = EXCLUDED.body, content_type = EXCLUDED.content_type, updated_at = now()'
        : 'DO NOTHING'
      await exec(
        `INSERT INTO delivery_artifacts (workspace_id, path, body, content_type, created_at, updated_at)
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (workspace_id, path) ${onConflict}`,
        [...scope, path, body, contentTypeFor(path)],
      )
    },

    async list(prefix) {
      const rows = await exec(
        `SELECT path FROM delivery_artifacts
          WHERE workspace_id = $1 AND path LIKE $2
          ORDER BY path`,
        [...scope, likePrefix(prefix)],
      )
      return rows.map((r) => String(r.path))
    },
  }
}

/** What the object provider needs to know about its place in a bucket. */
export interface ObjectDeliveryOptions {
  keyPrefix: string
  workspaceId: string
  /** Listing page size; the default is the S3 maximum. Small in tests so paging is exercised. */
  pageSize?: number
}

/**
 * A Delivery Provider over an S3-compatible bucket.
 *
 * Keys are `<prefix>/<workspace>/<env>/<delivery path>`, so one bucket can
 * hold every site and environment an install serves, and a CDN can be
 * pointed at the prefix. Built over the Bun client directly rather than the
 * media StorageAdapter because that adapter has no listing, and a provider
 * that cannot list cannot be audited.
 */
export function objectDelivery(client: S3ClientLike, opts: ObjectDeliveryOptions): DeliveryProvider {
  const prefix = opts.keyPrefix === '' ? '' : opts.keyPrefix.replace(/\/*$/, '/')
  const root = `${prefix}${opts.workspaceId}/`
  const keyFor = (path: string): string => {
    // A delivery path is author-derived and becomes a key under the env
    // root; anything that could climb out is refused rather than cleaned.
    if (path.includes('..') || path.startsWith('/')) {
      throw new Error(`Delivery path "${path}" would reach outside the delivery prefix`)
    }
    return `${root}${path}`
  }
  const pageSize = opts.pageSize ?? 1000

  return {
    async read(path) {
      const file = client.file(keyFor(path))
      if (!(await file.exists())) return null
      return new TextDecoder().decode(await file.arrayBuffer())
    },

    async write(path, body) {
      await client.write(keyFor(path), new TextEncoder().encode(body), { type: contentTypeFor(path) })
    },

    async list(listPrefix) {
      const under = keyFor(listPrefix)
      const out: string[] = []
      let startAfter: string | undefined
      // Page until exhausted: a site with years of publishes has more than
      // one page of builds.
      for (;;) {
        const page = await client.list({ prefix: under, maxKeys: pageSize, startAfter })
        const keys = (page.contents ?? []).map((o) => o.key)
        if (keys.length === 0) break
        out.push(...keys.map((k) => k.slice(root.length)))
        if (!page.isTruncated) break
        startAfter = keys[keys.length - 1]
      }
      return out
    },
  }
}

/**
 * The new store in front of the old rows.
 *
 * A read-miss is answered from the legacy provider and copied into the new
 * one, so the next visitor is served from the new store and the old rows
 * are never read for that path again. Writes go to the new store only. The
 * copy is best-effort: if it fails, the visitor still gets the artifact -
 * the migration is never the reason a page is down.
 */
export function withLegacyFallback(
  primary: DeliveryProvider,
  legacy: DeliveryProvider,
  onCopy: (path: string) => void,
): DeliveryProvider {
  return {
    async read(path) {
      const fresh = await primary.read(path)
      if (fresh !== null) return fresh
      const old = await legacy.read(path)
      if (old === null) return null
      try {
        await primary.write(path, old)
        onCopy(path)
      } catch (err) {
        log().warn(`delivery: could not copy legacy artifact ${path} into the delivery store: ${err instanceof Error ? err.message : String(err)}`)
      }
      return old
    },
    write: (path, body) => primary.write(path, body),
    async list(prefix) {
      const [fresh, old] = await Promise.all([primary.list(prefix), legacy.list(prefix)])
      return [...new Set([...fresh, ...old])]
    },
  }
}

/** The delivery block of the Studio config, read defensively. */
function deliveryConfig(project: WorkspaceProject | undefined): { storage?: unknown; s3?: Record<string, unknown> } {
  const studio = (project?.config as { studio?: { delivery?: unknown } } | undefined)?.studio
  const delivery = studio?.delivery
  return delivery && typeof delivery === 'object' ? delivery as { storage?: unknown; s3?: Record<string, unknown> } : {}
}

/** Which backend the config names for this workspace; the table unless it says `s3`. */
export function deliveryStorageKind(project: WorkspaceProject | undefined): DeliveryStorageKind {
  const kind = deliveryConfig(project).storage
  if (kind === undefined || kind === 'table') return 'table'
  if (kind === 's3') return 's3'
  throw new Error(`studio.delivery.storage: unknown backend "${String(kind)}" (built-ins: table, s3)`)
}

/**
 * The S3 config for artifacts: the inline `studio.delivery.s3` block over
 * the workspace's media storage config when that is already a bucket. The
 * media key prefix is never inherited - artifacts must not land in
 * `media/`, where a media listing would find them.
 */
function s3ConfigFor(project: WorkspaceProject | undefined): StorageConfig {
  const media = project?.storage
  const inherited = media?.adapter === 's3' ? media : {}
  const inline = deliveryConfig(project).s3 ?? {}
  const { keyPrefix: _mediaPrefix, mediaDir: _dir, adapter: _adapter, ...base } = inherited as StorageConfig
  const config: StorageConfig = { ...base, ...inline, adapter: 's3' }
  if (!config.bucket) {
    throw new Error(
      "studio.delivery.storage is 's3' but no bucket is configured - set studio.delivery.s3.bucket, "
      + 'or give the workspace an s3 media storage config to inherit',
    )
  }
  config.keyPrefix = typeof inline.keyPrefix === 'string' ? inline.keyPrefix : DEFAULT_KEY_PREFIX
  return config
}

// One client per (workspace, env): the S3 client holds connection state.
const _clients = new Map<string, S3ClientLike>()

/** Test helper - forgets memoized bucket clients. */
export function resetDeliveryCache(): void {
  _clients.clear()
}

/** What the resolver needs; `s3Client` is injectable so tests never open a socket. */
export interface ResolveDeliveryArgs {
  project: WorkspaceProject | undefined
  workspaceId: string
  exec: SqlExec
  s3Client?: (config: StorageConfig) => S3ClientLike
}

/**
 * The Delivery Provider for one workspace.
 *
 * The table by default, so a fresh install publishes with nothing
 * configured and a published page survives Studio being disabled; a bucket
 * when `studio.delivery.storage` is `s3`. Either way the legacy
 * `extension_data` rows sit behind it, so every page published before the
 * move keeps resolving and migrates itself on first read.
 */
export function resolveDeliveryProvider(args: ResolveDeliveryArgs): DeliveryProvider {
  const { project, workspaceId, exec } = args
  const kind = deliveryStorageKind(project)

  let primary: DeliveryProvider
  if (kind === 's3') {
    const config = s3ConfigFor(project)
    const cacheKey = workspaceId
    let client = _clients.get(cacheKey)
    if (!client) {
      client = (args.s3Client ?? createS3Client)(config)
      _clients.set(cacheKey, client)
    }
    primary = objectDelivery(client, { keyPrefix: config.keyPrefix ?? DEFAULT_KEY_PREFIX, workspaceId })
  } else {
    primary = tableDelivery(exec, workspaceId)
  }

  const legacy = kvDelivery(
    createExtensionStore(exec, LEGACY_OWNER_EXTENSION, workspaceId) as unknown as KeyValueStore,
  )
  return withLegacyFallback(primary, legacy, (path) => {
    log().info(`delivery: migrated ${path} for ${workspaceId} from extension_data into the ${kind} store`)
  })
}
