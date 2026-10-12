/**
 * File Name: field-focus.ts
 * Purpose: Field-level presence, the publishing half: which field a focus
 *          or blur landed on, and the presence state the object editor
 *          sends for it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md sections 22-24
 *          (admin presence carries `field`: "Omkar is currently editing
 *          this field", advisory, never a lock) and 39 (high-frequency UI
 *          events are never broadcast raw). The editor does not listen to
 *          every input: ONE capture-phase focus/blur pair on the editor
 *          root resolves the nearest `data-field` wrapper, which every
 *          field block and the title already carry for scroll-to-error, so
 *          no field renderer had to change. The result is state, not a
 *          message: usePresence sends it when it changes and the client
 *          coalesces inside the server's two-second window, so a focus
 *          change costs at most one presence update and typing costs
 *          nothing. No cursors, no selection, no text.
 */
import type { PresenceState } from '@tangen/realtime-admin'

/** The title block's data-field marker; it is the `title` field to everyone else. */
const TITLE_MARKER = '__title'

/**
 * The field a focus or blur target belongs to: the nearest `data-field`
 * wrapper's name, `title` for the title block, null outside any field.
 * @param target - `event.target` on focus, `event.relatedTarget` on blur.
 */
export function fieldOfFocusTarget(target: EventTarget | null | undefined): string | null {
  const closest = (target as { closest?: (selector: string) => { getAttribute(name: string): string | null } | null } | null)?.closest
  if (typeof closest !== 'function') return null
  const wrapper = closest.call(target, '[data-field]')
  const name = wrapper?.getAttribute('data-field')
  if (!name) return null
  return name === TITLE_MARKER ? 'title' : name
}

export interface EditorPresenceInput {
  /** The form has unsaved changes. */
  editing: boolean
  /** The field that has focus, if any. */
  field: string | null | undefined
  /** The object's content type, so the server mirrors the session on the per-type aggregate the objects list watches. */
  typeSlug?: string | null
}

/**
 * What the editor says it is doing: `editing` on a field while one has
 * focus, otherwise the form's own word (`editing` with unsaved changes,
 * `viewing` without). A `field` key is present only while a field has focus,
 * so a blur clears it on the wire rather than leaving a stale name behind.
 * The type slug rides along whenever it is known.
 */
export function editorPresenceState({ editing, field, typeSlug }: EditorPresenceInput): PresenceState {
  const state: PresenceState = field
    ? { state: 'editing', field }
    : { state: editing ? 'editing' : 'viewing' }
  if (typeSlug) state.typeSlug = typeSlug
  return state
}
