/**
 * File Name: porter-remote.ts
 * Purpose: Arc R transfer engine (R-T3). The wire format IS the sealed
 *   bundle: the sender packages its bundle as tar.gz and streams it in
 *   sha256-confirmed chunks; the receiver persists every confirmed chunk
 *   durably (crash/redeploy-safe), assembles + unpacks into its porter
 *   storage, and runs the NORMAL import (S4 identity cascade, statuses,
 *   providers, revisions). Resume = ask which chunks are confirmed and
 *   send the rest.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: chunk ledger lives on the receiver run's scope
 *   (jsonb) - durable run data, not process memory (S20a). Chunk bytes
 *   land under porter/transfers/<runId>/ until finish, then are removed.
 */
import { eq, and } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { migrationRuns } from '@tangen/db'
import type { StorageAdapter } from '@tangen/types'
import type { BundleManifest } from '@tangen/porter'
import { importBundleFromTarGz, openBundleReader } from '@tangen/porter'
import { createRun, getRun, type MigrationRun } from './migration-runs'
import { validateBundleAgainstEnv } from './porter-import'
import { resolvePorterLimits, checkLimits, type PorterLimits } from './porter-limits'

export const TRANSFER_CHUNK_BYTES = 4 * 1024 * 1024   // 4 MB - t2.small friendly

export interface TransferMediaUrl {
  assetId: string
  filename: string
  url: string
  sha256?: string
}

export interface TransferScope {
  bundleId: string
  remote: true
  options?: Record<string, unknown>
  /** R-T5 fast path: media bytes travel by these URLs, not in the stream. */
  mediaUrls?: TransferMediaUrl[]
  transfer: {
    totalBytes: number
    totalChunks: number
    archiveSha256: string
    /** Confirmed chunk indexes - THE durable resume ledger. */
    confirmed: number[]
    senderLabel?: string
  }
}

function sha256hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function chunkKey(runId: string, index: number): string {
  return `porter/transfers/${runId}/chunk-${index}`
}

/**
 * Receiver-side preflight (R-T2): the schema gate + the instance's OWN
 * limits, evaluated from the manifest before any byte moves.
 */
export async function remotePreflight(
  db: any,
  manifest: BundleManifest,
  totals: { totalBytes: number },
  limits: PorterLimits = resolvePorterLimits(),
  providerFor?: (key: string) => unknown,
): Promise<{ ok: boolean; blockers: unknown[]; violations: string[] }> {
  const validation = await validateBundleAgainstEnv(db, manifest)
  const totalItems = Object.entries(manifest.counts ?? {})
    .filter(([k]) => k.startsWith('objects/'))
    .reduce((n, [, c]) => n + (c as number), 0)
  const mediaCount = (manifest.counts ?? {})['media/index'] ?? 0
  const violations = checkLimits(
    { items: totalItems, mediaCount, mediaBytes: totals.totalBytes, largestAssetBytes: 0 },
    limits,
  )
  // Provider sections must be APPLICABLE here - an extension this instance
  // does not run, or a custom table it never defined, refuses up front
  // instead of arriving as a silently dropped (or failed) section.
  if (providerFor) {
    for (const sectionName of Object.keys(manifest.sections ?? {})) {
      if (!sectionName.startsWith('providers/')) continue
      const key = sectionName.slice('providers/'.length)
      if (!providerFor(key)) {
        violations.push(`this instance has no provider for ${key} - install the extension or define the table (with porter.matchBy) before transferring`)
      }
    }
  }
  return { ok: validation.ok && violations.length === 0, blockers: validation.blockers, violations }
}

/**
 * Sender side of the S3 fast path (R-T5): a fetchable URL for EVERY media
 * file of the bundle (presigned or public - storage.publicUrl decides), or
 * null when the storage cannot mint URLs (local disk) - then the bytes ride
 * the chunked stream as always. All-or-nothing: a partially capable bundle
 * falls back entirely rather than shipping half a fast path.
 */
export async function buildMediaUrlMap(
  storage: StorageAdapter,
  bundleId: string,
): Promise<TransferMediaUrl[] | null> {
  if (!storage.publicUrl(`porter/bundles/${bundleId}/manifest.json`)) return null
  const reader = await openBundleReader(storage, bundleId)
  const out: TransferMediaUrl[] = []
  for await (const entry of reader.readSection('media/index')) {
    const asset = (entry as any).asset as { id?: string } | undefined
    const filename = ((entry as any).filename as string | undefined) || 'original'
    if (!asset?.id) continue
    const url = storage.publicUrl(`porter/bundles/${bundleId}/media/files/${asset.id}/${filename}`)
    if (!url) return null
    out.push({ assetId: asset.id, filename, url, sha256: (entry as any).sha256 as string | undefined })
  }
  return out
}

/**
 * Receiver side: the commitBundleImport mediaFetch built from the stored
 * URL map - pulls straight from the sender's object storage, verifies the
 * sha256 the sender declared, never trusts bytes blind.
 */
