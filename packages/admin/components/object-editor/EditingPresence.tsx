/**
 * EditingPresence - who else is on this object right now (realtime R3).
 * Joins `object:<id>` while the editor is mounted with `editing` when the
 * form has unsaved changes or a field has focus (then with that `field`,
 * so others see where the work is) and `viewing` otherwise, shows the other
 * members as avatars with what they are doing, and, when someone else
 * holds the advisory editing claim, a banner naming them with a take-over
 * action. Advisory only: nothing here blocks a save; the server's
 * stale-write guard (and the ChangedElsewhereNotice next to this) remain
 * the integrity mechanism. Presence is ephemeral and never written to the
 * activity log. The data comes from @tangen/realtime-admin's hooks, so a
 * viewer joining or leaving re-renders this leaf only. What a person is
 * doing names the ROOT field of a dotted address (Studio publishes a block
 * as `sections.k1.children.k2`): "editing Sections" through the page's
 * field labels, never the raw chain (`sessionDoing`, presence-views).
 */

import { useMemo, type ReactElement } from 'react'
import { Button, Popover, PopoverTrigger, PopoverContent, usePresence, useEditingClaim, type PresenceSession } from '@/kit'
import { sessionDoing } from '@tangen/realtime-admin'
import { editorPresenceState } from './field-focus'

interface Props {
  objectId: string
  /** Off on /new and while the object is still loading. */
  enabled: boolean
  currentMemberId: string | null
  /** The form has unsaved changes: this session is `editing`, otherwise `viewing`. */
  editing: boolean
  /** The field that has focus: published as `editing` on that field; cleared on blur (field-focus.ts). */
  field?: string | null
  /** The object's content type: the server mirrors this session on `objects:<type>` for the list page. */
  typeSlug?: string | null
  /** The label of a top-level field by name ("Sections" for `sections`), for the words; the name itself otherwise. */
  fieldLabel?: (root: string) => string | null | undefined
}

const initialsOf = (name: string): string =>
  name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'

export function EditingPresence({ objectId, enabled, currentMemberId, editing, field, typeSlug, fieldLabel }: Props) {
  const doing = (s: PresenceSession): string => sessionDoing(s, fieldLabel)
  const scope = `object:${objectId}`
  const snapshot = usePresence(scope, { state: editorPresenceState({ editing, field, typeSlug }), enabled: enabled && !!objectId })
  const { mine, holder, takeOver } = useEditingClaim(scope)

  // One avatar per other person: my own sessions (this tab and my other tabs) are not "others".
  const others = useMemo(() => {
    const seen = new Set<string>()
    const out: PresenceSession[] = []
    for (const s of snapshot.members) {
      if (s.id === snapshot.self) continue
      if (currentMemberId && s.memberId === currentMemberId) continue
      const key = s.memberId ?? s.apiKeyId ?? s.id
      if (seen.has(key)) continue
      seen.add(key)
      out.push(s)
    }
    // Editors first, then by arrival.
    return out.sort((a, b) => Number(b.state === 'editing') - Number(a.state === 'editing') || a.since - b.since)
  }, [snapshot, currentMemberId])

  const someoneElseHolds = !!holder && !mine && holder.session !== snapshot.self && holder.memberId !== currentMemberId
  // My own other tabs are not "others", but they are worth a line: it is how
  // one person sees presence working, and how a forgotten tab explains itself.
  const myOtherTabs = currentMemberId
    ? snapshot.members.filter((s) => s.id !== snapshot.self && s.memberId === currentMemberId).length
    : 0
  if (others.length === 0 && !someoneElseHolds && myOtherTabs === 0) return null

  // A facepile (the user, 2026-09-13): one avatar per person, editors ringed
  // in amber, my own other tabs as MY avatar with a dashed ring and a tab
  // count, an overflow bubble past four, and words only for who is editing.
  // What each person is doing lives on the avatar's title.
  const me = currentMemberId ? snapshot.members.find((s) => s.memberId === currentMemberId) ?? null : null
  const SHOWN = 4
  const shown = others.slice(0, SHOWN)
  const overflow = others.length - shown.length
  const editors = others.filter((s) => s.state === 'editing')
  const words = editors.length === 0
    ? ''
    : editors.length === 1
      ? `${editors[0]!.name} is ${doing(editors[0]!)}`
      : `${editors.map((s) => s.name).join(' and ')} are editing`
  const ownTabsTitle = myOtherTabs === 1 ? 'You, in another tab' : `You, in ${myOtherTabs} other tabs`

  const face = (s: PresenceSession) => s.avatar
    ? <img src={s.avatar} alt="" className="size-full object-cover" />
    : initialsOf(s.name)

  // A click (or focus) on an avatar names the person and what they are doing;
  // hover keeps the title. Popover, so it works on touch too.
  const withCard = (trigger: ReactElement, heading: string, line: string) => (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-56 px-3 py-2.5">
        <p className="text-ui-sm font-medium text-fg">{heading}</p>
        <p className="mt-0.5 text-ui-xs text-fg-muted">{line}</p>
      </PopoverContent>
    </Popover>
  )

  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="editing-presence" role="status" aria-label="Also here">
      <div className="flex -space-x-2">
        {shown.map((s) => withCard(
          <Button
            key={s.id}
            variant="ghost"
            size="sm"
            title={`${s.name} is ${doing(s)}`}
            aria-label={`${s.name} is ${doing(s)}`}
            className={
              'size-7 overflow-hidden rounded-full border-2 border-surface bg-surface-sunken p-0 text-[10px] font-medium text-fg ring-1 hover:bg-surface-sunken '
              + (s.state === 'editing' ? 'ring-warning' : 'ring-border')
            }
          >
            {face(s)}
          </Button>,
          s.name,
          `${s.state === 'editing' ? 'Editing' : 'Viewing'}${doing(s).replace(/^(editing|viewing)/, '')}`,
        ))}
        {overflow > 0 && (
          <span
            title={others.slice(SHOWN).map((s) => `${s.name} is ${doing(s)}`).join(', ')}
            className="flex size-7 items-center justify-center rounded-full border-2 border-surface bg-surface-inverted text-[10px] font-semibold text-fg-inverted"
          >
            +{overflow}
          </span>
        )}
        {myOtherTabs > 0 && withCard(
          <Button
            variant="ghost"
            size="sm"
            title={ownTabsTitle}
            aria-label={ownTabsTitle}
            data-testid="editing-presence-own-tabs"
            className="relative size-7 overflow-visible rounded-full border-2 border-surface bg-surface-sunken p-0 text-[10px] font-medium text-fg-muted outline-1 outline-dashed outline-offset-1 outline-border-strong hover:bg-surface-sunken"
          >
            <span className="flex size-full items-center justify-center overflow-hidden rounded-full">{me ? face(me) : 'You'}</span>
            {myOtherTabs > 1 && (
              <span className="absolute -bottom-1 -right-1 rounded-full bg-surface-inverted px-1 text-[9px] font-semibold leading-3 text-fg-inverted">{myOtherTabs}</span>
            )}
          </Button>,
          'You',
          myOtherTabs === 1 ? 'Active in another tab or device' : `Active in ${myOtherTabs} other tabs or devices`,
        )}
      </div>
      {words && <span className="truncate text-[11px] text-fg-muted">{words}</span>}
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
