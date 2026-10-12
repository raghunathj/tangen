/**
 * File Name: panel.tsx (notes)
 * Purpose: The Notes sidebar panel: the entry's thread, newest first, with
 *          author avatar, name and time; a box to add one (Cmd/Ctrl+Enter
 *          sends); remove on your own notes. Refetches when a `note.added`
 *          or `note.removed` envelope for this entry arrives, so two people
 *          on the same entry see each other's notes as they land.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Built on @/kit only. The author's name and avatar
 *          travel with the note as a display snapshot; the server records
 *          the member id as the fact.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Textarea, adminFetch, useRealtime, useAuthStore, toast } from '@/kit'
import { IconTrash } from '@tangen/icons'
import type { Note } from './notes'
import { canRemoveNote, NOTE_MAX } from './notes'

const TOPIC = 'ext:notes:notes'

interface PanelProps {
  /** The object's id ('' while the editor is on /new). */
  objectId?: string
}

function when(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  const m = Math.round(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d} d ago`
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

const initialsOf = (name: string): string =>
  name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'

export function NotesPanel({ objectId }: PanelProps) {
  const me = useAuthStore((s) => s.member)
  const [notes, setNotes] = useState<Note[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!objectId) return
    try {
      const r = await adminFetch<{ data: Note[] }>(`/admin/ext/notes/notes?objectId=${encodeURIComponent(objectId)}`)
      setNotes(r.data ?? [])
    } catch { /* the panel stays as it was; a failed read is not worth a toast */ }
  }, [objectId])

  useEffect(() => { void load() }, [load])
  useRealtime<{ objectId?: string }>(TOPIC, (event) => { if (event.data?.objectId === objectId) void load() }, { enabled: !!objectId })

  async function add() {
    if (!objectId || text.trim() === '' || busy) return
    setBusy(true)
    try {
      await adminFetch(`/admin/ext/notes/notes`, {
        method: 'POST',
        body: JSON.stringify({ objectId, text, authorName: me?.name ?? me?.email ?? '', authorAvatar: me?.avatar ?? null }),
      })
      setText('')
      await load()
    } catch (e) {
      toast.error('Could not add the note', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(note: Note) {
    try {
      await adminFetch(`/admin/ext/notes/notes/${encodeURIComponent(note.id)}?objectId=${encodeURIComponent(objectId!)}`, { method: 'DELETE' })
      setNotes((prev) => prev.filter((n) => n.id !== note.id))
    } catch (e) {
      toast.error('Could not remove the note', (e as Error).message)
    }
  }

  if (!objectId) return <p className="text-ui-xs text-fg-subtle">Save the entry once, then leave notes on it.</p>

  return (
    <div className="space-y-3" data-testid="notes-panel">
      <div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void add() } }}
          rows={2}
          maxLength={NOTE_MAX}
          placeholder="Leave a note for the team"
          aria-label="New note"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-ui-2xs text-fg-faint">Internal: never shown on the site.</span>
          <Button size="xs" variant="secondary" onClick={() => void add()} isLoading={busy} disabled={text.trim() === ''}>Add note</Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <p className="text-ui-xs text-fg-subtle">No notes yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {notes.map((n) => (
            <li key={n.id} className="group flex gap-2.5" data-testid="note">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-sunken text-[9px] font-medium text-fg ring-1 ring-border" aria-hidden>
                {n.authorAvatar ? <img src={n.authorAvatar} alt="" className="size-full object-cover" /> : initialsOf(n.authorName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-1.5 text-ui-xs">
                  <span className="truncate font-medium text-fg">{n.authorName}</span>
                  <span className="shrink-0 text-fg-subtle" title={new Date(n.createdAt).toLocaleString()}>{when(n.createdAt)}</span>
                </p>
                <p className="whitespace-pre-wrap break-words text-ui-sm text-fg">{n.text}</p>
              </div>
              {canRemoveNote(n, me?.memberId, me?.role) && (
                <Button variant="ghost" size="xs" icon={<IconTrash />} aria-label="Remove note" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void remove(n)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
