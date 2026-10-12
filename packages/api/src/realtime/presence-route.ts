/**
 * File Name: presence-route.ts
 * Purpose: POST /api/v1/realtime/presence - the HTTP way to publish presence,
 *          so a client on the SSE fallback announces itself instead of only
 *          watching, and the cross-process delivery that makes it work when
 *          the connection belongs to another process.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: the R4 change request in tasks/plan-parallel-tracks.md
 *          section 6, against the locked architecture's sections 6, 15,
 *          19-24 and 30-34. An EventSource cannot send, so before this route
 *          a tab on the SSE fallback (the admin behind a dev proxy that does
 *          not forward upgrades, a corporate middlebox, a runtime with no
 *          WebSocket) could see everyone on an object and was itself
 *          invisible: two people editing, one of them on SSE, and only one
 *          appeared. That is a bug from the user's side, not a limitation
 *          worth documenting, so presence gets one small HTTP verb.
 *
 *          WHAT IT IS NOT. Not a second protocol: the body is exactly the
 *          `presence` client message minus its `op`, parsed by the SAME
 *          parseClientMessage the socket frames go through, and handed to
 *          the SAME hub.handlePresence. Not a second answer path either -
 *          the snapshot, the refusal and every envelope come back down the
 *          connection's own stream, as they do for a socket. The response
 *          body says only whether the command was delivered.
 *
 *          WHAT MAKES IT AS TRUSTWORTHY AS A SOCKET CLAIM, AND NO MORE. The
 *          op runs under the CONNECTION's identity - the one the single-use
 *          ticket carried, with the permissions the hub loaded - so the
 *          canReadType gate on the scope, the type gate on `typeSlug`, the
 *          topic-segment shape of `typeSlug` and the Gateway's presence
 *          budget all apply unchanged. The caller only has to prove it IS
 *          that identity: the route runs under the normal Bearer derive and
 *          mayDrivePresence() compares. A connection id is not a secret (it
 *          is the session id every other member of a scope can read in the
 *          member list), so it is an address here, never a credential.
 *
 *          A site-auth connection (`site-key`: the key's grants, a site
 *          member's name) is refused: the derive that proves a site member
 *          is mounted for /api/v1/auth/* only, so a caller on this route
 *          cannot prove it is that person, and holding the API key must not
 *          be enough to speak as one of the site's users.
 *
 *          FINDING A CONNECTION IN ANOTHER PROCESS. Presence sessions are
 *          held by the process that owns the socket, and an HTTP request
 *          behind a load balancer lands anywhere. Rather than a directory of
 *          connections or a second transport, the request rides the fan-out
 *          that already exists (fanout.ts): the same ONE physical channel
 *          per process carries an addressed command, every process hears it,
 *          and only the owner acts. Nothing is added per connection, per
 *          object or per process - which is the architecture's section 10
 *          rule, and the reason the change request called this a fan-out
 *          question. A local fan-out (one process) has nowhere to forward
 *          to, and there an unknown connection is knowably unknown: 404.
 *          With Redis or Postgres it is 202 - accepted, delivered if it is
 *          anywhere - because no process can answer for the others.
 */
import type { Elysia } from 'elysia'
import { RequestError } from '../lib/errors'
import { parseClientMessage, type ClientMessage } from './protocol'
import type { RealtimeHub } from './hub'
import type { RealtimeIdentity } from './authorize'
import type { Fanout, RealtimeCommand, RealtimeCommandCaller } from './fanout'

/** The most a connection id may be, before it is even looked up. */
const CONNECTION_ID_MAX = 128

export type PresenceCaller = RealtimeCommandCaller

/**
 * May this caller speak for that connection? Same workspace, same
 * environment, same person or same key - and never for a site-auth
 * connection, whose member the caller cannot prove.
 * @param caller - What the request authenticated as.
 * @param identity - The connection's ticket-derived identity.
 */
export function mayDrivePresence(caller: PresenceCaller, identity: RealtimeIdentity): boolean {
  if (caller.workspaceId !== identity.workspaceId) return false
  if (identity.siteUserId) return false
  if (identity.memberId) return caller.memberId === identity.memberId
  if (identity.apiKeyId) return !caller.memberId && caller.apiKeyId === identity.apiKeyId
  return false
}

/**
 * The presence message inside a request body or a forwarded command, parsed
 * by the one protocol parser. `connectionId` is the address and is not part
 * of the message.
 */
export function parsePresenceRequest(body: unknown): { ok: true; message: Extract<ClientMessage, { op: 'presence' }> } | { ok: false; reason: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: 'malformed' }
  const { connectionId: _address, op: _op, ...rest } = body as Record<string, unknown>
  const parsed = parseClientMessage({ op: 'presence', ...rest })
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  if (parsed.message.op !== 'presence') return { ok: false, reason: 'malformed' }
  return { ok: true, message: parsed.message }
}

