/**
 * File Name: sealed.ts
 * Purpose: Secrets at rest for connections (Extension Kernel K6.1/K6.3,
 *          tasks/plan-extension-kernel.md): an AES-256-GCM envelope under a
 *          key derived from the deployment's connections key material. The
 *          database holds `v1.<iv>.<tag>.<ciphertext>` and never plaintext;
 *          a different key or a tampered byte fails to open. Lives in
 *          @tangen/db so the API (which seals and opens) and the CLI (which
 *          rotates the key and diagnoses unreadable rows) share ONE
 *          envelope. Pure over node:crypto and a SQL executor.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: One key per deployment (`connections.encryptionKey`,
 *          `TANGEN_CONNECTIONS_KEY`, else derived from the member session
 *          secret). Rotation re-seals every row under the new key; a row
 *          neither key opens is reported, never dropped.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export type SealedKey = Buffer & { readonly __sealedKey: true }

type SqlExec = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>

/** A 32-byte key from any key material (a passphrase, a base64 blob): sha256, so a short or long secret both work. */
export function deriveConnectionsKey(material: string): SealedKey {
  if (!material || material.length < 8) throw new Error('The connections key material must be at least 8 characters')
  return createHash('sha256').update(`tangen.connections.v1:${material}`).digest() as SealedKey
}

/** `v1.<iv>.<tag>.<ciphertext>`, base64url; a fresh iv every call. */
export function sealSecret(key: SealedKey, value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${data.toString('base64url')}`
}

/** The value back, or a throw: wrong key, tampered envelope, unknown version. */
export function openSecret<T = unknown>(key: SealedKey, sealed: string): T {
  const [version, iv, tag, data] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Not a sealed secret this platform understands')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()])
  return JSON.parse(plain.toString('utf8')) as T
}

function opens(key: SealedKey, sealed: unknown): boolean {
  try { openSecret(key, String(sealed)); return true } catch { return false }
}

export interface UnreadableConnection { id: string; workspaceId: string; connectorId: string; label: string }

/** The connection rows, every workspace, that this key cannot open - what Doctor names as CONNECTION_UNREADABLE. */
export async function unreadableConnections(exec: SqlExec, key: SealedKey): Promise<UnreadableConnection[]> {
  const rows = await exec(`SELECT id, workspace_id, connector_id, label, secret FROM connections ORDER BY workspace_id, created_at`)
  return rows
    .filter((r) => !opens(key, r.secret))
    .map((r) => ({ id: String(r.id), workspaceId: String(r.workspace_id), connectorId: String(r.connector_id), label: String(r.label) }))
}

/**
 * Re-seals every row the old key opens under the new key, every workspace,
 * one row at a time (a row is either re-sealed or untouched, never half).
 * Rows neither key opens are returned by id and left as they are; a row the
 * NEW key already opens is skipped, so running twice is safe.
 */
export async function rotateConnectionsKey(exec: SqlExec, keys: { from: SealedKey; to: SealedKey }): Promise<{ resealed: number; unreadable: string[] }> {
  const rows = await exec(`SELECT id, secret FROM connections ORDER BY created_at`)
  let resealed = 0
  const unreadable: string[] = []
  for (const r of rows) {
    const sealed = String(r.secret)
    if (opens(keys.to, sealed)) continue
    let value: unknown
    try { value = openSecret(keys.from, sealed) } catch { unreadable.push(String(r.id)); continue }
    await exec(`UPDATE connections SET secret = $2, updated_at = now() WHERE id = $1`, [r.id, sealSecret(keys.to, value)])
    resealed++
  }
  return { resealed, unreadable }
}
