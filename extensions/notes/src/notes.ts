/**
 * File Name: notes.ts
 * Purpose: The notes extension's pure logic: what a note is, its store key,
 *          what a valid text is, who may remove a note, and the order notes
 *          are shown in. No I/O, so it is tested without a server.
 *
 * Author: Raghunath J
 * License: MIT
 */

export const NOTE_MAX = 2000

/** A note as the store holds it. The author's name and avatar are a display snapshot; `authorId` is the fact. */
export interface Note {
  id: string
  objectId: string
  text: string
  authorId: string | null
  authorName: string
  authorAvatar: string | null
  createdAt: string
}

/** The store key of a note: every note of an object shares the prefix, so one `list(prefix)` reads a thread. */
export const notePrefix = (objectId: string): string => `note:${objectId}:`
export const noteKey = (objectId: string, id: string): string => `${notePrefix(objectId)}${id}`

/** A sortable id: time first, so `list` by key is chronological, then a random tail. */
export function newNoteId(now: number = Date.now()): string {
  return `${now.toString(36).padStart(9, '0')}_${Math.random().toString(36).slice(2, 8)}`
}

/** The text a note may carry: trimmed, not empty, not longer than a screen. Returns the problem, or null. */
export function noteTextIssue(text: unknown): string | null {
  if (typeof text !== 'string') return 'A note is text'
  const t = text.trim()
  if (t === '') return 'A note cannot be empty'
  if (t.length > NOTE_MAX) return `A note is at most ${NOTE_MAX} characters`
  return null
}

/** Newest first: the thread reads top-down from the latest word. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

/** An author removes their own note; an owner or admin removes any. */
export function canRemoveNote(note: Pick<Note, 'authorId'>, memberId: string | null | undefined, role: string | null | undefined): boolean {
  if (role === 'owner' || role === 'admin' || role === 'superadmin') return true
  return !!memberId && note.authorId === memberId
}

/** The display snapshot a client may send with a note: a short name and an avatar URL or data URI, nothing else. */
export function authorSnapshot(input: { authorName?: unknown; authorAvatar?: unknown }): { authorName: string; authorAvatar: string | null } {
  const name = typeof input.authorName === 'string' ? input.authorName.trim().slice(0, 120) : ''
  const avatar = typeof input.authorAvatar === 'string' && /^(https?:|data:image\/)/.test(input.authorAvatar) ? input.authorAvatar.slice(0, 200_000) : null
  return { authorName: name || 'Someone', authorAvatar: avatar }
}