/** The connection id a body addresses, or null when it names none usable. */
export function addressOf(body: unknown): string | null {
  const id = (body as { connectionId?: unknown } | null | undefined)?.connectionId
  return typeof id === 'string' && id.length > 0 && id.length <= CONNECTION_ID_MAX ? id : null
}

/**
 * Applies a command that arrived over the infrastructure bus, if this process
 * owns the connection it names. Every other process drops it.
 * @param hub - This process's hub, or null when it runs none.
 * @param command - The addressed command as it came off the bus.
 * @returns What happened, for the caller's logs and the tests.
 */
export async function applyPresenceCommand(hub: RealtimeHub | null, command: RealtimeCommand): Promise<'applied' | 'not_here' | 'forbidden' | 'malformed'> {
  if (!hub || command.op !== 'presence') return 'not_here'
  const conn = hub.connections.get(command.to)
  if (!conn) return 'not_here'
  if (!mayDrivePresence(command.caller, conn.identity)) return 'forbidden'
  // Re-validated here, not trusted from the wire: the owner refuses a
  // malformed command exactly as it refuses a malformed frame.
  const parsed = parsePresenceRequest(command.payload)
  if (!parsed.ok) return 'malformed'
  await hub.handlePresence(conn, parsed.message)
  return 'applied'
}

/** The fan-out's `local.command` hook for this process. */
export function presenceCommandHandler(hub: () => RealtimeHub | null): (command: RealtimeCommand) => void {
  return (command) => { void applyPresenceCommand(hub(), command).catch(() => { /* advisory: the client heartbeats again */ }) }
}

/** The caller the Bearer derive proved, or the error that says what is missing. */
export function presenceCallerFromContext(ctx: {
  workspaceId?: string | null
  memberId?: string | null
  apiKeyId?: string | null
}): PresenceCaller {
  if (!ctx.workspaceId) throw new RequestError('REALTIME_NO_WORKSPACE', 'realtime presence needs a workspace', 400)
  const memberId = ctx.memberId ?? null
  const apiKeyId = ctx.apiKeyId ?? null
  if (!memberId && !apiKeyId) throw new RequestError('UNAUTHORIZED', 'realtime presence needs an authenticated caller', 401)
  return { workspaceId: ctx.workspaceId, memberId, apiKeyId: memberId ? null : apiKeyId }
}

export interface PresenceRouteOptions {
  /** This process's hub (transport.ts getRealtimeHub). */
  hub: () => RealtimeHub | null
  /** This process's fan-out (transport.ts getRealtimeFanout). */
  fanout: () => Fanout | null
}

/**
 * POST /api/v1/realtime/presence - mounted AFTER authMiddleware, like the
 * ticket route, so `ctx` is the derive's verdict on who is asking. Answers
 * `{ data: { delivered, transport? } }` on 200 when the connection is here,
 * `{ data: { delivered: false, forwarded: true } }` on 202 when it was
 * handed to the other processes.
 */
export const realtimePresenceRoute = (opts: PresenceRouteOptions) => (app: Elysia) =>
  app.post('/api/v1/realtime/presence', async (ctx: any) => {
    const caller = presenceCallerFromContext(ctx)
    const body = ctx.body
    const to = addressOf(body)
    if (!to) throw new RequestError('REALTIME_NO_CONNECTION', 'realtime presence needs the connectionId the server sent in `ready`', 400)
    const parsed = parsePresenceRequest(body)
    if (!parsed.ok) {
      throw new RequestError('REALTIME_PRESENCE_MALFORMED', `realtime presence refused this message: ${parsed.reason}`, 400)
    }

    const hub = opts.hub()
    const conn = hub?.connections.get(to)
    if (hub && conn) {
      if (!mayDrivePresence(caller, conn.identity)) {
        throw new RequestError('FORBIDDEN', 'this connection belongs to another identity', 403)
      }
      // Everything the client hears comes back on its own stream, as it does
      // on a socket: the snapshot, a refusal, and the envelopes.
      await hub.handlePresence(conn, parsed.message)
      return { data: { delivered: true, transport: conn.transport } }
    }

    const fanout = opts.fanout()
    if (!fanout || fanout.kind === 'local') {
      throw new RequestError('REALTIME_UNKNOWN_CONNECTION', 'no realtime connection with that id - reconnect and use the connectionId from `ready`', 404)
    }
    const command: RealtimeCommand = { op: 'presence', to, caller, payload: parsed.message as unknown as Record<string, unknown> }
    fanout.forwardCommand(command)
    ctx.set.status = 202
    return { data: { delivered: false, forwarded: true } }
  })
