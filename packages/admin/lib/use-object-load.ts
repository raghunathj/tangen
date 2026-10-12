/**
 * File Name: use-object-load.ts
 * Purpose: Object loading for the editor (R8 of the SRP refactor): the merged
 *          SINGLE GET (`?locale=all` returns data + audit + i18n + extensionData
 *          + publishedExtensionData in one request - never split it), the
 *          seamless /new → /<id> created-object handoff, the per-object state
 *          reset on in-place object switches, and the field-value extraction
 *          effect that establishes the autosave baseline.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The editor's draft state (title/slug/fieldValues) and
 * save-status stay with the page and are passed in. Per-object state owned by
 * the page and sibling hooks (version history, lifecycle dialogs, view-live,
 * collapsed groups, slug dirtiness…) is reset through resetPerObjectStateRef -
 * a ref the page re-populates every render AFTER those hooks run, so the load
 * effect (which fires post-render) always calls the current resets.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { FieldDefinition } from '@tangen/types'
import { adminFetch, etagOf } from '@/lib/api'
import { extractFieldValues, normalizeObjectData } from '@/lib/editor'

/** Admin-only audit block from GET /objects/:id — who created/updated/published. */
export interface AuditActor { id: string; label: string | null; kind: 'member' | 'api_key' | null }
export interface AuditInfo { created_by: AuditActor | null; updated_by: AuditActor | null; published_by: AuditActor | null }

export interface UseObjectLoadOpts<TObj extends { id: string; title: string | null; slug: string | null }> {
  accessToken: string | null | undefined
  isNew: boolean
  /** Route id segment ("new" for creation). */
  id: string
  typeName: string
  /** Current type's field definitions; null until the type definition loads. */
  fields: FieldDefinition[] | null
  setTitle: (v: string) => void
  setSlug: (v: string) => void
  setFieldValues: (v: Record<string, unknown>) => void
  setSaveStatus: (s: 'idle') => void
  /** Editor "last saved" JSON snapshot — cleared on switch, seeded on extract. */
  lastSavedRef: MutableRefObject<string>
  pendingPanelDataRef: MutableRefObject<Record<string, Record<string, unknown>>>
  setHasPendingPanelChanges: (v: boolean) => void
  /** Runs every page-and-sibling-hook per-object reset; populated by the page each render. */
  resetPerObjectStateRef: MutableRefObject<() => void>
}

