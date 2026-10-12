/**
 * File Name: FieldPresence.tsx
 * Purpose: The tiny avatar on a field's label when someone else is editing
 *          that field right now, with "Name is editing this field" on
 *          hover. Field-level presence, the showing half.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md sections 16-18
 *          and 22-24. Reads the `object:<id>` scope the header's
 *          EditingPresence joined (this component joins nothing) through
 *          usePresenceSelector with a selector scoped to THIS field
 *          (othersEditingField in @tangen/realtime-admin), so a label
 *          re-renders only when its own editors change - a viewer arriving
 *          or a colleague moving between other fields costs this leaf
 *          nothing. Advisory: it shows where the work is and never blocks
 *          an input; the stale-write guard and the changed-elsewhere
 *          notice remain the integrity mechanism. Own sessions are not
 *          "others". Renders null when nobody is there, so an idle form
 *          has no presence markup at all.
 */

import { usePresenceSelector } from '@/kit'
import { othersEditingField, editingFieldLabel, initialsOf } from '@tangen/realtime-admin'

interface Props {
  objectId: string
  /** The field name as presence carries it (`title` for the title). */
  field: string
  currentMemberId: string | null
}

export function FieldPresence({ objectId, field, currentMemberId }: Props) {
  const editors = usePresenceSelector(`object:${objectId}`, (s) => othersEditingField(s, field, currentMemberId), {})
  if (editors.length === 0) return null
  return (
    <span className="ml-1.5 inline-flex -space-x-1 align-middle" data-testid="field-presence" data-field-presence={field} role="status">
      {editors.map((s) => (
        <span
          key={s.id}
          title={editingFieldLabel(s)}
          aria-label={editingFieldLabel(s)}
          className="flex size-5 items-center justify-center overflow-hidden rounded-full border border-surface bg-surface-sunken text-[8px] font-medium text-fg ring-1 ring-amber-400"
        >
          {s.avatar ? <img src={s.avatar} alt="" className="size-full object-cover" /> : initialsOf(s.name)}
        </span>
      ))}
    </span>
  )
}
