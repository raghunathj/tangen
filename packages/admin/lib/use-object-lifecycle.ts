/**
 * File Name: use-object-lifecycle.ts
 * Purpose: Publish lifecycle for the object editor (R6 of the SRP refactor):
 *          create-draft, publish (with the required-relation cascade dialog and
 *          stale-tab auto-heal), schedule/unschedule, unpublish, archive, the
 *          pre-publish client validation, and the publish split-button menu
 *          state (open flag + anchor ref + click-outside dismiss).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The editor's draft state (title/slug/fieldValues), doSave,
 * translation flush (saveDirtyLocales) and panel-data refs are passed in per
 * render — these handlers are plain per-render closures, exactly as they were
 * inline. Publish order is load-bearing: unsaved shared fields save first, then
 * dirty locales flush, THEN the publish POST (the snapshot must include both).
 * The click-outside dismiss ignores clicks inside `[data-tangen-overlay]`
 * because the menu body-portals via AnchoredDropdown.
 */
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { FieldDefinition, PublishPlan } from '@tangen/types'
import { adminFetch, ApiError } from '@/lib/api'
import { toast } from '@/lib/toast'
import { buildCreateBody, normalizeObjectData, validateFields } from '@/lib/editor'
import { reconcilePublishedPanelData } from '@/lib/object-editor/save-request'

/** Publish blocked by unpublished required relations — dialog payload + retry. */
export interface CascadeDialogState {
  plan: PublishPlan
  retry: () => Promise<void>
}

