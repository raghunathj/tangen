/**
 * File Name: use-object-versions.ts
 * Purpose: Version-history state for the object editor (R3 of the SRP refactor):
 *          list fetching, the read-only version preview (viewVersion/exitPreview),
 *          the restore confirm flow, and the diff-modal toggle. The editor's core
 *          draft state (title/slug/fieldValues, save status, autosave timer) stays
 *          with the page and is passed in — this hook only orchestrates it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: exitPreview here leaves the VERSION-HISTORY preview (restores
 * the captured draft). It is intentionally distinct from the page's closePreview,
 * which closes the LIVE-PREVIEW pane — the two must never share a name (a past
 * name collision silently routed the pane's X to the wrong handler).
 */
import { useRef, useState, type MutableRefObject } from 'react'
import type { FieldDefinition } from '@tangen/types'
import { adminFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { extractFieldValues, mergeVersionSnapshot, normalizeObjectData } from '@/lib/editor'

export interface VersionEntry {
  id: string
  version: number
  versionType: string | null
  createdAt: string
  createdBy: string | null
  createdByType: 'member' | 'api_key' | null
  createdByLabel: string | null
  title: string | null
}

/** The draft snapshot captured on preview entry / restored on exit. */
export interface EditorDraftSnapshot {
  title: string
  slug: string
  fieldValues: Record<string, unknown>
}

export interface UseObjectVersionsOpts<TObj extends { id: string; title: string | null; slug: string | null }> {
  isNew: boolean
  typeName: string
  object: TObj | null
  setObject: (o: TObj) => void
  /** Current type's field definitions; null until the type definition loads. */
  fields: FieldDefinition[] | null
  setTitle: (v: string) => void
  setSlug: (v: string) => void
  setFieldValues: (v: Record<string, unknown>) => void
  setValidationErrors: (v: Record<string, string>) => void
  setRichTextKey: (updater: (k: number) => number) => void
  setSaveStatus: (s: 'idle') => void
  /** Editor autosave timer — cancelled before swapping preview content in. */
  autoSaveTimer: MutableRefObject<ReturnType<typeof setTimeout> | null>
  /** Editor "last saved" JSON snapshot — rewritten after a restore. */
  lastSavedRef: MutableRefObject<string>
  /** Draft captured while previewing a version / viewing live; restored on exit. */
  liveDataRef: MutableRefObject<EditorDraftSnapshot | null>
  /** Always-current real draft (updated by the page every render). */
  trueDraftRef: MutableRefObject<EditorDraftSnapshot>
}

export function useObjectVersions<TObj extends { id: string; title: string | null; slug: string | null }>(
  opts: UseObjectVersionsOpts<TObj>,
) {
  const {
    isNew, typeName, object, setObject, fields,
    setTitle, setSlug, setFieldValues, setValidationErrors, setRichTextKey, setSaveStatus,
    autoSaveTimer, lastSavedRef, liveDataRef, trueDraftRef,
  } = opts

  const [showHistory, setShowHistory] = useState(false)
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [previewingVersion, setPreviewingVersion] = useState<VersionEntry | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<VersionEntry | null>(null)
  // Fields present in a version snapshot but no longer in the current schema
  const [orphanFields, setOrphanFields] = useState<Array<{ name: string; value: unknown }>>([])
  const [showDiff, setShowDiff] = useState(false)

  /** Per-object state reset — called by the load effect on an in-place object switch. */
  function resetVersionState() {
    setVersions([])
    setPreviewingVersion(null)
    setShowHistory(false)
    setShowDiff(false)
    setOrphanFields([])
    setRestoreTarget(null)
  }

  async function loadVersions() {
    if (isNew || !object) return
    setVersionsLoading(true)
    try {
      const res = await adminFetch<{ data: VersionEntry[] }>(
        `/objects/${object.id}/versions`, undefined, { type: typeName },
      )
      setVersions(res.data)
    } catch {
      setVersions([])
    } finally {
      setVersionsLoading(false)
    }
  }

  function toggleHistory() {
    const next = !showHistory
    setShowHistory(next)
    if (next) loadVersions()
  }

  async function viewVersion(v: VersionEntry) {
    if (!object) return
    setPreviewLoading(true)
    try {
      const res = await adminFetch<{ data: { snapshot: { title?: string | null; slug?: string | null; values?: Record<string, unknown> } } }>(
        `/objects/${object.id}/versions/${v.id}`, undefined, { type: typeName },
      )
      const snap = res.data.snapshot
      // Cancel any pending auto-save before swapping content into the editor
      if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null }
      setSaveStatus('idle')
      // Capture the real draft state only when entering preview for the first time.
      // If already previewing another version, keep the original liveDataRef so
      // clicking Cancel always returns to the actual draft, not a previous version's content.
      if (!previewingVersion) {
        liveDataRef.current = { ...trueDraftRef.current }
      }
      setTitle(snap.title ?? '')
      setSlug(snap.slug ?? '')
      // Merge snapshot values onto a base of undefined-valued schema fields so that
      // fields added after this version was saved still appear (as empty) in the preview,
      // and fields that existed in this version override that base. Fields that exist
      // in this snapshot but no longer in the schema surface as orphans.
      const { merged, orphans } = mergeVersionSnapshot(fields, snap.values)
      setFieldValues(merged)
      setOrphanFields(orphans)
      setRichTextKey(k => k + 1)
      setPreviewingVersion(v)
      // Clear stale validation errors from a prior publish attempt — they don't
      // apply to the version now being previewed (which may already satisfy them).
      setValidationErrors({})
      setShowHistory(false)
    } catch (err) {
      toast.error('Could not load version', err instanceof Error ? err.message : undefined)
    } finally {
      setPreviewLoading(false)
    }
  }

  function exitPreview() {
    if (liveDataRef.current) {
      setTitle(liveDataRef.current.title)
      setSlug(liveDataRef.current.slug)
      setFieldValues(liveDataRef.current.fieldValues)
      liveDataRef.current = null
    }
    setRichTextKey(k => k + 1)
    setPreviewingVersion(null)
    setOrphanFields([])
  }

  function handleRestore(versionId: string) {
    if (!object) return
    const v = versions.find(v => v.id === versionId) ?? previewingVersion
    setRestoreTarget(v ? { ...v, id: versionId } : { id: versionId, version: 0, versionType: null, createdAt: '', createdBy: null, createdByType: null, createdByLabel: null, title: null })
  }

  async function executeRestore(versionId: string) {
    if (!object) return
    setRestoreTarget(null)
    setRestoringId(versionId)
    try {
      const res = await adminFetch<{ data: Record<string, unknown> }>(
        `/objects/${object.id}/versions/${versionId}/restore`,
        { method: 'POST' }, { type: typeName },
      )
      const normalized = normalizeObjectData(res.data) as unknown as TObj
      setObject(normalized)
      setTitle(normalized.title ?? '')
      setSlug(normalized.slug ?? '')
      const fv = extractFieldValues(normalized as unknown as Record<string, unknown>, fields ?? [])
      if (fields) setFieldValues(fv)
      lastSavedRef.current = JSON.stringify({ title: normalized.title ?? '', fieldValues: fv })
      liveDataRef.current = null
      setPreviewingVersion(null)
      setOrphanFields([])
      toast.success('Version restored')
      loadVersions()
    } catch (err) {
      toast.error('Restore failed', err instanceof Error ? err.message : undefined)
    } finally {
      setRestoringId(null)
    }
  }

  function refreshVersions() {
    if (showHistory) loadVersions()
    else setVersions([]) // invalidate so panel reloads fresh next open
  }
  // Stable ref so the page's doSave can call the latest refreshVersions without
  // adding it to deps (adding it would cancel the auto-save timer every render).
  const refreshVersionsRef = useRef(refreshVersions)
  refreshVersionsRef.current = refreshVersions

  return {
    versions, versionsLoading, restoringId, previewingVersion, previewLoading,
    showHistory, restoreTarget, setRestoreTarget, orphanFields, showDiff, setShowDiff,
    loadVersions, toggleHistory, viewVersion, exitPreview, handleRestore, executeRestore,
    refreshVersions, refreshVersionsRef, resetVersionState,
  }
}