export function makeRemoteMediaFetch(urls: TransferMediaUrl[]) {
  const byKey = new Map(urls.map((u) => [`${u.assetId}/${u.filename}`, u]))
  return async (assetId: string, filename: string): Promise<Uint8Array | null> => {
    const hit = byKey.get(`${assetId}/${filename}`)
    if (!hit) return null
    const res = await fetch(hit.url)
    if (!res.ok) throw new Error(`media pull failed (HTTP ${res.status}) for ${assetId}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (hit.sha256 && sha256hex(bytes) !== hit.sha256.toLowerCase()) {
      throw new Error(`media ${assetId} failed its sha256 check after pull - refusing the bytes`)
    }
    return bytes
  }
}

/** Creates the receiver's pending run - the durable anchor of the transfer. */
export async function createRemoteImportRun(
  db: any,
  input: {
    workspaceId: string
    bundleId: string
    totalBytes: number
    totalChunks: number
    archiveSha256: string
    options?: Record<string, unknown>
    senderLabel?: string
    mediaUrls?: TransferMediaUrl[]
  },
): Promise<MigrationRun> {
  const scope: TransferScope = {
    bundleId: input.bundleId,
    remote: true,
    ...(input.options ? { options: input.options } : {}),
    ...(input.mediaUrls && input.mediaUrls.length > 0 ? { mediaUrls: input.mediaUrls } : {}),
    transfer: {
      totalBytes: input.totalBytes,
      totalChunks: input.totalChunks,
      archiveSha256: input.archiveSha256,
      confirmed: [],
      ...(input.senderLabel ? { senderLabel: input.senderLabel } : {}),
    },
  }
  return await createRun(db, {
    workspaceId: input.workspaceId,
    kind: 'remote_receive',
    scope: scope as unknown as Record<string, unknown>,
    totalItems: input.totalChunks,
    createdBy: 'remote-transfer',
  })
}

export function confirmedChunks(run: MigrationRun): number[] {
  const scope = run.scope as unknown as TransferScope
  return [...(scope.transfer?.confirmed ?? [])].sort((a, b) => a - b)
}

/**
 * Verifies + persists one chunk and confirms it in the durable ledger.
 * Idempotent: a re-sent confirmed chunk verifies and returns quietly.
 */
export async function recordChunk(
  db: any,
  storage: StorageAdapter,
  run: MigrationRun,
  index: number,
  bytes: Uint8Array,
  declaredSha256: string,
): Promise<{ confirmed: number[] }> {
  const scope = run.scope as unknown as TransferScope
  if (!scope.transfer) throw new Error('run has no transfer scope')
  if (!Number.isInteger(index) || index < 0 || index >= scope.transfer.totalChunks) {
    throw new Error(`chunk index ${index} out of range (0..${scope.transfer.totalChunks - 1})`)
  }
  if (sha256hex(bytes) !== declaredSha256.toLowerCase()) {
    throw new Error(`chunk ${index} failed its sha256 check - resend it`)
  }
  await storage.write(chunkKey(run.id, index), bytes)

  // Durable confirm - read-modify-write on the run row (single writer: the
  // sender uploads sequentially; a re-send after crash is idempotent).
  const fresh = await getRun(db, run.workspaceId, run.id)
  const freshScope = (fresh!.scope as unknown as TransferScope)
  const set = new Set(freshScope.transfer.confirmed)
  set.add(index)
  freshScope.transfer.confirmed = [...set].sort((a, b) => a - b)
  await db.update(migrationRuns)
    .set({ scope: freshScope, processedItems: freshScope.transfer.confirmed.length, heartbeatAt: new Date() })
    .where(and(eq(migrationRuns.id, run.id), eq(migrationRuns.workspaceId, run.workspaceId)))
  return { confirmed: freshScope.transfer.confirmed }
}

/**
 * Assembles the confirmed chunks, verifies the whole archive's sha256,
 * unpacks it into porter storage as a normal bundle, and cleans up the
 * chunk files. The caller then enqueues the run for the import executor.
 */
export async function finishTransfer(
  db: any,
  storage: StorageAdapter,
  run: MigrationRun,
): Promise<{ bundleId: string }> {
  const scope = run.scope as unknown as TransferScope
  const t = scope.transfer
  if (!t) throw new Error('run has no transfer scope')

  const fresh = await getRun(db, run.workspaceId, run.id)
  const confirmed = new Set((fresh!.scope as unknown as TransferScope).transfer.confirmed)
  const missing: number[] = []
  for (let i = 0; i < t.totalChunks; i++) if (!confirmed.has(i)) missing.push(i)
  if (missing.length > 0) {
    throw new Error(`transfer incomplete - missing chunks: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`)
  }

  const parts: Uint8Array[] = []
  let total = 0
  for (let i = 0; i < t.totalChunks; i++) {
    const bytes = await storage.read(chunkKey(run.id, i))
    if (!bytes) throw new Error(`confirmed chunk ${i} is missing from storage - resend it`)
    parts.push(bytes)
    total += bytes.byteLength
  }
  const archive = new Uint8Array(total)
  let offset = 0
  for (const p of parts) { archive.set(p, offset); offset += p.byteLength }

  if (sha256hex(archive) !== t.archiveSha256.toLowerCase()) {
    throw new Error('assembled archive failed its sha256 check - restart the transfer')
  }

  await importBundleFromTarGz(storage, scope.bundleId, archive)

  await storage.deletePrefix(`porter/transfers/${run.id}/`).catch(() => {})
  return { bundleId: scope.bundleId }
}
