/**
 * File Name: bundle.ts
 * Purpose: The Porter bundle format (E-T1) - the portable shape of a Tangen
 *   export. A bundle is a storage prefix holding streaming JSONL SECTIONS
 *   (objects per type, media index, custom tables, ...) in immutable parts,
 *   plus raw media files, sealed by a manifest written LAST: the manifest's
 *   presence is the completeness marker, and it records the schema
 *   fingerprint the import side diffs before writing anything.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Only @tangen/types (StorageAdapter). Parts mirror the
 *   run-ledger design: storage backends have no append, so each flush is one
 *   immutable file - nothing is ever buffered beyond flushEvery entries.
 *   Layout under porter/bundles/<bundleId>/:
 *     manifest.json
 *     <section>-<part>.jsonl        e.g. objects/page-0.jsonl
 *     media/files/<assetId>/<file>  raw bytes
 */
import type { StorageAdapter } from '@tangen/types'

export const BUNDLE_FORMAT_VERSION = '1.0.0'

export interface BundleManifest {
  formatVersion: string
  workspaceId: string
  sourceEnvId: string | null
  createdAt: string
  createdBy: string | null
  /** Field-level schema fingerprint of the exported types (schema-diff shape). */
  schema: unknown[]
  /** section name -> number of JSONL parts. */
  sections: Record<string, number>
  /** section name -> number of entries. */
  counts: Record<string, number>
  [key: string]: unknown
}

export interface BundleSectionWriter {
  append(entry: Record<string, unknown>): void
  /** Writes buffered entries as one immutable part. */
  flush(): Promise<void>
  close(): Promise<void>
}

export interface BundleWriter {
  section(name: string): BundleSectionWriter
  writeMediaFile(assetId: string, filename: string, bytes: Uint8Array, contentType?: string): Promise<void>
  /** Writes the manifest LAST - sealing marks the bundle complete. */
  seal(manifest: Omit<BundleManifest, 'formatVersion' | 'sections' | 'counts'>): Promise<void>
}

const prefix = (bundleId: string) => `porter/bundles/${bundleId}`
const partKey = (bundleId: string, section: string, part: number) =>
  `${prefix(bundleId)}/${section}-${part}.jsonl`
const manifestKey = (bundleId: string) => `${prefix(bundleId)}/manifest.json`
const mediaFileKey = (bundleId: string, assetId: string, filename: string) =>
  `${prefix(bundleId)}/media/files/${assetId}/${filename}`

export function createBundleWriter(
  storage: StorageAdapter,
  bundleId: string,
  opts: { flushEvery?: number } = {},
): BundleWriter {
  const flushEvery = opts.flushEvery ?? 500
  const sections: Record<string, number> = {}
  const counts: Record<string, number> = {}
  let sealed = false

  function section(name: string): BundleSectionWriter {
    sections[name] ??= 0
    counts[name] ??= 0
    let buffer: Record<string, unknown>[] = []
    // Part numbers are assigned SYNCHRONOUSLY and writes are serialized on a
    // chain - an auto-flush racing a close() must never share a part index.
    let pending: Promise<void> = Promise.resolve()

    function flush(): Promise<void> {
      if (buffer.length > 0) {
        const entries = buffer
        buffer = []
        const part = sections[name]
        sections[name] += 1
        counts[name] += entries.length
        const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
        pending = pending.then(() =>
          storage.write(partKey(bundleId, name, part), new TextEncoder().encode(lines), {
            contentType: 'application/x-ndjson',
          }),
        )
      }
      return pending
    }

    return {
      append(entry) {
        buffer.push(entry)
        if (buffer.length >= flushEvery) void flush()
      },
      flush,
      close: flush,
    }
  }

  return {
    section,
    async writeMediaFile(assetId, filename, bytes, contentType) {
      await storage.write(mediaFileKey(bundleId, assetId, filename), bytes, { contentType })
    },
    async seal(manifest) {
      if (sealed) throw new Error(`bundle ${bundleId} is already sealed`)
      sealed = true
      // Omit over an index-signature type erases the known keys, so the
      // spread needs an assertion to reassemble the full manifest shape.
      const full = {
        ...manifest,
        formatVersion: BUNDLE_FORMAT_VERSION,
        sections: { ...sections },
        counts: { ...counts },
      } as BundleManifest
      await storage.write(manifestKey(bundleId), new TextEncoder().encode(JSON.stringify(full, null, 2)), {
        contentType: 'application/json',
      })
    },
  }
}

/**
 * Refuses bundles this build cannot understand: absent formatVersion, or a
 * MAJOR newer than ours. Older majors pass through to documented shims.
 */
export function assertSupportedFormat(manifest: Pick<BundleManifest, 'formatVersion'>): void {
  const version = manifest.formatVersion
  if (!version || typeof version !== 'string') {
    throw new Error('bundle manifest has no formatVersion - not a Tangen export')
  }
  const major = Number(version.split('.')[0])
  const ourMajor = Number(BUNDLE_FORMAT_VERSION.split('.')[0])
  if (!Number.isFinite(major) || major > ourMajor) {
    throw new Error(
      `bundle format ${version} is newer than this platform understands (${BUNDLE_FORMAT_VERSION}) - update the platform before importing`,
    )
  }
}

export interface BundleReader {
  manifest: BundleManifest
  readSection(name: string): AsyncGenerator<Record<string, unknown>>
  readMediaFile(assetId: string, filename: string): Promise<Uint8Array | null>
}

/** Opens a SEALED bundle; an absent manifest means incomplete -> refuse. */
export async function openBundleReader(storage: StorageAdapter, bundleId: string): Promise<BundleReader> {
  const raw = await storage.read(manifestKey(bundleId))
  if (!raw) {
    throw new Error(`bundle ${bundleId} has no manifest - it is incomplete or was never sealed`)
  }
  const manifest = JSON.parse(new TextDecoder().decode(raw)) as BundleManifest

  return {
    manifest,
    async *readSection(name) {
      const parts = manifest.sections[name] ?? 0
      const decoder = new TextDecoder()
      for (let part = 0; part < parts; part++) {
        const bytes = await storage.read(partKey(bundleId, name, part))
        if (!bytes) continue
        for (const line of decoder.decode(bytes).split('\n')) {
          if (line.trim()) yield JSON.parse(line)
        }
      }
    },
    readMediaFile(assetId, filename) {
      return storage.read(mediaFileKey(bundleId, assetId, filename))
    },
  }
}
