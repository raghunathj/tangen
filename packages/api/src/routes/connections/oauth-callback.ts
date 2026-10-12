/**
 * File Name: oauth-callback.ts (connections)
 * Purpose: Where the provider sends the browser back (Extension Kernel K6.2,
 *          tasks/plan-extension-kernel.md). Pre-auth: the member's session is
 *          not on this request, so the state carries the workspace and the
 *          pending connection, and the nonce sealed on that row is what
 *          proves the flow is the one core started - once, and within its
 *          window. The code is exchanged at the connector's token URL with
 *          PKCE, the tokens are sealed onto the row, the state is spent, and
 *          the browser goes back to Settings → Connections with the outcome.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: mounted BEFORE authMiddleware, beside the extension
 *          public routes. A bad or replayed state is a 400, not a redirect:
 *          nothing about the workspace is learnable from it.
 */
import { Elysia } from 'elysia'
import { timingSafeEqual } from 'node:crypto'
import { RequestError } from '../../lib/errors'
import { connectionsScopeFor } from '../../services/connections-scope'
import { resolveConnectorOffers, offerForRow, storedConnectorId } from '../../services/extension-connections'
import { missingCapabilities } from '@tangen/types'
import { exchangeAuthorizationCode } from '../../services/oauth2'
import { OAUTH_CALLBACK_PATH, OAUTH_PENDING_TTL_MS } from './manage'

const bad = () => new RequestError('OAUTH_STATE_INVALID', 'This OAuth state is not one this platform started, or it has already been used', 400)

function sameNonce(a: unknown, b: string): boolean {
  if (typeof a !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/** A FUNCTION over the app, not a module-scope `new Elysia()` (the framework boundary). */
export const connectionsOAuthCallbackRoute = (app: Elysia) => app
  .get(OAUTH_CALLBACK_PATH, async (ctx: any) => {
    const q = ctx.query as Record<string, string | undefined>
    const parts = typeof q.state === 'string' ? q.state.split('.') : []
    if (parts.length !== 3 || parts.some((p) => !p)) throw bad()
    const [workspaceId, id, nonce] = parts as [string, string, string]
    const scope = connectionsScopeFor(workspaceId)
    if (!scope) throw bad()
    const pending = await scope.store.open(id)
    if (!pending || pending.status !== 'pending' || !sameNonce(pending.meta.oauthState, nonce)) throw bad()
    const startedAt = Number(pending.meta.oauthStartedAt)
    if (!Number.isFinite(startedAt) || Date.now() - startedAt > OAUTH_PENDING_TTL_MS) {
      await scope.store.remove(id)
      throw new RequestError('OAUTH_STATE_EXPIRED', 'This OAuth flow took too long; start it again from Settings', 400)
    }

    const back = `${(scope.adminUrl ?? new URL(ctx.request.url).origin).replace(/\/$/, '')}/${workspaceId}/settings/connections`
    const redirect = (qs: string) => new Response(null, { status: 302, headers: { location: `${back}?${qs}` } })

    if (typeof q.error === 'string' && q.error) {
      await scope.store.remove(id)
      return redirect(`error=${encodeURIComponent(q.error)}`)
    }
    if (typeof q.code !== 'string' || !q.code) {
      await scope.store.remove(id)
      return redirect('error=missing_code')
    }
    // A1: if a second pack claimed this provider while the operator was at
    // the provider's consent screen, there is no single token endpoint to
    // exchange the code at - which is exactly what the conflict refuses to
    // guess. The pending row goes, the operator is told why, and no half-made
    // connection is left behind.
    const { offers, conflicts } = resolveConnectorOffers(new Set(await scope.activeIds()))
    if (conflicts.length > 0) {
      const parts = /^ext:[^/]+\/(.+)$/.exec(pending.connectorId)
      const connectorId = parts?.[1] ?? pending.connectorId
      if (conflicts.some((c) => connectorId === c.provider || connectorId.startsWith(`${c.provider}.`))) {
        await scope.store.remove(id)
        return redirect('error=provider_conflict')
      }
    }
    const offer = offerForRow(offers, pending.connectorId)
    if (!offer || offer.def.auth.kind !== 'oauth2') {
      await scope.store.remove(id)
      return redirect('error=connector_missing')
    }
    const { clientId, clientSecret, codeVerifier } = pending.credentials as { clientId?: string; clientSecret?: string; codeVerifier?: string }
    let tokens
    try {
      tokens = await exchangeAuthorizationCode({
        tokenUrl: offer.def.auth.tokenUrl, code: q.code, redirectUri: String(pending.meta.oauthRedirectUri ?? ''),
        clientId: String(clientId ?? ''), clientSecret, codeVerifier, fetchImpl: scope.fetchImpl,
      })
    } catch (e) {
      await scope.store.remove(id)
      return redirect(`error=exchange_failed&detail=${encodeURIComponent((e as Error).message)}`)
    }
    const { oauthState: _s, oauthStartedAt: _t, oauthRedirectUri: _r, ...meta } = pending.meta
    /**
     * What was asked for, against what the provider actually granted. Google
     * asks per item and honours a subset, twice observed in the first real
     * run - and an operator who ticked a box and is then told they are not
     * authorized has no way to know the provider dropped it. So the gap is
     * recorded, and the state derivation says whose decision it was.
     */
    const asked = Array.isArray(meta.capabilities)
      ? (meta.capabilities as unknown[]).filter((c): c is string => typeof c === 'string')
      : []
    const denied = asked.length > 0 && tokens.scope
      ? missingCapabilities({ def: offer.def, granted: tokens.scope, required: asked }).map((m) => m.capability)
      : []
    await scope.store.update(id, {
      status: 'active',
      credentials: { clientId, ...(clientSecret ? { clientSecret } : {}), ...tokens },
      meta: {
        ...meta, ...(tokens.scope ? { scope: tokens.scope } : {}),
        ...(denied.length > 0 ? { capabilitiesDenied: denied } : {}),
      },
    })
    return redirect(`connected=${encodeURIComponent(id)}`)
  })
