/**
 * File Name: extension-lock.ts
 * Purpose: `tangen.lock` (Extension Kernel K5.3, tasks/plan-extension-kernel.md;
 *          proposal F.3): what this project installed and approved, committed
 *          so a new grant is a visible diff in a pull request. One entry per
 *          extension: the version, the integrity of the reviewed manifest
 *          (what you approved is what was reviewed; a changed manifest is a
 *          changed hash), and the granted grants (null when the extension
 *          declares none). Written after an install or an upgrade succeeds.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TangenExtensionManifest } from '@tangen/types'

export const LOCK_FILE = 'tangen.lock'

export interface LockEntry {
  version: string
  /** `sha256-<hex>` of the manifest's reviewable shape. */
  integrity: string
  /** The grants approved at the last install or upgrade; null when the extension declares none. */
  grantedGrants: string[] | null
}

export interface Lockfile {
  lockfileVersion: 1
  extensions: Record<string, LockEntry>
}

/** The parts of a manifest a review is about, in a stable order; loader metadata (`__dir`, `__pkg`) and functions never count. */
function reviewable(manifest: TangenExtensionManifest): unknown {
  const m = manifest as unknown as Record<string, unknown>
  const pick = ['id', 'version', 'grants', 'provides', 'requires', 'optional', 'capabilities', 'permissions', 'apiKeyScope', 'secrets', 'deploymentRoles']
  const out: Record<string, unknown> = {}
  for (const k of pick) if (m[k] !== undefined) out[k] = m[k]
  return out
}

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
  return v
}

/** A stable sha256 of the manifest's reviewable shape. */
export function manifestIntegrity(manifest: TangenExtensionManifest): string {
  return `sha256-${createHash('sha256').update(JSON.stringify(stable(reviewable(manifest)))).digest('hex')}`
}

export function readLock(projectRoot: string): Lockfile | null {
  const p = join(projectRoot, LOCK_FILE)
  if (!existsSync(p)) return null
  const parsed = JSON.parse(readFileSync(p, 'utf8')) as Lockfile
  if (parsed?.lockfileVersion !== 1 || typeof parsed.extensions !== 'object') throw new Error(`${LOCK_FILE} is not a lockfile this Tangen understands (lockfileVersion 1 expected)`)
  return parsed
}

/** Upsert one extension's entry; the file is created on first use and kept sorted so diffs stay small. */
export function writeLockEntry(projectRoot: string, extensionId: string, entry: LockEntry): Lockfile {
  const lock = readLock(projectRoot) ?? { lockfileVersion: 1 as const, extensions: {} }
  lock.extensions[extensionId] = entry
  lock.extensions = Object.fromEntries(Object.entries(lock.extensions).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(join(projectRoot, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`)
  return lock
}

/** Drop an extension's entry (uninstall); a missing file or entry is fine. */
export function removeLockEntry(projectRoot: string, extensionId: string): void {
  const lock = readLock(projectRoot)
  if (!lock || !(extensionId in lock.extensions)) return
  delete lock.extensions[extensionId]
  writeFileSync(join(projectRoot, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`)
}
