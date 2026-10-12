/**
 * ChangedElsewhereNotice - the object editor's non-blocking "changed
 * elsewhere" banner (realtime R2). Subscribes to `object:<id>` for the
 * environment the editor is looking at and, when an envelope says another
 * actor (or another session of mine) changed this object, pins a bar to the
 * top of the editor with Reload - and only Reload - while the editor goes
 * read-only. Advisory only: the server's stale-write guard
 * remains the integrity mechanism. The decision itself is the pure
 * isChangedElsewhere() in @tangen/realtime-admin, tested there.
 */

import { useEffect, useState } from 'react'
import { Button, useRealtime, type RealtimeEvent } from '@/kit'
import { isChangedElsewhere, changedElsewhereLabel } from '@tangen/realtime-admin'
import { EditorBar } from './EditorBar'

interface Props {
  objectId: string
  /** Off on /new and while the object is still loading. */
  enabled: boolean
  currentMemberId: string | null
  /** Server updatedAt of the editor's copy, so an own save echoing back is not a conflict. */
  lastSavedAt: string | null
  /** Epoch ms of the save this editor last issued; its echo is never a conflict. */
  saveIssuedAt?: number | null
  /** Refetches the object; unsaved edits in the form are replaced by the server copy. */
  onReload: () => void
  /** Tells the editor the copy here is stale, so it goes read-only and stops saving until the reload (2026-09-13). */
  onStaleChange?: (stale: boolean) => void
  /**
   * Follow live (2026-09-13): the editor is locked by someone else and holds
   * no unsaved edits, so a change from them is applied in place (onReload)
   * instead of raising the stale bar - a locked viewer watches the entry
   * update as the holder saves.
   */
  follow?: boolean
  /** Called with the changed field names and the changed extension panel ids each time a change was followed. */
  onFollow?: (changedFields: string[], changedPanels: string[]) => void
}

/** The editor anchors (`data-field`) a change touched: fields by name, panels as `ext:<extensionId>`. */
export function changedAnchors(changedFields: string[], changedPanels: string[]): string[] {
  return [...changedFields.map((f) => (f === 'title' ? '__title' : f)), ...changedPanels.map((id) => `ext:${id}`)]
}

/** What an envelope means for this editor: nothing, a live update to follow, or a stale copy to reload. */
export function changedElsewhereAction(
  event: Pick<RealtimeEvent, 'type' | 'data' | 't'>,
  ctx: Parameters<typeof isChangedElsewhere>[1],
  follow: boolean,
): 'ignore' | 'follow' | 'stale' {
  if (!isChangedElsewhere(event, ctx)) return 'ignore'
  return follow ? 'follow' : 'stale'
}

export function ChangedElsewhereNotice({ objectId, enabled, currentMemberId, lastSavedAt, saveIssuedAt, onReload, onStaleChange, follow = false, onFollow }: Props) {
  const [pending, setPending] = useState<{ type: string; actorId: string | null; changedFields: string[]; changedPanels: string[] } | null>(null)

  // A different object (in-place switch) starts clean.
  useEffect(() => { setPending(null) }, [objectId])
  // The editor follows: stale means read-only and no saves until the reload.
  useEffect(() => { onStaleChange?.(!!pending) }, [pending, onStaleChange])

  useRealtime(`object:${objectId}`, (event: RealtimeEvent) => {
    const saved = lastSavedAt ? Date.parse(lastSavedAt) : null
    const action = changedElsewhereAction(event, { objectId, currentMemberId, lastSavedAt: Number.isNaN(saved) ? null : saved, saveIssuedAt: saveIssuedAt ?? null }, follow)
    if (action === 'ignore') return
    const changedFields = Array.isArray(event.data.changedFields) ? (event.data.changedFields as string[]) : []
    const changedPanels = Array.isArray(event.data.changedPanels) ? (event.data.changedPanels as string[]) : []
    if (action === 'follow') {
      onFollow?.(changedFields, changedPanels)
      onReload()
      return
    }
    setPending({
      type: event.type,
      actorId: typeof event.data.actorId === 'string' ? event.data.actorId : null,
      changedFields,
      changedPanels,
    })
  }, { enabled: enabled && !!objectId })

  if (!pending) return null
  const parts = [
    ...pending.changedFields.slice(0, 6),
    ...(pending.changedFields.length > 6 ? ['...'] : []),
    ...pending.changedPanels.map((id) => `${id} panel`),
  ]
  const fields = parts.length > 0 ? ` Changed: ${parts.join(', ')}.` : ''
  // No Dismiss (the user, 2026-09-13): a dismissed notice let the author keep
  // typing into a copy every save would refuse. Reload is the only way out;
  // the editor is read-only meanwhile, so unsaved words can still be copied.
  return (
    <EditorBar
      tone="warning"
      testId="changed-elsewhere"
      title={changedElsewhereLabel(pending.type, { ownActor: !!currentMemberId && pending.actorId === currentMemberId })}
      detail={`This copy is read-only until you reload. Unsaved edits here are replaced by the server copy; copy anything you need first.${fields}`}
      actions={<Button size="sm" variant="primary" onClick={() => { setPending(null); onReload() }}>Reload</Button>}
    />
  )
}
