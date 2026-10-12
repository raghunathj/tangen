/**
 * File Name: realtime.ts
 * Purpose: The admin's realtime binding - @tangen/realtime-admin wired to
 *          the admin's authenticated fetch, exposed as useRealtime.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R1 of tasks/plan-realtime.md. The only admin-specific
 *          knowledge here is how a ticket is minted: POST /realtime/ticket
 *          through adminFetch, which carries the session token, the
 *          workspace header the ticket is scoped to. The
 *          base URL is the page's own origin because the admin talks to the
 *          API through a relative /api/v1 (Vite proxies it in development).
 *
 *          In development the Vite proxy does not forward WebSocket
 *          upgrades on /api unless `ws: true` is set on it; until then the
 *          client notices the upgrade never opens and falls back to SSE on
 *          its own, which the proxy streams fine. R4 made that fallback
 *          symmetric: an EventSource cannot send, so presence goes over POST
 *          /realtime/presence through the same adminFetch, addressed by the
 *          connection id. Before it, a tab on SSE saw the other editors and
 *          none of them saw it.
 */
import { apiOrigin } from './api-origin'
import { createAdminRealtime } from '@tangen/realtime-admin'
import { adminFetch } from '@/lib/api'

export const adminRealtime = createAdminRealtime({
  apiUrl: typeof window !== 'undefined' ? (apiOrigin() || window.location.origin) : '',
  mintTicket: async () => {
    const res = await adminFetch<{ data: { ticket: string } }>('/realtime/ticket', { method: 'POST' })
    return res.data.ticket
  },
  postPresence: (body) => adminFetch('/realtime/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
})

/** Subscribe a component to a topic of this deployment. */
export const useRealtime = adminRealtime.useRealtime
/** The connection status ('idle' until something subscribes). */
export const useRealtimeStatus = adminRealtime.useRealtimeStatus
/** R3: join a scope while mounted (`object:<id>`, `page:<id>`, `flow:<id>`) with what this session is doing. */
export const usePresence = adminRealtime.usePresence
/** R3: re-render only when the selected slice of a scope's presence changes. */
export const usePresenceSelector = adminRealtime.usePresenceSelector
/** Observe a scope while mounted without joining it: the per-type aggregate `objects:<type>`, once per list. */
export const usePresenceWatch = adminRealtime.usePresenceWatch
/** R3: the advisory editing claim on a scope, and the take-over action. */
export const useEditingClaim = adminRealtime.useEditingClaim
export type {
  RealtimeEvent, RealtimeHandler, RealtimeStatus, UseRealtimeOptions,
  PresenceState, PresenceSession, PresenceClaim, PresenceScopeSnapshot, EditingClaim,
} from '@tangen/realtime-admin'
export { isChangedElsewhere, changedElsewhereLabel } from '@tangen/realtime-admin'
/** The pure presence selectors a field label, an editor strip and a list row are built from (presence-views). */
export {
  othersEditingField, editingFieldLabel, initialsOf, othersOnObject, rowPresenceModel, rowPresenceLabel, type RowPresenceModel,
  fieldAtOrUnder, fieldRootOf, sessionDoing,
} from '@tangen/realtime-admin'
