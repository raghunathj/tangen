/**
 * File Name: push-tracker.ts
 * Purpose: Tracks background `tangen push` runs so the schema-write API can respond
 *   immediately (the file is already written) instead of blocking the HTTP request
 *   on a slow push — which was timing out the dev proxy (502). The route starts a
 *   push, returns a run id, and the admin polls GET /schema/push-status/:id until
 *   the run reaches ok/failed.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { existsSync, readFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export type PushRunStatus = 'running' | 'ok' | 'failed'
export interface PushRun { status: PushRunStatus; output?: string; startedAt: number }

const _runs = new Map<string, PushRun>()
const MAX_RUNS = 20

/**
 * On a DEV server (bun --watch), writing a schema file restarts the process — wiping this
 * in-memory map and orphaning the push child. Runs therefore also record their outcome on
 * disk (the detached push writes `<id>.status` + `<id>.log` here), so the restarted server
 * can still answer status polls.
 */
export const PUSH_RUN_DIR = join(tmpdir(), 'tangen-push-runs')

/** Ensure the on-disk run dir exists (cheap, idempotent). */
export function ensurePushRunDir(): string {
  mkdirSync(PUSH_RUN_DIR, { recursive: true })
  return PUSH_RUN_DIR
}

/** Disk fallback for a run this process doesn't know (i.e. after a dev-watch restart). */
export function readDiskRun(id: string): PushRun | null {
  if (!/^push_[a-z0-9_]+$/i.test(id)) return null   // ids are minted by us - no path tricks
  const statusFile = join(PUSH_RUN_DIR, `${id}.status`)
  const logFile = join(PUSH_RUN_DIR, `${id}.log`)
  try {
    if (existsSync(statusFile)) {
      const code = readFileSync(statusFile, 'utf8').trim()
      const output = existsSync(logFile) ? readFileSync(logFile, 'utf8').slice(-4000) : undefined
      return { status: code === '0' ? 'ok' : 'failed', output, startedAt: 0 }
    }
    if (existsSync(logFile)) {
      // A push that stopped producing output long ago and never wrote its exit status
      // was killed (e.g. by a dev-server restart) — report that instead of "running" forever.
      const idleMs = Date.now() - statSync(logFile).mtimeMs
      if (idleMs > 5 * 60_000) {
        return { status: 'failed', output: 'push never completed - likely killed by a dev-server restart; save again to retry', startedAt: 0 }
      }
      return { status: 'running', startedAt: 0 }
    }
  } catch { /* unreadable → unknown */ }
  return null
}

/** Mint a push run id. */
export function newPushRunId(): string {
  return `push_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Registers a push promise under `id`, marking it running now and updating to
 * ok/failed when it settles (spawnPush never rejects, but we guard anyway). Prunes
 * the oldest runs beyond MAX_RUNS. Returns the id for convenience.
 */
export function trackPush(id: string, p: Promise<{ ok: boolean; output?: string }>): string {
  _runs.set(id, { status: 'running', startedAt: Date.now() })
  if (_runs.size > MAX_RUNS) {
    const oldest = [..._runs.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt).slice(0, _runs.size - MAX_RUNS)
    for (const [k] of oldest) _runs.delete(k)
  }
  p.then((r) => update(id, r.ok ? 'ok' : 'failed', r.output))
    .catch((e) => update(id, 'failed', String(e)))
  return id
}

function update(id: string, status: PushRunStatus, output?: string) {
  const prev = _runs.get(id)
  _runs.set(id, { status, output, startedAt: prev?.startedAt ?? Date.now() })
}

/** The current status of a push run (null for unknown/pruned ids). */
export function getPushRun(id: string): PushRun | null {
  return _runs.get(id) ?? null
}

/** Test helper — clears the registry. */
export function resetPushTracker(): void {
  _runs.clear()
}
