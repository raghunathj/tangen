/**
 * File Name: block-presence.tsx
 * Purpose: Where the others are, block by block - the small avatar on a
 *          navigator row, the outline badge on a canvas block ("Priya is
 *          editing this block"), and the people in a shared surface's band.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The showing half of Studio's block presence; the
 *          address the other session published is read back by
 *          lib/presence.ts. Every view here reads the `object:<id>` scope
 *          the top bar's StudioPresence joined (nothing here joins) through
 *          the kit's usePresenceSelector with a selector scoped to THIS row,
 *          surface or canvas, so a row re-renders only when its own editors
 *          change (block-presence.test.ts proves it). The canvas badges own
 *          their geometry: they listen for the overlay's geometry report
 *          themselves and keep it as local state only while someone is on a
 *          block, so a quiet page pays nothing and a busy one re-renders
 *          this leaf rather than the editor. Advisory: a badge never blocks
 *          a click; the stale-write guard and the changed-elsewhere notice
 *          remain the integrity mechanism. Own sessions are not "others".
 *          Every view renders null when nobody is there.
 */
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { isStudioGeometryMessage, type StudioBlockRect } from '@tangen/studio'
import { usePresenceSelector, type PresenceSession } from '@/kit'
import { blockEditingLabel, deepestBlockKey, initialsOf, othersEditingBlock, othersInSurface, othersOnAnyBlock, sessionDoing } from '../lib/presence'
import { rectFor } from '../lib/rects'
import { toCanvasRect, type Offset } from '../lib/canvas-frame'

export interface PresenceScopeProps {
  objectId: string
  currentMemberId: string | null
}

const AVATAR = 'flex items-center justify-center overflow-hidden rounded-full border border-surface bg-surface-sunken font-medium text-fg ring-1 ring-amber-400'

function Avatar({ s, size, title }: { s: PresenceSession; size: 'sm' | 'md'; title: string }) {
  return (
    <span
      key={s.id}
      title={title}
      aria-label={title}
      className={clsx(AVATAR, size === 'sm' ? 'size-4 text-[7px]' : 'size-5 text-[8px]', s.state !== 'editing' && 'ring-border')}
    >
      {s.avatar ? <img src={s.avatar} alt="" className="size-full object-cover" /> : initialsOf(s.name)}
    </span>
  )
}

// ── The navigator row ────────────────────────────────────────────────────────

interface BlockPresenceProps extends PresenceScopeProps {
  /** The row's address (`rowAddresses`); null for a block with no key yet, which nobody can be on. */
  address: string | null
}

/** The avatar on a navigator row when someone else is editing that block or anything inside it. */
export function BlockPresence({ objectId, currentMemberId, address }: BlockPresenceProps) {
  const editors = usePresenceSelector(`object:${objectId}`, (s) => othersEditingBlock(s, address, currentMemberId), {})
  if (editors.length === 0) return null
  return (
    <span className="ml-1 inline-flex -space-x-1 shrink-0 align-middle" data-testid="block-presence" data-block-presence={address ?? ''} role="status">
      {editors.slice(0, 3).map((s) => <Avatar key={s.id} s={s} size="sm" title={blockEditingLabel(s)} />)}
    </span>
  )
}

// ── The canvas ───────────────────────────────────────────────────────────────

interface CanvasPresenceBadgesProps extends PresenceScopeProps {
  /** The preview's origin, so only its geometry reports are read. */
  frontendUrl: string | null
  frameOffset: Offset
  zoom: number
}

/** Trailing-slash-insensitive origin equality (mirrors the page's own listener). */
const sameOrigin = (a: string, b: string): boolean => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

/**
 * One badge per other person on a block the canvas shows, drawn at the
 * top-right of that block's box: name, amber ring, "is editing this block".
 * The page's overlay is not told anything; this is the admin drawing over
 * the iframe, as the selection toolbar is.
 */
export function CanvasPresenceBadges({ objectId, currentMemberId, frontendUrl, frameOffset, zoom }: CanvasPresenceBadgesProps) {
  const people = usePresenceSelector(`object:${objectId}`, (s) => othersOnAnyBlock(s, currentMemberId), {})
  const [geometry, setGeometry] = useState<Map<string, StudioBlockRect['rect']>>(() => new Map())
  const active = people.length > 0 && !!frontendUrl

  // Geometry is read only while there is someone to place: the listener is
  // installed and removed with them, so an empty page has no listener.
  useEffect(() => {
    if (!active) return
    const onMsg = (e: MessageEvent) => {
      if (!sameOrigin(e.origin, frontendUrl!)) return
      if (!isStudioGeometryMessage(e.data)) return
      const next = new Map<string, StudioBlockRect['rect']>()
      for (const b of e.data.blocks) next.set(b.key, b.rect)
      setGeometry(next)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [active, frontendUrl])

  if (!active) return null
  const badges = people.flatMap((s) => {
    const key = deepestBlockKey(s.field)
    const rect = key ? rectFor(geometry, key) : null
    return rect ? [{ s, rect: toCanvasRect(rect, frameOffset, zoom) }] : []
  })
  if (badges.length === 0) return null
  return (
    <>
      {badges.map(({ s, rect }) => (
        <span
          key={s.id}
          data-testid="canvas-presence"
          title={blockEditingLabel(s)}
          aria-label={blockEditingLabel(s)}
          style={{ top: rect.top + 2, left: rect.left + rect.width - 2 }}
          className="pointer-events-none absolute z-20 flex -translate-x-full items-center gap-1 rounded-bl rounded-tr bg-amber-400 px-1.5 py-0.5 text-[10px] font-medium text-black shadow-sm"
        >
          {s.avatar
            ? <img src={s.avatar} alt="" className="size-3.5 rounded-full object-cover" />
            : <span className="grid size-3.5 place-items-center rounded-full bg-black/15 text-[7px]">{initialsOf(s.name)}</span>}
          <span className="max-w-32 truncate">{s.name}</span>
        </span>
      ))}
    </>
  )
}

// ── The surface band ─────────────────────────────────────────────────────────

interface SurfacePresenceProps extends PresenceScopeProps {
  global: string
  /** The navigator's label for a block key, for "editing Nav links". */
  labelFor?: (blockKey: string) => string | null
}

/** Who else is in this shared header or footer, from this page: editors first, with what they are on. */
export function SurfacePresence({ objectId, currentMemberId, global, labelFor }: SurfacePresenceProps) {
  const people = usePresenceSelector(`object:${objectId}`, (s) => othersInSurface(s, global, currentMemberId), {})
  if (people.length === 0) return null
  const doing = (s: PresenceSession) => `${s.name} is ${sessionDoing(s, labelFor ?? (() => null), () => 'this surface')}`
  const first = people[0]!
  return (
    <span className="flex items-center gap-1.5 shrink-0" data-testid="surface-presence" data-surface-presence={global} role="status" aria-label={people.map(doing).join(', ')}>
      <span className="flex -space-x-1">
        {people.slice(0, 3).map((s) => <Avatar key={s.id} s={s} size="md" title={doing(s)} />)}
      </span>
      <span className="text-fg-subtle truncate max-w-40" title={people.map(doing).join(', ')}>
        {people.length === 1 ? doing(first) : `${people.length} others here`}
      </span>
    </span>
  )
}
