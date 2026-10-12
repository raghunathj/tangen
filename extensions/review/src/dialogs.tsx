/**
 * File Name: dialogs.tsx
 * Purpose: The Review actions' shared UI: the advance/approve confirm dialog
 *          (optional note, Enter confirms), the reject dialog (note
 *          REQUIRED), the assign dialog and the searchable MemberPickList
 *          it wraps (also embedded inline by the Review modal), the
 *          members-directory hook, and the initials avatar chip - used by
 *          the editor panel and the queue's Review modal so the surfaces
 *          behave identically.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The member list comes from the core admin endpoint
 *          GET /members (no extension passthrough). That endpoint is gated
 *          on manage:members/manage:roles - reviewers without it get a
 *          reduced picker (Assign to me / Unassign) instead of the
 *          directory, and assignee ids render as ids. No em dashes in UI
 *          copy.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  adminFetch, Button, Label, cx,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/kit'
import { IconCheck, IconSearch } from '@tangen/icons'
import { useAuthStore } from '@/kit'
import { initials, type MemberOption } from './queue-model'

/**
 * The workspace member directory, or null when the caller may not list
 * members (the picker degrades). undefined while loading.
 */
export function useMembers(
  capability?: string,
  /**
   * R4 - when a stage names roles, only those roles can act on it, so the
   * assignee picker offers them rather than every capability holder. Pass
   * null/undefined for an unrestricted stage and the capability decides, as
   * it always did.
   */
  roles?: string[] | null,
): MemberOption[] | null | undefined {
  const [members, setMembers] = useState<MemberOption[] | null | undefined>(undefined)
  const roleKey = roles && roles.length > 0 ? roles.join(',') : ''
  useEffect(() => {
    let alive = true
    const params = new URLSearchParams()
    // A role-restricted stage admits its roles WITHOUT review:approve, so
    // filtering by both would offer nobody. Roles win where they are set.
    if (roleKey) params.set('roles', roleKey)
    else if (capability) params.set('capability', capability)
    const qs = params.toString() ? `?${params.toString()}` : ''
    adminFetch<{ data: MemberOption[] }>(`/members/directory${qs}`)
      .then((r) => { if (alive) setMembers(r.data) })
      .catch(() => { if (alive) setMembers(null) })
    return () => { alive = false }
  }, [capability, roleKey])
  return members
}

/** Members eligible to act on reviews - the only sensible assignees. */
export const ASSIGNABLE_CAPABILITY = 'review:approve'

/** The signed-in member's id (for Assign to me / self-assignment). */
export function useSelfId(): string | null {
  const member = useAuthStore((s) => s.member)
  return member?.memberId ?? null
}

/** Deterministic tint pairs for the initials avatar (indexed by id hash). */
const AVATAR_TINTS = [
  'bg-accent-muted text-accent-fg',
  'bg-teal-100 text-teal-700',
  'bg-warning-muted text-warning-fg',
  'bg-pink-100 text-pink-700',
  'bg-violet-100 text-violet-700',
  'bg-info-muted text-info-fg',
] as const

function tintFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_TINTS[Math.abs(h) % AVATAR_TINTS.length]
}

/** A small initials chip - the queue's assignee/actor avatar. */
export function InitialsAvatar({ name, seed, className }: { name: string; seed?: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex size-6 shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold',
        tintFor(seed ?? name), className,
      )}
    >
      {initials(name)}
    </span>
  )
}

/** Shared textarea styling for the note fields. */
const NOTE_CLASS = 'mt-1 w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-sm text-fg placeholder:text-fg-subtle focus-visible:border-focus-border outline-none resize-none'

/**
 * Shown when the caller only gets past a restricted stage because they are
 * the owner. The override has always been recorded in the history; this is
 * what stops it being ACCIDENTAL - an escape hatch you can walk through
 * without noticing is not an escape hatch, it is a hole.
 */
export function OverrideNotice({ stageName, roles }: { stageName?: string; roles?: string[] }) {
  return (
    <div className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2">
      <p className="text-xs font-medium text-warning-fg">
        {stageName ? `"${stageName}" is restricted` : 'This stage is restricted'}
        {roles && roles.length > 0 ? ` to ${roles.join(' or ')}` : ''}, and your role is not one of them.
      </p>
      <p className="mt-0.5 text-xs text-warning-fg">
        You can act because you own this workspace. It will be recorded as an owner override, not as
        an ordinary sign-off.
      </p>
    </div>
  )
}

interface AdvanceDialogProps {
  title?: string
  /** The button/action label ("Approve" or "Advance to <stage>"). */
  actionLabel: string
  /** True when this hop enters the terminal stage. */
  terminal: boolean
  onClose: () => void
  /** Called with the trimmed note, or undefined when left empty. */
  onConfirm: (note?: string) => Promise<void> | void
  /** The caller only gets in as the owner - make them mean it. */
  override?: boolean
  stageName?: string
  stageRoles?: string[]
}

/**
 * The advance/approve confirmation - a fast click-through: the note is
 * OPTIONAL, Enter confirms immediately (Shift+Enter for a newline).
 */