export interface UseObjectLifecycleOpts<TObj extends { id: string }> {
  isNew: boolean
  typeName: string
  workspaceId: string
  navigate: (to: string) => void
  object: TObj | null
  setObject: (o: TObj) => void
  /** Current type's field definitions; null until the type definition loads. */
  fields: FieldDefinition[] | null
  title: string
  slug: string
  fieldValues: Record<string, unknown>
  dirtyLocales: Set<string>
  saveDirtyLocales: (objectId: string) => Promise<void>
  doSave: (isAuto?: boolean, silent?: boolean, successLabel?: string) => Promise<TObj | null>
  setSaveStatus: (s: 'idle' | 'saving' | 'saved' | 'error') => void
  setValidationErrors: (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void
  /** Optimistic byline update after a local write. */
  markMeAs: (...keys: Array<'updated_by' | 'published_by'>) => void
  refreshVersions: () => void
  lastSavedRef: MutableRefObject<string>
  /** Create/publish response handed to the load effect for seamless /new → /<id>. */
  createdHandoffRef: MutableRefObject<Record<string, unknown> | null>
  /** Cleared to force the extraction effect to resync fieldValues on auto-heal. */
  extractedForObjectId: MutableRefObject<string | null>
  pendingPanelDataRef: MutableRefObject<Record<string, Record<string, unknown>>>
  panelDataMap: Record<string, Record<string, unknown>>
  setPublishedPanelDataMap: (v: Record<string, Record<string, unknown>>) => void
  setHasPendingPanelChanges: (v: boolean) => void
  /** Slug-editing hook bridges — a 409 "slug taken" reopens the slug editor. */
  setSlugStatus: (s: 'taken') => void
  openSlugEdit: () => void
}

export function useObjectLifecycle<TObj extends { id: string }>(opts: UseObjectLifecycleOpts<TObj>) {
  const {
    isNew, typeName, workspaceId, navigate,
    object, setObject, fields, title, slug, fieldValues,
    dirtyLocales, saveDirtyLocales, doSave,
    setSaveStatus, setValidationErrors, markMeAs, refreshVersions,
    lastSavedRef, createdHandoffRef, extractedForObjectId,
    pendingPanelDataRef, panelDataMap, setPublishedPanelDataMap, setHasPendingPanelChanges,
    setSlugStatus, openSlugEdit,
  } = opts

  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const [showPublishDropdown, setShowPublishDropdown] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  // Publish is BLOCKED when required relations point at unpublished targets
  // (NEEDS_CASCADE) or a dependency can't publish (CASCADE_BLOCKED). We never
  // auto-publish them — the modal deep-links each so the user opens + publishes
  // them first, then publishes this item again.
  const [cascadeDialog, setCascadeDialog] = useState<CascadeDialogState | null>(null)

  const publishDropdownRef = useRef<HTMLDivElement>(null)

  // Close publish dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Element
      // The menu body-portals (AnchoredDropdown) - clicks inside it are
      // outside the trigger ref but must not dismiss before their onClick.
      if (t.closest?.('[data-tangen-overlay]')) return
      if (publishDropdownRef.current && !publishDropdownRef.current.contains(t)) {
        setShowPublishDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  /** Per-object state reset — called by the load effect on an in-place object switch. */
  function resetLifecycleState() {
    setShowSchedule(false)
    setScheduleAt('')
    setCascadeDialog(null)
    setConfirmArchive(false)
    setShowPublishDropdown(false)
  }

  function validate(): boolean {
    if (!fields) return false
    const errors = validateFields(title, fieldValues, fields)
    setValidationErrors(errors)
    if (Object.keys(errors).length === 0) return true
    // Scroll to the first error field
    const firstKey = Object.keys(errors)[0]
    const selector = firstKey === '__title' ? '[data-field="__title"]' : `[data-field="${firstKey}"]`
    const el = document.querySelector(selector)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const count = Object.keys(errors).length
    toast.error(
      count === 1 ? 'Required field is missing' : `${count} required fields are missing`,
    )
    return false
  }

  async function doCreateNew(): Promise<TObj | null> {
    const body = buildCreateBody(typeName, title, { ...fieldValues, slug: slug || undefined }, fields ?? [])
    try {
      const res = await adminFetch<{ data: TObj }>(`/objects/${typeName}`, {
        method: 'POST', body: JSON.stringify(body),
      })
      createdHandoffRef.current = res.data as unknown as Record<string, unknown>
      return res.data
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        setValidationErrors((prev) => ({ ...prev, ...err.fieldErrors }))
        const count = Object.keys(err.fieldErrors!).length
        toast.error(count === 1 ? 'Please fix 1 field error' : `Please fix ${count} field errors`)
        const firstKey = Object.keys(err.fieldErrors!)[0]
        document.querySelector(`[data-field="${firstKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        throw err
      }
      const msg = err instanceof Error ? err.message : ''
      if (msg.toLowerCase().includes('slug') || msg.includes('409') || msg.includes('already in use')) {
        setSlugStatus('taken')
        openSlugEdit()
        toast.error('Slug already in use', 'Choose a different slug and try again')
      } else {
        // Every server rejection must be visible — never fail silently
        toast.error('Could not save', msg || 'Unknown error')
      }
      throw err
    }
  }

  async function handleCreateDraft() {
    setSaveStatus('saving')
    try {
      const obj = await doCreateNew()
      if (obj) {
        // Translations drafted in parallel on /new save right after the id exists
        if (dirtyLocales.size > 0) await saveDirtyLocales(obj.id as string)
        toast.success('Draft created')
        navigate(`/${workspaceId}/objects/${typeName}/${obj.id}`)
      }
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  /**
   * POST the publish, handling the relation cascade: on NEEDS_CASCADE /
   * CASCADE_BLOCKED, open the confirm dialog (which retries with cascade=true)
   * instead of erroring. `onSuccess` runs with the published object.
   */
  async function runPublish(objId: string, onSuccess: (data: TObj) => void) {
    setSaveStatus('saving')
    try {
      const res = await adminFetch<{ data: TObj }>(
        `/objects/${typeName}/${objId}/publish`,
        { method: 'POST' },
      )
      setCascadeDialog(null)
      onSuccess(res.data)
      toast.success('Published')
    } catch (err) {
      // Blocked by unpublished required relations — surface them (deep-linked) so
      // the user publishes them first, then retries. No auto-publish / cascade.
      if (err instanceof ApiError && (err.code === 'NEEDS_CASCADE' || err.code === 'CASCADE_BLOCKED') && err.details) {
        setSaveStatus('idle')
        // retry = re-attempt the SAME publish (no cascade). Once the user has
        // published the listed items in the other tabs, "Try again" succeeds; if
        // some are still unpublished, the modal refreshes with what's left.
        setCascadeDialog({ plan: err.details as PublishPlan, retry: () => runPublish(objId, onSuccess) })
        return
      }
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
      toast.error('Publish failed', err instanceof Error ? err.message : undefined)
      // Field-level errors from a failed publish light up the form (red marks,
      // per-field messages) instead of living only in the toast.
      if (err instanceof ApiError && err.fieldErrors) {
        setValidationErrors((prev) => ({ ...prev, ...err.fieldErrors }))
        const firstKey = Object.keys(err.fieldErrors)[0]
        document.querySelector(`[data-field="${firstKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      // Stale-tab auto-heal: this editor has no unsaved edits, yet the server
      // rejected its draft — the tab's state may be OLDER than the server's
      // (edited elsewhere). Re-fetch and resync so the user sees the values the
      // server actually validated. Never runs with unsaved edits (nothing is lost).
      const clean = JSON.stringify({ title, fieldValues }) === lastSavedRef.current
      if (clean && !isNew) {
        try {
          const r = await adminFetch<{ data: TObj }>(`/objects/${typeName}/${objId}`)
          extractedForObjectId.current = null   // force the extraction effect to resync fieldValues
          setObject(normalizeObjectData(r.data as unknown as Record<string, unknown>) as unknown as TObj)
        } catch { /* resync is best-effort */ }
      }
    }
  }

  async function handlePublish() {
    if (!validate()) return

    if (isNew) {
      setSaveStatus('saving')
      let obj: TObj | null
      try {
        // doCreateNew THROWS on a rejected create (e.g. a duplicate URL): its
        // catch shows the toast and lights the field. Without this try the
        // throw escapes handlePublish and leaves saveStatus stuck on 'saving',
        // so the button reads "Creating…" for good.
        obj = await doCreateNew()
      } catch {
        setSaveStatus('error')
        setTimeout(() => setSaveStatus('idle'), 3000)
        return
      }
      if (obj && dirtyLocales.size > 0) await saveDirtyLocales(obj.id as string)
      if (!obj) { setSaveStatus('error'); return }
      await runPublish(obj.id as string, (data) => {
        createdHandoffRef.current = data as unknown as Record<string, unknown>
        navigate(`/${workspaceId}/objects/${typeName}/${obj!.id}`)
      })
      return
    }

    // Capture the pending panel edits BEFORE doSave flushes and clears them:
    // the publish callback below closes over a render-time panelDataMap that
    // doSave's setPanelDataMap makes stale, so we rebuild the true post-save map.
    const publishedPanelSnapshot = reconcilePublishedPanelData(panelDataMap, { ...pendingPanelDataRef.current })
    if (object && title.trim()) {
      const snapshot = JSON.stringify({ title, fieldValues })
      const hasPendingPanelData = Object.keys(pendingPanelDataRef.current).length > 0
      if (snapshot !== lastSavedRef.current || hasPendingPanelData) {
        const saved = await doSave(false, true)  // silent - publish toast covers this
        if (!saved) return
      }
    }

    if (!object) return
    // Unsaved translation edits must land BEFORE the publish snapshot - the
    // main-doc save above only runs when shared fields changed.
    if (dirtyLocales.size > 0) await saveDirtyLocales(object.id)

    await runPublish(object.id, (data) => {
      setObject(normalizeObjectData(data as Record<string, unknown>) as unknown as TObj)
      markMeAs('updated_by', 'published_by')
      // After publish, the current panel data becomes the published snapshot
      // (the reconciled map, not the stale closed-over panelDataMap).
      setPublishedPanelDataMap(publishedPanelSnapshot)
      setHasPendingPanelChanges(false)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
      refreshVersions()
    })
  }

  async function handleSchedule() {
    if (!scheduleAt) return
    if (!validate()) return
    setSaveStatus('saving')
    try {
      let targetId = object?.id
      if (isNew) {
        const obj = await doCreateNew()
        if (!obj) { setSaveStatus('error'); return }
        targetId = obj.id
      }
      if (!targetId) { setSaveStatus('error'); return }
      const res = await adminFetch<{ data: TObj }>(
        `/objects/${targetId}/schedule`,
        { method: 'POST', body: JSON.stringify({ scheduledAt: new Date(scheduleAt).toISOString() }) },
        { type: typeName },
      )
      if (isNew) {
        toast.success('Scheduled')
        navigate(`/${workspaceId}/objects/${typeName}/${targetId}`)
      } else {
        setObject(normalizeObjectData(res.data as Record<string, unknown>) as unknown as TObj)
        setShowSchedule(false)
        setScheduleAt('')
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
        toast.success('Scheduled')
      }
    } catch (err) {
      // Same block as publish: scheduling into an unpublished required relation
      // shows the "publish these first" modal; "Try again" re-attempts the schedule.
      if (err instanceof ApiError && (err.code === 'NEEDS_CASCADE' || err.code === 'CASCADE_BLOCKED') && err.details) {
        setSaveStatus('idle')
        setCascadeDialog({ plan: err.details as PublishPlan, retry: () => handleSchedule() })
        return
      }
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
      toast.error('Schedule failed', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleUnschedule() {
    if (!object) return
    setSaveStatus('saving')
    try {
      const res = await adminFetch<{ data: TObj }>(
        `/objects/${object.id}/schedule`,
        { method: 'DELETE' },
        { type: typeName },
      )
      setObject(normalizeObjectData(res.data as Record<string, unknown>) as unknown as TObj)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
      toast.info('Schedule cancelled')
    } catch (err) {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
      toast.error('Failed to cancel schedule', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleUnpublish() {
    if (!object) return
    setSaveStatus('saving')
    try {
      const res = await adminFetch<{ data: TObj }>(
        `/objects/${typeName}/${object.id}/unpublish`,
        { method: 'POST' },
      )
      setObject(normalizeObjectData(res.data as Record<string, unknown>) as unknown as TObj)
      markMeAs('updated_by')
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
      toast.info('Unpublished - saved as draft')
    } catch (err) {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
      toast.error('Unpublish failed', err instanceof Error ? err.message : undefined)
    }
  }

  async function executeArchive() {
    if (!object) return
    setSaveStatus('saving')
    try {
      const res = await adminFetch<{ data: TObj }>(
        `/objects/${typeName}/${object.id}`,
        { method: 'DELETE' },
      )
      setObject(normalizeObjectData(res.data as Record<string, unknown>) as unknown as TObj)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
      toast.info('Archived')
    } catch (err) {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
      toast.error('Archive failed', err instanceof Error ? err.message : undefined)
    } finally {
      setConfirmArchive(false)
    }
  }

  return {
    showSchedule, setShowSchedule, scheduleAt, setScheduleAt,
    showPublishDropdown, setShowPublishDropdown, confirmArchive, setConfirmArchive,
    cascadeDialog, setCascadeDialog, publishDropdownRef,
    validate, doCreateNew, handleCreateDraft, runPublish,
    handlePublish, handleSchedule, handleUnschedule, handleUnpublish, executeArchive,
    resetLifecycleState,
  }
}
