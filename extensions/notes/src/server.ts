/**
 * File Name: server.ts (notes)
 * Purpose: The notes extension's routes: list an entry's notes, add one,
 *          remove one. Every write publishes on the `notes` channel so an
 *          open panel elsewhere refetches. Notes live in the extension's
 *          store under `note:<objectId>:<id>` - one row per note, never the
 *          object's own key, so they are neither panel data nor part of a
 *          revision.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { defineExtensionServer } from '@tangen/cms'
import { authorSnapshot, canRemoveNote, newNoteId, noteKey, notePrefix, noteTextIssue, sortNotes, type Note } from './notes'

export const NOTES_CHANNEL = 'notes'

const objectIdOf = (q: Record<string, string>, body?: unknown): string | null => {
  const fromBody = body && typeof body === 'object' ? (body as { objectId?: unknown }).objectId : undefined
  const id = typeof fromBody === 'string' ? fromBody : q.objectId
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null
}

export default defineExtensionServer({
  adminRoutes: [
    {
      method: 'GET',
      path: 'notes',
      capability: 'notes:read',
      handler: async (req, ctx) => {
        const objectId = objectIdOf(req.query)
        if (!objectId) return { error: { message: 'objectId is required' } }
        const rows = await ctx.store.list(notePrefix(objectId), { limit: 200 })
        return { data: sortNotes(rows.map((r) => r.data as unknown as Note)) }
      },
    },
    {
      method: 'POST',
      path: 'notes',
      capability: 'notes:write',
      handler: async (req, ctx) => {
        const body = (req.body ?? {}) as Record<string, unknown>
        const objectId = objectIdOf(req.query, body)
        if (!objectId) return { error: { message: 'objectId is required' } }
        const issue = noteTextIssue(body.text)
        if (issue) return { error: { message: issue } }
        const note: Note = {
          id: newNoteId(),
          objectId,
          text: String(body.text).trim(),
          authorId: req.memberId ?? null,
          ...authorSnapshot(body),
          createdAt: new Date().toISOString(),
        }
        await ctx.store.put(noteKey(objectId, note.id), note as unknown as Record<string, unknown>)
        await ctx.realtime?.publish({ channel: NOTES_CHANNEL, type: 'note.added', data: { objectId, noteId: note.id, by: note.authorId } })
        return { data: note }
      },
    },
    {
      method: 'DELETE',
      path: 'notes/:id',
      capability: 'notes:write',
      handler: async (req, ctx) => {
        const objectId = objectIdOf(req.query)
        if (!objectId) return { error: { message: 'objectId is required' } }
        const key = noteKey(objectId, req.params.id ?? '')
        const existing = (await ctx.store.get(key)) as unknown as Note | undefined
        if (!existing) return { error: { message: 'No such note' } }
        if (!canRemoveNote(existing, req.memberId, req.memberRole)) return { error: { message: 'Only the author, an owner or an admin removes a note' } }
        await ctx.store.remove(key)
        await ctx.realtime?.publish({ channel: NOTES_CHANNEL, type: 'note.removed', data: { objectId, noteId: existing.id, by: req.memberId ?? null } })
        return { data: { removed: existing.id } }
      },
    },
  ],
})
