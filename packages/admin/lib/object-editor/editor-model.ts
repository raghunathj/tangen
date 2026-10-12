/**
 * File Name: editor-model.ts
 * Purpose: The headless content-editor model (UI V2 stage V6, spec §19). The
 *          values a document holds (title, slug, field values), the saved
 *          snapshot they are compared against, the validation errors, the
 *          save status and the "changed elsewhere" conflict flag - as one
 *          store with no React and no DOM, so the rules that decide "is this
 *          dirty", "may autosave fire", "which errors clear when a field is
 *          edited" are tested without a page, and every editor surface (the
 *          document column, the inspector, an inline row editor) reads the
 *          same truth.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: zustand/vanilla only. The React binding is
 *          use-object-editor.ts. `lastSavedRef` is a ref-shaped view of the
 *          saved snapshot so the load, versions and lifecycle hooks that take
 *          a MutableRefObject<string> keep working unchanged.
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { MutableRefObject } from 'react'

export type SaveStatus = 'idle' | 'pending' | 'autosaving' | 'saving' | 'saved' | 'error'

export interface EditorValues {
  title: string
  slug: string
  fieldValues: Record<string, unknown>
}

export interface EditorModelState extends EditorValues {
  saveStatus: SaveStatus
  validationErrors: Record<string, string>
  /** A save was refused because someone else saved first (STALE_OBJECT). */
  conflict: boolean
  /** JSON of `{ title, fieldValues }` at the last save; '' before hydration. */
  savedSnapshot: string
}

type Updater<T> = T | ((prev: T) => T)
const resolve = <T,>(u: Updater<T>, prev: T): T => (typeof u === 'function' ? (u as (p: T) => T)(prev) : u)

/** The one serialisation dirty tracking compares. */
export function snapshotOf(title: string, fieldValues: Record<string, unknown>): string {
  return JSON.stringify({ title, fieldValues })
}

export interface AutosaveContext {
  isNew: boolean
  hasObject: boolean
  viewingLive: boolean
  previewingVersion: boolean
  hasPendingPanelData: boolean
  dirtyLocaleCount: number
  /** Another person holds the editing claim, or the copy here is stale: read-only until taken over or reloaded (2026-09-13). */
  locked?: boolean
}

export type AutosaveDecision =
  | { fire: false; reason: 'new' | 'no-object' | 'empty-title' | 'viewing-live' | 'previewing-version' | 'locked' | 'conflict' | 'no-baseline' | 'unchanged' }
  | { fire: true }

export interface EditorModel {
  store: StoreApi<EditorModelState>
  getState: () => EditorModelState
  subscribe: StoreApi<EditorModelState>['subscribe']
  setTitle: (v: string) => void
  setSlug: (v: string) => void
  setFieldValues: (v: Updater<Record<string, unknown>>) => void
  /** Sets one field and clears that field's validation error, as an edit does. */
  setField: (name: string, value: unknown) => void
  setSaveStatus: (s: SaveStatus) => void
  setValidationErrors: (v: Updater<Record<string, string>>) => void
  setConflict: (v: boolean) => void
  /** Records the current values as the saved baseline. */
  markSaved: () => void
  /** Replaces the baseline with an explicit snapshot (a load, a restore). */
  setSavedSnapshot: (snapshot: string) => void
  /** Current values differ from the saved baseline. False before hydration. */
  isDirty: () => boolean
  /** The autosave rules of the editor, in one place. */
  autosaveDecision: (ctx: AutosaveContext) => AutosaveDecision
  /** Ref-shaped view of the saved snapshot for hooks that take a MutableRefObject<string>. */
  lastSavedRef: MutableRefObject<string>
}

export function createEditorModel(initial: Partial<EditorModelState> = {}): EditorModel {
  const store = createStore<EditorModelState>(() => ({
    title: '',
    slug: '',
    fieldValues: {},
    saveStatus: 'idle',
    validationErrors: {},
    conflict: false,
    savedSnapshot: '',
    ...initial,
  }))

  const set = store.setState
  const get = store.getState

  const lastSavedRef: MutableRefObject<string> = {
    get current() { return get().savedSnapshot },
    set current(v: string) { set({ savedSnapshot: v }) },
  }

  return {
    store,
    getState: get,
    subscribe: store.subscribe,
    setTitle: (v) => set({ title: v }),
    setSlug: (v) => set({ slug: v }),
    setFieldValues: (v) => set((s) => ({ fieldValues: resolve(v, s.fieldValues) })),
    setField: (name, value) =>
      set((s) => {
        const next: Partial<EditorModelState> = { fieldValues: { ...s.fieldValues, [name]: value } }
        if (s.validationErrors[name]) {
          const errors = { ...s.validationErrors }
          delete errors[name]
          next.validationErrors = errors
        }
        return next
      }),
    setSaveStatus: (saveStatus) => set({ saveStatus }),
    setValidationErrors: (v) => set((s) => ({ validationErrors: resolve(v, s.validationErrors) })),
    setConflict: (conflict) => set({ conflict }),
    markSaved: () => set((s) => ({ savedSnapshot: snapshotOf(s.title, s.fieldValues) })),
    setSavedSnapshot: (savedSnapshot) => set({ savedSnapshot }),
    isDirty: () => {
      const s = get()
      return s.savedSnapshot !== '' && snapshotOf(s.title, s.fieldValues) !== s.savedSnapshot
    },
    autosaveDecision: (ctx) => {
      const s = get()
      if (ctx.isNew) return { fire: false, reason: 'new' }
      if (!ctx.hasObject) return { fire: false, reason: 'no-object' }
      if (!s.title.trim()) return { fire: false, reason: 'empty-title' }
      if (ctx.viewingLive) return { fire: false, reason: 'viewing-live' }
      if (ctx.previewingVersion) return { fire: false, reason: 'previewing-version' }
      // Someone else is editing, or this copy is stale: nothing saves until the author takes over or reloads.
      if (ctx.locked) return { fire: false, reason: 'locked' }
      // A conflicted editor must not keep firing saves the server will refuse.
      if (s.conflict) return { fire: false, reason: 'conflict' }
      // No baseline yet: the object is still hydrating.
      if (!s.savedSnapshot) return { fire: false, reason: 'no-baseline' }
      const changed = snapshotOf(s.title, s.fieldValues) !== s.savedSnapshot
      if (!changed && !ctx.hasPendingPanelData && ctx.dirtyLocaleCount === 0) return { fire: false, reason: 'unchanged' }
      return { fire: true }
    },
    lastSavedRef,
  }
}
