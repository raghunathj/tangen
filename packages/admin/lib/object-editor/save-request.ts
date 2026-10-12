/**
 * File Name: save-request.ts
 * Purpose: The pure halves of the editor's save (UI V2 stage V6): what a
 *          PATCH carries, and what a refusal means. Lifted out of the page's
 *          doSave so both are unit-tested and both surfaces (the document
 *          column today, an inline row editor later) send and read the same
 *          thing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: buildUpdateBody from lib/editor; ApiError from lib/api.
 */
import type { FieldDefinition } from '@tangen/types'
import { ApiError } from '@/lib/api'
import { buildUpdateBody } from '@/lib/editor'

export interface SaveRequestInput {
  title: string
  slug: string
  /** Only an edited slug is sent: re-sending an untouched slug on every
   *  autosave runs the server's uniqueness check for nothing, and a
   *  transiently wrong value would 409 on a plain content edit. */
  slugDirty: boolean
  fieldValues: Record<string, unknown>
  fields: FieldDefinition[]
  /** Panel data waiting to travel with the next save, keyed by panel id. */
  pendingPanelData: Record<string, Record<string, unknown>>
  isAuto: boolean
  /** The version this editor loaded (If-Match): a colleague's newer edit is never silently overwritten. */
  etag: string | null
}

export interface SaveRequest {
  body: Record<string, unknown>
  query: Record<string, string>
  headers: Record<string, string>
}

export function buildSaveRequest(input: SaveRequestInput): SaveRequest {
  const body = buildUpdateBody(
    input.title,
    { ...input.fieldValues, slug: input.slugDirty ? (input.slug || undefined) : undefined },
    input.fields,
  ) as Record<string, unknown>
  // The API runner extracts `__panelData_<panelId>` keys into ctx.panelData
  // before calling hooks.
  for (const [panelId, data] of Object.entries(input.pendingPanelData)) {
    body[`__panelData_${panelId}`] = data
  }
  const query: Record<string, string> = {}
  if (input.isAuto) query.noRevision = '1'
  const headers: Record<string, string> = {}
  if (input.etag) headers['If-Match'] = input.etag
  return { body, query, headers }
}

/**
 * The published snapshot of panel data after a publish-save. `handlePublish`
 * closes over `panelDataMap` at render time, but the save it awaits flushes the
 * pending edits into that state via `setPanelDataMap` - so the closed-over map
 * is stale by exactly those edits. Layering the pending edits (captured BEFORE
 * the save clears them) over the stale map rebuilds the true post-save map, so
 * the published snapshot equals what was saved and the draft indicator clears
 * instead of lingering until a reload resyncs both sides.
 */
export function reconcilePublishedPanelData(
  panelDataMap: Record<string, Record<string, unknown>>,
  pendingPanelData: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return { ...panelDataMap, ...pendingPanelData }
}

/**
 * The GENERAL panel draft/published convention (not tied to any extension).
 *
 * A panel whose hook keeps a published snapshot beside its draft may store its
 * data in the platform's versioned draft/published shape:
 *
 *     { draft, published?, schemaVersion? }
 *
 * When it does, the editor's "changes in draft" indicator understands it: the
 * two sides of the dirty check are reduced to their `draft` before comparing.
 * This is core support for a documented convention (see docs/extensions.md, the
 * panel-data contract) - it carries no knowledge of which extension uses it. A
 * panel that stores its data verbatim (no `draft` wrapper) is compared as-is;
 * the unwrap is deliberately tight (keys exactly within the convention) so a
 * panel that merely happens to carry a `draft` field is left untouched.
 *
 * The reduction also removes a class of false positive: the two maps can arrive
 * in different shapes (the server sends the whole stored row; a panel edit
 * overwrites its entry with just the bare draft it emits), and comparing those
 * raw would read an edit-reverted-to-published value as "draft changes".
 */
export const DRAFT_WRAPPER_KEYS = new Set(['draft', 'published', 'schemaVersion'])
/** Exported for the panel-data contract test: what the editor unwraps must be what a declared codec reads. */
export function editableDraft(panelData: unknown): unknown {
  if (panelData && typeof panelData === 'object' && !Array.isArray(panelData)) {
    const rec = panelData as Record<string, unknown>
    const keys = Object.keys(rec)
    if (keys.length > 0 && 'draft' in rec && keys.every((k) => DRAFT_WRAPPER_KEYS.has(k))) {
      return rec.draft ?? {}
    }
  }
  return panelData ?? {}
}

/**
 * Whether any installed panel's draft differs from its published snapshot -
 * the panel half of the editor's "changes in draft" indicator. Normalizes both
 * sides through `editableDraft` first (see above). Returns false when there is
 * no published map yet, so the caller falls through to its content checks.
 */
export function panelDataHasDraftChanges(
  panelDataMap: Record<string, Record<string, unknown>>,
  publishedPanelDataMap: Record<string, Record<string, unknown>> | null | undefined,
): boolean {
  if (!publishedPanelDataMap) return false
  for (const panelId of Object.keys(panelDataMap)) {
    if (JSON.stringify(editableDraft(panelDataMap[panelId])) !== JSON.stringify(editableDraft(publishedPanelDataMap[panelId]))) return true
  }
  return false
}

export type SaveFailure =
  | { kind: 'field-errors'; fieldErrors: Record<string, string> }
  | { kind: 'stale' }
  | { kind: 'slug-taken'; message: string }
  | { kind: 'other'; message: string }

/** What a refused save means to the editor. Order matters: a field error
 *  is a field error even when its message mentions a slug. */
export function classifySaveFailure(err: unknown): SaveFailure {
  if (err instanceof ApiError && err.fieldErrors) return { kind: 'field-errors', fieldErrors: err.fieldErrors }
  if (err instanceof ApiError && err.code === 'STALE_OBJECT') return { kind: 'stale' }
  const message = err instanceof Error ? err.message : ''
  if (message.toLowerCase().includes('slug') || message.includes('already in use')) return { kind: 'slug-taken', message }
  return { kind: 'other', message }
}
