'use client'
/**
 * File Name: LivePosts.tsx
 * Purpose: A client component that subscribes to `objects:post` and asks
 *          Next to refetch the server-rendered list when a post changes,
 *          with a small badge that says whether the page is live.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Realtime R4 (docs/realtime.md "For a site"). Realtime
 *          signals, it does not replicate: the event carries the object's
 *          id and what changed, and the page refetches canonical state
 *          through the same REST path it rendered from (router.refresh()
 *          re-runs the server components). One client per tab, created at
 *          module level and handed down through RealtimeProvider; it opens
 *          no connection until this component mounts and subscribes, and
 *          idle-closes after the last subscriber leaves. Tickets come from
 *          this site's own /api/realtime-ticket, so the API key stays on
 *          the server. No em dashes in the copy.
 */
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { createRealtimeClient } from '@tangen/realtime'
import { RealtimeProvider, useRealtimeEvent, useRealtimeStatus } from '@tangen/realtime-react'

const API_URL = process.env.NEXT_PUBLIC_TANGEN_API_URL ?? 'http://localhost:3000'

const realtime = createRealtimeClient({
  apiUrl: API_URL,
  mintTicket: async () => {
    const res = await fetch('/api/realtime-ticket', { method: 'POST' })
    if (!res.ok) throw new Error(`ticket mint failed (${res.status})`)
    return ((await res.json()) as { ticket: string }).ticket
  },
})

function LiveBadge({ lastEvent }: { lastEvent: string | null }) {
  const status = useRealtimeStatus()
  const live = status === 'open'
  return (
    <p className="live-badge" aria-live="polite" style={{ fontSize: 13, color: live ? '#047857' : '#6b7280' }}>
      {live ? 'Live: this list updates when a post is published' : `Realtime ${status}`}
      {lastEvent ? ` (last change: ${lastEvent})` : ''}
    </p>
  )
}

function Subscriber({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  useRealtimeEvent('objects:post', (event) => {
    // Published, unpublished, deleted: the list may have changed, so refetch it.
    setLastEvent(`${event.type} ${String(event.data.objectId ?? '')}`.trim())
    router.refresh()
  }, { onResync: () => router.refresh() })
  return (
    <>
      <LiveBadge lastEvent={lastEvent} />
      {children}
    </>
  )
}

/** Wraps a server-rendered list so it refetches when a post changes. */
export function LivePosts({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider client={realtime}>
      <Subscriber>{children}</Subscriber>
    </RealtimeProvider>
  )
}