export function useObjectLoad<TObj extends { id: string; title: string | null; slug: string | null }>(
  opts: UseObjectLoadOpts<TObj>,
) {
  const {
    accessToken, isNew, id, typeName, fields,
    setTitle, setSlug, setFieldValues, setSaveStatus,
    lastSavedRef, pendingPanelDataRef, setHasPendingPanelChanges, resetPerObjectStateRef,
  } = opts

  const [object, setObject] = useState<TObj | null>(null)
  const [audit, setAudit] = useState<AuditInfo | null>(null)
  // C4: extension panels (and any editor chrome) can force a full re-run of
  // the object load — same code path as switching to the object, so every
  // per-object piece of state resets consistently.
  const [reloadSeq, setReloadSeq] = useState(0)
  const refresh = useCallback(() => setReloadSeq((n) => n + 1), [])
  const [loading, setLoading] = useState(!isNew)
  const [i18nMap, setI18nMap] = useState<Record<string, Record<string, unknown>>>({})
  const [i18nLoaded, setI18nLoaded] = useState(false)
  // Per-panel data loaded from extension_data and tracked as panels emit onChange (keyed by extensionId)
  const [panelDataMap, setPanelDataMap] = useState<Record<string, Record<string, unknown>>>({})
  // Last-published snapshot of panel data — null means not yet loaded
  const [publishedPanelDataMap, setPublishedPanelDataMap] = useState<Record<string, Record<string, unknown>> | null>(null)

  // Tracks which object ID has had its field values extracted.
  // We only re-extract on a new object load — not on every save/publish response —
  // because PATCH/publish responses return media as a bare ID string, which would
  // downgrade the richer in-memory asset object (breaking the thumbnail).
  const extractedForObjectId = useRef<string | null>(null)
  // Seamless /new → /<id> transition: the create/publish response is handed to
  // the load effect so the editor hydrates instantly instead of blanking to a
  // skeleton (the "everything refreshes" glitch on save/AI-apply).
  /** The loaded object's concurrency token (ETag), sent back on save. */
  const etagRef = useRef<string | null>(null)
  const createdHandoffRef = useRef<Record<string, unknown> | null>(null)

  useEffect(() => {
    if (!accessToken || isNew) { setLoading(false); return }
    const handoff = createdHandoffRef.current
    if (handoff && handoff.id === id) {
      // We ALREADY rendered this content on /new — hydrate in place, no skeleton.
      createdHandoffRef.current = null
      const obj = normalizeObjectData(handoff) as unknown as TObj
      setObject(obj)
      setTitle(obj.title ?? '')
      setSlug(obj.slug ?? '')
      setLoading(false)
      setSaveStatus('idle')
      // Silent refresh for audit info (who created/updated) — no visible reset.
      adminFetch<{ data: TObj; audit?: AuditInfo }>(
        `/objects/${typeName}/${id}`,
      ).then((r) => setAudit(r.audit ?? null)).catch(() => {})
      return
    }
    setLoading(true)
    setSaveStatus('idle')
    lastSavedRef.current = ''
    setObject(null)
    setTitle('')
    setSlug('')
    setFieldValues({})
    // The editor is no longer remounted per object (router key removed), so we
    // must clear every per-object piece of state here or it leaks across a
    // switch. Core (above) + audit/panel/i18n here + everything the page and
    // sibling hooks own (versions, lifecycle dialogs, view-live, slug
    // dirtiness, collapsed groups, rich-text remount) via the reset ref:
    setAudit(null)
    resetPerObjectStateRef.current()
    setPanelDataMap({})
    setPublishedPanelDataMap(null)
    setHasPendingPanelChanges(false)
    pendingPanelDataRef.current = {}
    extractedForObjectId.current = null
    setI18nMap({})
    setI18nLoaded(false)
    // ONE GET serves everything: ?locale=all makes the response carry the
    // translations map alongside data + audit (a second /objects fetch per
    // editor open before - and its i18nLoaded gate never reset on object
    // switch, so editor-to-editor navigation kept the PREVIOUS object's
    // translations). When localization is off the server ignores the param.
    adminFetch<{
      data: TObj
      audit?: AuditInfo
      i18n?: Record<string, Record<string, unknown>>
      extensionData?: Record<string, Record<string, unknown>>
      publishedExtensionData?: Record<string, Record<string, unknown> | null>
    }>(
      `/objects/${typeName}/${id}?locale=all`,
    )
      .then((r) => {
        // The version this editor is about to edit (Phase 6B, Unit 6): the
        // save sends it back as If-Match, so a colleague's newer edit is
        // refused rather than overwritten.
        etagRef.current = etagOf(r)
        const obj = normalizeObjectData(r.data as unknown as Record<string, unknown>) as unknown as TObj
        setObject(obj)
        setAudit(r.audit ?? null)
        setTitle(obj.title ?? '')
        setSlug(obj.slug ?? '')
        setI18nMap(r.i18n ?? {})
        setI18nLoaded(true)
        // Panel data rides the same response now (draft + published) - the
        // editor previously fetched /extensions/:id/data/:objId once PER panel.
        setPanelDataMap(r.extensionData ?? {})
        setPublishedPanelDataMap(Object.fromEntries(
          Object.entries(r.publishedExtensionData ?? {}).map(([k, v]) => [k, v ?? {}]),
        ))
        // fieldValues and lastSavedRef are set by the extraction effect below,
        // which fires whenever both the type definition and object are available.
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  // The type definition intentionally excluded — its presence is handled by the extraction effect.
  // Including it caused a double-fetch (effect re-ran when typeDef loaded), creating a race
  // where lastSavedRef was set before the second fetch completed, triggering spurious autosaves.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, isNew, id, typeName, reloadSeq])

  useEffect(() => {
    if (fields && object && object.id !== extractedForObjectId.current) {
      const fv = extractFieldValues(object as unknown as Record<string, unknown>, fields)
      setFieldValues(fv)
      lastSavedRef.current = JSON.stringify({ title: object.title ?? '', fieldValues: fv })
      extractedForObjectId.current = object.id as string
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, object])

  return {
    object, setObject, audit, setAudit, loading, refresh, etagRef,
    i18nMap, setI18nMap, i18nLoaded,
    panelDataMap, setPanelDataMap, publishedPanelDataMap, setPublishedPanelDataMap,
    extractedForObjectId, createdHandoffRef,
  }
}
