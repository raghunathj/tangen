/**
 * File Name: schema-save.ts
 * Purpose: Saving a content type / global from the schema builder. The write API now
 *   writes the file and starts `tangen push` in the BACKGROUND (returning a push run
 *   id) so the request returns immediately instead of blocking on a slow push — which
 *   was timing out the dev proxy (502). This module posts the write, then polls
 *   GET /schema/push-status/:id until the push settles.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { adminFetch } from '@/lib/api'
import { fromGeneratedSchema, toObjectType, toComponentDef, toGlobalDef } from '@/lib/schema-builder-model'

export interface SchemaSaveResult {
  written: string[]
  /** The background push run id to poll, if one was started. */
  pushId?: string
}

interface RawSaveResponse {
  data?: { written?: string[]; push?: { id?: string; status?: string } }
}

/** Pure: maps the write API response to a UI-friendly result. */
export function interpretSaveResponse(res: RawSaveResponse): SchemaSaveResult {
  const d = res.data ?? {}
  return { written: d.written ?? [], pushId: d.push?.id }
}

/**
 * Writes a content type; returns the written files + a push run id to poll.
 * `confirm` makes the background push run with --confirm — required when the save
 * REMOVES fields (their columns + stored values drop).
 */
export async function saveSchemaType(type: unknown, opts: { confirm?: boolean; scope?: 'scoped' | 'all' } = {}): Promise<SchemaSaveResult> {
  // Scoped by default (apply only this type + its out-of-sync deps); scope:'all' opts into
  // the full whole-codebase reconcile.
  const params = new URLSearchParams()
  if (opts.confirm) params.set('confirm', 'true')
  if (opts.scope === 'all') params.set('scope', 'all')
  const qs = params.toString()
  const res = await adminFetch<RawSaveResponse>(`/admin/schema/types${qs ? `?${qs}` : ''}`, {
    method: 'POST',
    body: JSON.stringify(type),
  })
  return interpretSaveResponse(res)
}

export interface PendingPlan {
  ok: boolean
  affectedTypes: string[]
  hasDestructive: boolean
  counts?: { added: number; changed: number; removed: number }
  /** Scoped preview (when `type` given): out-of-sync dependency types a `--type` apply pulls in. */
  extraTypes?: string[]
}

/**
 * Dry-run the whole-codebase push (`tangen push --plan`) to see which types it WOULD
 * apply — so the builder can warn, before an Apply, that types OTHER than the one being
 * edited also have pending changes (a colleague's WIP pulled from git, an unrelated local
 * edit). Read-only; `ok:false` when it couldn't be computed (the warning just skips).
 */
export async function getPendingPlan(type?: string): Promise<PendingPlan> {
  try {
    // With `type`, a SCOPED preview: what applying only this type touches + the out-of-sync
    // dependencies it pulls in (extraTypes). Without, the full whole-codebase preview.
    const path = `/admin/schema/pending-plan${type ? `?type=${encodeURIComponent(type)}` : ''}`
    const res = await adminFetch<{ data?: PendingPlan }>(path, { method: 'GET' })
    return res.data ?? { ok: false, affectedTypes: [], hasDestructive: false }
  } catch {
    return { ok: false, affectedTypes: [], hasDestructive: false }
  }
}

/** PERMANENTLY deletes a content type (drops table + data on push) — confirm is explicit. */
export async function deleteSchemaType(name: string): Promise<SchemaSaveResult> {
  const res = await adminFetch<RawSaveResponse>(`/admin/schema/types/${name}?confirm=true`, { method: 'DELETE' })
  return interpretSaveResponse(res)
}

/** Writes a global (upsert); returns the written files + a push run id to poll. */
export async function saveSchemaGlobal(global: unknown): Promise<SchemaSaveResult> {
  const res = await adminFetch<RawSaveResponse>('/admin/schema/globals', {
    method: 'POST',
    body: JSON.stringify(global),
  })
  return interpretSaveResponse(res)
}

/**
 * Convert an AI-generated draft (with `kind`) into the codegen item the batch endpoint
 * expects — reusing the same converters the single-schema builders use.
 */
export function draftToBatchItem(draft: { kind?: string } & Record<string, unknown>): Record<string, unknown> {
  const model = fromGeneratedSchema(draft)
  if (draft.kind === 'component') return { kind: 'component', ...toComponentDef(model) }
  if (draft.kind === 'global') return { kind: 'global', ...toGlobalDef(model) }
  return { kind: 'type', ...toObjectType(model) }
}

/** Writes a whole set of schemas via the batch endpoint; returns a push id to poll. */
export async function saveSchemaBatch(drafts: Array<{ kind?: string } & Record<string, unknown>>): Promise<SchemaSaveResult> {
  const items = drafts.map(draftToBatchItem)
  const res = await adminFetch<RawSaveResponse>('/admin/schema/batch', { method: 'POST', body: JSON.stringify({ items }) })
  return interpretSaveResponse(res)
}

export type PushOutcome =
  | { status: 'ok' }
  | { status: 'failed'; output?: string }
  | { status: 'timeout' }

/**
 * Polls the background push run until it reaches ok/failed, or times out. Absent a
 * push id (nothing to push), resolves ok immediately.
 */
export async function waitForPush(
  pushId: string | undefined,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<PushOutcome> {
  if (!pushId) return { status: 'ok' }
  const interval = opts.intervalMs ?? 1500
  const timeout = opts.timeoutMs ?? 90_000
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval))
    try {
      const res = await adminFetch<{ data: { status: string; output?: string } }>(`/admin/schema/push-status/${pushId}`)
      const s = res.data?.status
      if (s === 'ok') return { status: 'ok' }
      if (s === 'failed') return { status: 'failed', output: res.data?.output }
      // 'running' / 'unknown' → keep polling
    } catch { /* transient - keep polling */ }
  }
  return { status: 'timeout' }
}

/**
 * Fired after a schema change lands (push applied) so live surfaces — the workspace
 * nav and the command palette — refetch /types without a full reload.
 */
export const TYPES_CHANGED_EVENT = 'tangen:types-changed'
export function notifyTypesChanged(): void {
  window.dispatchEvent(new CustomEvent(TYPES_CHANGED_EVENT))
}
