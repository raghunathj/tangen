/**
 * File Name: use-slug-editing.ts
 * Purpose: Slug edit-mode state + availability check for the object editor
 *          (R4 of the SRP refactor). Owns the modal state (editing/draft/status
 *          + debounce timer); the canonical `slug` value and the shared
 *          autosave `slugDirty` ref stay with the editor and are passed in.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useRef, useState, type MutableRefObject } from 'react'
import { adminFetch } from '@/lib/api'
import { slugify } from '@/lib/editor'

export type SlugStatus = 'idle' | 'checking' | 'available' | 'taken'

export interface UseSlugEditingOpts {
  slug: string
  setSlug: (s: string) => void
  title: string
  isNew: boolean
  objectId: string | undefined
  typeName: string
  /** Shared with the editor's autosave dirty-tracking. */
  slugDirty: MutableRefObject<boolean>
}

export function useSlugEditing(opts: UseSlugEditingOpts) {
  const { slug, setSlug, title, isNew, objectId, typeName, slugDirty } = opts
  const [slugEditing, setSlugEditing] = useState(false)
  const [slugDraft, setSlugDraft] = useState('')
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle')
  const slugCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleSlugChange(value: string) {
    slugDirty.current = true
    setSlug(value)
  }

  function checkSlugAvailability(value: string) {
    if (!value.trim()) { setSlugStatus('idle'); return }
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current)
    setSlugStatus('checking')
    slugCheckTimer.current = setTimeout(async () => {
      try {
        const excludeId = !isNew && objectId ? `&excludeId=${objectId}` : ''
        const res = await adminFetch<{ available: boolean }>(
          `/objects/slug-check?type=${typeName}&slug=${encodeURIComponent(value)}${excludeId}`,
        )
        setSlugStatus(res.available ? 'available' : 'taken')
      } catch {
        setSlugStatus('idle')
      }
    }, 350)
  }

  function openSlugEdit() {
    setSlugDraft(slug || slugify(title))
    setSlugStatus('idle')
    setSlugEditing(true)
  }

  function commitSlugEdit() {
    const cleaned = slugify(slugDraft) || slug
    if (slugStatus === 'taken') return
    setSlug(cleaned)
    slugDirty.current = true
    setSlugEditing(false)
    setSlugStatus('idle')
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current)
  }

  function cancelSlugEdit() {
    setSlugEditing(false)
    setSlugStatus('idle')
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current)
  }

  return {
    slugEditing, slugDraft, setSlugDraft, slugStatus, setSlugStatus,
    handleSlugChange, checkSlugAvailability, openSlugEdit, commitSlugEdit, cancelSlugEdit,
  }
}