export function AdvanceDialog({ title, actionLabel, terminal, onClose, onConfirm, override, stageName, stageRoles }: AdvanceDialogProps) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try { await onConfirm(note.trim() || undefined) } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {terminal ? 'Approve' : actionLabel}{title ? ` "${title}"` : ''}
          </DialogTitle>
          <DialogDescription>
            {terminal
              ? 'The item enters the final stage and becomes publishable while unchanged.'
              : 'The item moves to the next stage of the review workflow.'}
          </DialogDescription>
        </DialogHeader>
        {override && <div className="px-6 pt-4"><OverrideNotice stageName={stageName} roles={stageRoles} /></div>}
        <div className="px-6 py-4 space-y-2">
          <Label htmlFor="review-advance-note">Note (optional)</Label>
          <textarea
            id="review-advance-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void confirm() }
            }}
            rows={2}
            autoFocus
            maxLength={500}
            placeholder="Add context for the next reviewer - Enter confirms"
            className={NOTE_CLASS}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? 'Working…' : override ? `Override and ${actionLabel.toLowerCase()}` : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface RejectDialogProps {
  title?: string
  onClose: () => void
  /** Called with the trimmed, non-empty note. */
  onConfirm: (note: string) => Promise<void> | void
  /** The caller only gets in as the owner - make them mean it. */
  override?: boolean
  stageName?: string
  stageRoles?: string[]
}

export function RejectDialog({ title, onClose, onConfirm, override, stageName, stageRoles }: RejectDialogProps) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const trimmed = note.trim()

  const confirm = async () => {
    if (!trimmed) return
    setBusy(true)
    try { await onConfirm(trimmed) } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject{title ? ` "${title}"` : ' this item'}</DialogTitle>
          <DialogDescription>
            The item leaves the review workflow and goes back to the author with your note.
          </DialogDescription>
        </DialogHeader>
        {override && <div className="px-6 pt-4"><OverrideNotice stageName={stageName} roles={stageRoles} /></div>}
        <div className="px-6 py-4 space-y-2">
          <Label htmlFor="review-reject-note">Note for the author (required)</Label>
          <textarea
            id="review-reject-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoFocus
            maxLength={500}
            placeholder="What needs to change before resubmitting?"
            className={NOTE_CLASS}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={confirm} disabled={busy || !trimmed}>
            {busy ? 'Rejecting…' : override ? 'Override and reject' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface AssignDialogProps {
  title?: string
  members: MemberOption[] | null | undefined
  current: string | null
  onClose: () => void
  onConfirm: (assigneeId: string | null) => Promise<void> | void
}

const UNASSIGN = '__none__'

interface MemberPickListProps {
  members: MemberOption[] | null | undefined
  current: string | null
  onPick: (assigneeId: string | null) => Promise<void> | void
  autoFocus?: boolean
}

/**
 * The searchable assignee list - the body shared by AssignDialog and the
 * Review modal's inline assign step. Type to filter by name or email,
 * ArrowUp/ArrowDown to move, Enter picks the highlighted member immediately
 * (clicking a row does the same).
 */
export function MemberPickList({ members, current, onPick, autoFocus = true }: MemberPickListProps) {
  const selfId = useSelfId()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [busy, setBusy] = useState(false)

  // Without directory access the picker still offers the useful moves.
  const directory: MemberOption[] = members ?? [
    ...(selfId ? [{ id: selfId, name: 'Me' }] : []),
    ...(current && current !== selfId ? [{ id: current, name: current }] : []),
  ]

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => directory.filter((m) =>
      !q || (m.name ?? '').toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, members, selfId, current],
  )

  // Rows: "Unassigned" first (when someone is assigned), then the matches.
  const rows: Array<{ id: string; label: string; sub?: string }> = [
    ...(current ? [{ id: UNASSIGN, label: 'Unassigned', sub: 'Clear the assignee' }] : []),
    ...filtered.map((m) => ({ id: m.id, label: m.name || m.email || m.id, sub: m.name ? (m.email ?? undefined) : undefined })),
  ]
  const clamped = Math.min(highlight, Math.max(rows.length - 1, 0))

  const pick = async (id: string) => {
    if (busy) return
    setBusy(true)
    try { await onPick(id === UNASSIGN ? null : id) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setHighlight(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, rows.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
            if (e.key === 'Enter' && rows[clamped]) { e.preventDefault(); void pick(rows[clamped].id) }
          }}
          autoFocus={autoFocus}
          placeholder="Search members by name or email…"
          aria-label="Search members"
          className="h-9 w-full rounded-md border border-border-strong bg-surface pl-8 pr-3 text-sm text-fg placeholder:text-fg-subtle outline-none focus-visible:border-focus-border"
        />
      </div>
      <div role="listbox" aria-label="Members" className="max-h-64 overflow-y-auto rounded-md border border-border">
        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-fg-subtle">No members match "{query}"</p>
        )}
        {rows.map((r, i) => {
          const isCurrent = r.id === current
          return (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={isCurrent}
              disabled={busy}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => void pick(r.id)}
              className={cx(
                'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                i === clamped ? 'bg-surface-sunken' : 'bg-surface',
                i > 0 && 'border-t border-border',
              )}
            >
              {r.id === UNASSIGN
                ? <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-[10px] text-fg-subtle">-</span>
                : <InitialsAvatar name={r.label} seed={r.id} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-fg">{r.label}{r.id === selfId ? ' (you)' : ''}</span>
                {r.sub && <span className="block truncate text-xs text-fg-subtle">{r.sub}</span>}
              </span>
              {isCurrent && <IconCheck className="size-4 shrink-0 text-accent-fg" />}
            </button>
          )
        })}
      </div>
      {members === null && (
        <p className="mt-1 text-xs text-fg-subtle">
          Listing all members needs the manage members permission - you can still assign yourself or clear the assignee.
        </p>
      )}
    </div>
  )
}

/** The assignee picker dialog - MemberPickList in a Dialog shell. */
export function AssignDialog({ title, members, current, onClose, onConfirm }: AssignDialogProps) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign{title ? ` "${title}"` : ''}</DialogTitle>
          <DialogDescription>Who should act on this item next?</DialogDescription>
        </DialogHeader>
        <div className="px-6 py-4">
          <MemberPickList members={members} current={current} onPick={onConfirm} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
