/**
 * File Name: RowPresence.tsx
 * Purpose: The small avatars on an objects-list row for the people on that
 *          object right now - "Priya is editing title" on hover, at most
 *          three avatars and a "+N" - read from the per-type presence
 *          aggregate the list watches once.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md sections 9 and
 *          45 (32 subscriptions per connection: a list must not subscribe
 *          per row) and 16-18 (selector reactivity). The page calls
 *          usePresenceWatch('objects:<type>') ONCE; every row reads that
 *          one scope through usePresenceSelector with othersOnObject scoped
 *          to its own id, so a row re-renders only when ITS people change.
 *          rowPresenceModel (pure, in @tangen/realtime-admin) decides the
 *          avatars and the "+N"; this component only draws them. Own
 *          sessions are excluded. Null when nobody is there, so a quiet
 *          list carries no presence markup at all.
 */

import { usePresenceSelector } from '@/kit'
import { othersOnObject, rowPresenceModel, rowPresenceLabel, initialsOf } from '@tangen/realtime-admin'

interface Props {
  /** The content type the list shows; the aggregate scope is `objects:<typeSlug>`. */
  typeSlug: string
  objectId: string
  currentMemberId: string | null
}

export function RowPresence({ typeSlug, objectId, currentMemberId }: Props) {
  const people = usePresenceSelector(`objects:${typeSlug}`, (s) => othersOnObject(s, objectId, currentMemberId), {})
  const model = rowPresenceModel(people)
  if (model.avatars.length === 0) return null
  const names = people.map(rowPresenceLabel).join(', ')
  return (
    <span className="ml-2 inline-flex items-center -space-x-1 align-middle" data-testid="row-presence" data-row-presence={objectId} role="status" aria-label={names}>
      {model.avatars.map((s) => (
        <span
          key={s.id}
          title={rowPresenceLabel(s)}
          className={
            'flex size-5 items-center justify-center overflow-hidden rounded-full border border-surface bg-surface-sunken text-[8px] font-medium text-fg ring-1 '
            + (s.state === 'editing' ? 'ring-amber-400' : 'ring-border')
          }
        >
          {s.avatar ? <img src={s.avatar} alt="" className="size-full object-cover" /> : initialsOf(s.name)}
        </span>
      ))}
      {model.more > 0 && (
        <span title={names} className="flex h-5 min-w-5 items-center justify-center rounded-full border border-surface bg-surface-sunken px-1 text-[9px] font-medium text-fg-muted ring-1 ring-border">
          +{model.more}
        </span>
      )}
    </span>
  )
}
