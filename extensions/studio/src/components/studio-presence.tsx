/**
 * File Name: studio-presence.tsx
 * Purpose: Who else is on this page - the compact strip in Studio's top bar
 *          (this session joins `object:<objectId>` here): one avatar per
 *          other person with what they are doing, "you, in another tab"
 *          for a forgotten tab, and the advisory claim's Take over inline.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The SAME scope, claim and strip as the object editor's
 *          EditingPresence (packages/admin/components/object-editor), so a
 *          person editing a page in the object editor and one in Studio see
 *          each other; the hooks are the kit's (`usePresence` joins while
 *          mounted and re-sends the state when it changes by value,
 *          `useEditingClaim` reads the claim and moves it), bound to the
 *          admin's per-environment client. ONE component joins, because two
 *          joins on one scope from one tab would be two sessions of the
 *          same person; every other presence view on the page reads through
 *          a selector.
 *
 *          The state carries `field`, the selected block's ADDRESS
 *          (lib/presence.ts), COALESCED: arrow-keying through the navigator
 *          changes the selection several times a second, so the selection
 *          settles for 400 ms before it is announced, and the client sends
 *          the latest inside the server's window. Nothing per keystroke; no
 *          cursors, no selections, no live text.
 *
 *          Advisory only: nothing here blocks a save. The stale-write guard,
 *          the changed-elsewhere notice and the Style panel's change notice
 *          remain the integrity and the explanation. Presence never reaches
 *          the activity log. Copy uses no em dashes.
 */
import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Button, usePresence, useEditingClaim } from '@/kit'
import {
  initialsOf, memberNames, othersHere, ownOtherTabs, presenceSummary, sessionDoing, studioPresenceState,
} from '../lib/presence'

/** How long a selection must hold before it is announced. */
const SELECTION_SETTLE_MS = 400

/** The value once it has stopped changing for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

interface PresenceProps {
  objectId: string
  /** The page's content type: the server mirrors the session on `objects:<type>` for the lists. */
  typeSlug: string | null
  /** Off while the page is loading and when there is no object yet. */
  enabled: boolean
  currentMemberId: string | null
  canEdit: boolean
  selectedKey: string | null
  /** The selected block's address, or the open surface's root (`presenceFieldFor`). */
  field: string | undefined
  /** Unsaved work on the page or a surface: editing even with nothing selected. */
  dirty: boolean
  breakpoint: string
  /** The navigator's label for a block key, so "editing Hero heading" can be said. */
  labelFor: (blockKey: string) => string | null
  /** The label of a bare field or a surface root, so the object editor's "editing sections" reads as "editing Sections". */
  fieldLabel?: (field: string) => string | null
  /** Member id -> name, for the Style panel's change notice to name its actor. */
  onNames?: (names: Map<string, string>) => void
}

/** The strip in the top bar. This is where the session joins `object:<id>`. */
export function StudioPresence({ objectId, typeSlug, enabled, currentMemberId, canEdit, selectedKey, field, dirty, breakpoint, labelFor, fieldLabel, onNames,
}: PresenceProps) {
  const scope = `object:${objectId}`
  // Settled together: a selection and its address move as one.
  const settled = useSettled(useMemo(() => ({ selectedKey, field }), [selectedKey, field]), SELECTION_SETTLE_MS)
  const state = useMemo(
    () => studioPresenceState({ selectedKey: settled.selectedKey, field: settled.field, breakpoint, canEdit, typeSlug, dirty }),
    [settled, breakpoint, canEdit, typeSlug, dirty],
  )
  const snapshot = usePresence(scope, { state, enabled: enabled && !!objectId })
  const { mine, holder, takeOver } = useEditingClaim(scope)
  const others = useMemo(() => othersHere(snapshot, currentMemberId), [snapshot, currentMemberId])

  // The names of everyone on the page, handed up so a change notice can say
  // WHO changed a class rather than "someone". The store hands out a new
  // snapshot object only on a change, so an unchanged scope hands up nothing.
  useEffect(() => { onNames?.(memberNames(snapshot)) }, [snapshot, onNames])

  const someoneElseHolds = !!holder && !mine && holder.session !== snapshot.self && holder.memberId !== currentMemberId
  const myOtherTabs = ownOtherTabs(snapshot, currentMemberId)
  if (others.length === 0 && !someoneElseHolds && myOtherTabs === 0) return null

  const words = presenceSummary(others, labelFor, fieldLabel)
  return (
    <div className="flex min-w-0 items-center gap-1.5 shrink-0" role="status" aria-label="Also here" data-testid="studio-presence">
      {others.length > 0 && (
        <div className="flex -space-x-1.5">
          {others.slice(0, 6).map((s) => (
            <span
              key={s.id}
              title={`${s.name} is ${sessionDoing(s, labelFor, fieldLabel)}`}
              aria-label={`${s.name} is ${sessionDoing(s, labelFor, fieldLabel)}`}
              className={clsx(
                'flex size-6 items-center justify-center overflow-hidden rounded-full border-2 border-surface bg-surface-sunken text-[9px] font-medium text-fg ring-1',
                s.state === 'editing' ? 'ring-amber-400' : 'ring-border',
              )}
            >
              {s.avatar ? <img src={s.avatar} alt="" className="size-full object-cover" /> : initialsOf(s.name)}
            </span>
          ))}
        </div>
      )}
      {words && <span className="text-[11px] text-fg-muted truncate max-w-48" title={words}>{words}</span>}
      {myOtherTabs > 0 && (
        <span className="text-[11px] text-fg-subtle shrink-0" data-testid="studio-presence-own-tabs" title="You have this open in another tab">
          {others.length > 0 ? '· ' : ''}you, in {myOtherTabs === 1 ? 'another tab' : `${myOtherTabs} other tabs`}
        </span>
      )}
      {someoneElseHolds && holder && (
        <Button
          size="xs"
          variant="secondary"
          onClick={takeOver}
          title={`${holder.name} is editing. Edits from two people end with the last save winning; taking over signals that you are editing now, and ${holder.name} is told.`}
        >
          Take over
        </Button>
      )}
    </div>
  )
}
