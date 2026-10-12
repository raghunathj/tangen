/**
 * File Name: tar.ts
 * Purpose: Packages a sealed bundle as one downloadable .tar.gz - the
 *   portable file people move between machines and instances. Zero
 *   dependencies: hand-rolled ustar headers + node:zlib gzip. Storage
 *   adapters cannot enumerate keys, so the file list derives entirely from
 *   the manifest (sections x parts + media/index entries).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: ustar handles paths <= 100 chars directly; longer
 *   paths use the prefix field (<= 155 + 100), which covers every key shape
 *   Porter generates. Entries are regular files, mode 0644, deterministic
 *   given an mtime.
 */
import { gzipSync, gunzipSync } from 'node:zlib'
import type { StorageAdapter } from '@tangen/types'
import { openBundleReader } from './bundle'

const prefix = (bundleId: string) => `porter/bundles/${bundleId}`

/**
 * Every storage key of a sealed bundle, RELATIVE to the bundle root:
 * manifest.json, each section part, each media file from media/index.
 */
export async function bundleKeys(storage: StorageAdapter, bundleId: string): Promise<string[]> {
  const reader = await openBundleReader(storage, bundleId)
  const keys: string[] = ['manifest.json']
  for (const [section, parts] of Object.entries(reader.manifest.sections)) {
    for (let part = 0; part < parts; part++) keys.push(`${section}-${part}.jsonl`)
  }
  for await (const entry of reader.readSection('media/index')) {
    const asset = (entry as any).asset
    const filename = (entry as any).filename
    if (asset?.id && filename) keys.push(`media/files/${asset.id}/${filename}`)
  }
  return keys
}

function octal(value: number, length: number): Uint8Array {
  const s = value.toString(8).padStart(length - 1, '0') + '\0'
  return new TextEncoder().encode(s)
}

function tarHeader(name: string, size: number, mtime: number): Uint8Array {
  const header = new Uint8Array(512)
  const enc = new TextEncoder()

  // Long paths: split into ustar prefix (155) + name (100) on a '/'.
  let fileName = name
  let filePrefix = ''
  if (fileName.length > 100) {
    const cut = fileName.lastIndexOf('/', 155)
    if (cut <= 0) throw new Error(`tar: path too long and unsplittable: ${name}`)
    filePrefix = fileName.slice(0, cut)
    fileName = fileName.slice(cut + 1)
    if (fileName.length > 100 || filePrefix.length > 155) {
      throw new Error(`tar: path too long: ${name}`)
    }
  }

  header.set(enc.encode(fileName), 0)                 // name
  header.set(octal(0o644, 8), 100)                    // mode
  header.set(octal(0, 8), 108)                        // uid
  header.set(octal(0, 8), 116)                        // gid
  header.set(octal(size, 12), 124)                    // size
  header.set(octal(mtime, 12), 136)                   // mtime
  header.set(enc.encode('        '), 148)             // checksum placeholder (spaces)
  header[156] = 0x30                                  // typeflag '0' regular file
  header.set(enc.encode('ustar\0'), 257)              // magic
  header.set(enc.encode('00'), 263)                   // version
  header.set(enc.encode(filePrefix), 345)             // prefix

  let checksum = 0
  for (const byte of header) checksum += byte
  const cs = checksum.toString(8).padStart(6, '0') + '\0 '
  header.set(enc.encode(cs), 148)
  return header
}

/** One .tar.gz of the whole sealed bundle. `excludePrefix` leaves keys out
 *  (R-T5: media bytes skip the wire when they travel by presigned URL). */
export async function tarGzBundle(
  storage: StorageAdapter,
  bundleId: string,
  opts: { mtime?: number; excludePrefix?: string } = {},
): Promise<Uint8Array> {
  const mtime = opts.mtime ?? 0
  const keys = (await bundleKeys(storage, bundleId))
    .filter((k) => !opts.excludePrefix || !k.startsWith(opts.excludePrefix))
  const chunks: Uint8Array[] = []

  for (const key of keys) {
    const bytes = await storage.read(`${prefix(bundleId)}/${key}`)
    if (!bytes) throw new Error(`bundle ${bundleId} is missing "${key}" - refusing to package an incomplete archive`)
    chunks.push(tarHeader(key, bytes.byteLength, mtime))
    chunks.push(bytes)
    const pad = (512 - (bytes.byteLength % 512)) % 512
    if (pad > 0) chunks.push(new Uint8Array(pad))
  }
  chunks.push(new Uint8Array(1024))   // end-of-archive: two zero blocks

  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const tar = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { tar.set(c, offset); offset += c.byteLength }

  return new Uint8Array(gzipSync(tar))
}

// ── reading (I-T5: uploads) ──────────────────────────────────────────────────

export interface TarEntry { path: string; bytes: Uint8Array }

/** Extracts regular files from a .tar.gz (ustar incl. prefix field). */
export function untarGz(archive: Uint8Array): TarEntry[] {
  const tar = new Uint8Array(gunzipSync(archive))
  const dec = new TextDecoder()
  const entries: TarEntry[] = []
  let offset = 0
  while (offset + 512 <= tar.byteLength) {
    const block = tar.subarray(offset, offset + 512)
    if (block.every((b) => b === 0)) break   // end-of-archive
    const name = dec.decode(block.subarray(0, 100)).replace(/\0.*$/, '')
    const prefixField = dec.decode(block.subarray(345, 500)).replace(/\0.*$/, '')
    const size = parseInt(dec.decode(block.subarray(124, 136)).replace(/\0.*$/, '').trim() || '0', 8)
    const typeflag = block[156]
    offset += 512
    const path = prefixField ? `${prefixField}/${name}` : name
    if (typeflag === 0x30 || typeflag === 0) {
      entries.push({ path, bytes: tar.slice(offset, offset + size) })
    }
    offset += Math.ceil(size / 512) * 512
  }
  return entries
}

/**
 * Writes an uploaded .tar.gz into storage as a bundle under `bundleId`.
 * Refuses archives without a manifest (they were never sealed) and entries
 * that escape the bundle prefix.
 */
export async function importBundleFromTarGz(
  storage: StorageAdapter,
  bundleId: string,
  archive: Uint8Array,
): Promise<string> {
  const entries = untarGz(archive)
  if (!entries.some((e) => e.path === 'manifest.json')) {
    throw new Error('archive has no manifest.json - not a sealed Tangen export')
  }
  for (const entry of entries) {
    if (entry.path.includes('..') || entry.path.startsWith('/')) {
      throw new Error(`archive entry escapes the bundle: ${entry.path}`)
    }
    await storage.write(`${prefix(bundleId)}/${entry.path}`, entry.bytes)
  }
  return bundleId
}
