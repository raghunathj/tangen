/**
 * File Name: manage.ts (connections)
 * Purpose: Settings → Connections (Extension Kernel K6.2,
 *          tasks/plan-extension-kernel.md). A member holding manage:settings
 *          sees the connectors the workspace's active extensions offer and
 *          the connections configured for them, never material; creates an
 *          apiKey or basic connection against the connector's declared
 *          fields; renames, deletes, tests one (the connector's health,
 *          recorded on the row); and starts an OAuth2 connection - core
 *          mints state and PKCE, seals the client credentials on a pending
 *          row and answers the provider's authorize URL. The pre-auth
 *          callback (oauth-callback.ts) completes it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: mounted after authMiddleware. The workspace scope
 *          (store, active extensions, URLs) comes from connections-scope.ts,
 *          installed at boot.
 */
import { Elysia } from 'elysia'
import type { ConnectorDefinition } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { connectionsScopeFor, type ConnectionsScope } from '../../services/connections-scope'
import { resolveConnectorOffers, storedConnectorId, offerForRow, connectionClientFor, providerOf, providerConflictError, type ConnectorOffer, type ProviderConflict } from '../../services/extension-connections'
import { connectionState, missingCapabilities, qualifiedCapability, resourceLimit, connectorOAuthEnvNames, RESOURCE_CACHE_TTL_MS, type ResourcePage } from '@tangen/types'
import { effectiveGrants } from '../../services/extension-server'
import { withRouteCache, clearRouteCache } from '../../services/route-cache'
import { createHash } from 'node:crypto'
import type { ConnectionSummary, ConnectionKind } from '../../services/connections'
import { pkceVerifier, pkceChallenge, oauthNonce, buildAuthorizeUrl, revokeTokenAtProvider } from '../../services/oauth2'
import { listInstalls, installExecFromDb } from '../../services/extension-install-state'
import { getExtensionManifest } from '../../hooks/app-hooks-registry'

export const OAUTH_CALLBACK_PATH = '/api/v1/connections/oauth/callback'
/** How long a started OAuth flow may take before its state is refused. */
export const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000

/** Same gate as the other settings that change what the workspace can do; the workspace in the URL must be the session's. */
function assertConnectionsAdmin(ctx: any, workspaceIdFromPath: string): void {
  requireCapability(ctx, 'manage:settings')
  assertSameWorkspace(ctx, workspaceIdFromPath)
}

function assertSameWorkspace(ctx: any, workspaceIdFromPath: string): void {
  if (ctx.workspaceId && workspaceIdFromPath !== ctx.workspaceId) {
    throw new RequestError('FORBIDDEN', 'This session is not authorized for that workspace', 403)
  }
}

/**
 * B3: the PICKER gate. Choosing which connection an automation uses is not
 * managing connections, and the Flows builder runs on `manage:flows` - an
 * extension capability a core route cannot enumerate. So the two read-only
 * picker routes take `connections:use`, which grants no material, no creation
 * and no revocation; `manage:settings` and admin imply it.
 */
function assertConnectionsPicker(ctx: any, workspaceIdFromPath: string): void {
  const held = (ctx.permissions as { admin?: boolean; capabilities?: string[] } | null | undefined)
  const ok = held?.admin === true || (held?.capabilities ?? []).some((c) => c === 'connections:use' || c === 'manage:settings')
  if (!ok) throw new RequestError('FORBIDDEN', 'You need the "Point automations at a connection" permission (connections:use) to choose a connection', 403)
  assertSameWorkspace(ctx, workspaceIdFromPath)
}

async function scopeOf(workspaceId: string): Promise<{ scope: ConnectionsScope; offers: ConnectorOffer[]; conflicts: ProviderConflict[]; active: string[] }> {
  const scope = connectionsScopeFor(workspaceId)
  if (!scope) throw new RequestError('NOT_FOUND', 'Connections are not available for this workspace', 404)
  const active = await scope.activeIds()
  // A1: ownership comes from the declarations, so a conflicted provider offers
  // nothing here either - an operator cannot configure a connector nobody owns.
  const { offers, conflicts } = resolveConnectorOffers(new Set(active))
  return { scope, offers, conflicts, active }
}

function offerFor(offers: ConnectorOffer[], connectorId: unknown, conflicts: ProviderConflict[] = []): ConnectorOffer {
  const offer = typeof connectorId === 'string' ? offers.find((o) => o.def.id === connectorId) : undefined
  if (offer) return offer
  // Name the conflict rather than "no extension offers it", which would send
  // an operator to install a pack they already have twice.
  const conflict = conflicts.find((c) => typeof connectorId === 'string' && (c.provider === connectorId || connectorId.startsWith(`${c.provider}.`)))
  if (conflict) throw providerConflictError(conflict)
  throw new RequestError('NOT_FOUND', `No active extension offers the connector '${String(connectorId)}'`, 404)
}

/** `ext:<extension>/<connector>` back into its parts; a row whose connector is gone still names where it came from. */
function parseStored(stored: string): { extensionId: string; connectorId: string } {
  const m = /^ext:([^/]+)\/(.+)$/.exec(stored)
  return m ? { extensionId: m[1]!, connectorId: m[2]! } : { extensionId: '', connectorId: stored }
}

/**
 * The public shape: the connector's own id, the pack it came from, whether an
 * active pack still offers it, and the DERIVED state - one derivation
 * (`connectionState`) for every surface, so the page renders a reason rather
 * than inventing one from a status (plan-connectors B1, invariant 11).
 */
export function publicConnection(row: ConnectionSummary, offers: ConnectorOffer[], conflicts: ProviderConflict[] = []) {
  const parts = parseStored(row.connectorId)
  const offer = offerForRow(offers, row.connectorId)
  const conflict = offer ? undefined : conflicts.find((c) => parts.connectorId === c.provider || parts.connectorId.startsWith(`${c.provider}.`))
  const state = connectionState({
    row: row as never,
    ...(offer ? { offer: { provider: providerOf(offer.def), def: offer.def } } : {}),
    ...(conflict ? { conflict } : {}),
  })
  return {
    ...row, connectorId: parts.connectorId, extensionId: parts.extensionId, offered: offer !== undefined, state,
    // What the operator consented to, by capability name, so a re-consent
    // starts ticked with what this connection already has instead of asking
    // an operator to remember. Never the provider's scope strings: those stay
    // in `meta`, which is the kernel's business.
    capabilities: Array.isArray(row.meta.capabilities)
      ? (row.meta.capabilities as unknown[]).filter((c): c is string => typeof c === 'string')
      : [],
  }
}

/**
 * What the Admin needs to draw a connector: never its request, health or
 * search functions.
 *
 * Guardrail 3: each capability says WHICH active extensions require it, so the
 * consent checklist can tick and lock those and an operator can read why a box
 * will not come off. `requiredBy` is the effective grants of the active
 * extensions - what they actually hold here, not what a manifest wished for.
 *
 * Two exclusions, both found the moment a real pack was installed:
 *
 * - The OWNING pack is not a requirement. A pack holds `connections:<provider>`
 *   so its own services can run over whatever the operator consented to; that
 *   is permission, not a demand. Counting it locked every capability of every
 *   pack and left an operator unable to consent narrowly at all.
 * - A provider-wide grant is not a requirement either, for the same reason: it
 *   says "may use any capability of this provider", not "needs all of them".
 *   Only a CAPABILITY-specific grant (`connections:google.sheets.append`) is a
 *   requirement, which is what makes a locked box mean something.
 */
export function publicConnector(offer: ConnectorOffer, scope?: { workspaceId: string; activeIds: readonly string[]; oauthClient?: (provider: string) => { clientId?: string; clientSecret?: string } }) {
  const { id, label, description, auth, hosts } = offer.def
  const provider = providerOf(offer.def)
  const holders = (scope?.activeIds ?? []).map((extensionId) => ({ extensionId, grants: effectiveGrants(extensionId, scope!.workspaceId) }))
  const capabilities = Object.entries(offer.def.capabilities ?? {}).map(([key, cap]) => ({
    key,
    qualified: qualifiedCapability(provider, key),
    label: cap.label,
    ...(cap.description ? { description: cap.description } : {}),
    scopes: cap.scopes ?? [],
    requiredBy: holders
      .filter(({ extensionId }) => extensionId !== offer.extensionId)
      .filter(({ grants }) => grants.includes(`connections:${qualifiedCapability(provider, key)}`))
      .map(({ extensionId }) => extensionId)
      .sort(),
  }))
  // Whether the deployment already supplies the OAuth client, so the connect
  // form can stop asking for it. The value itself never appears here.
  const supplied = auth.kind === 'oauth2' ? Boolean(scope?.oauthClient?.(provider).clientId) : false
  return {
    id, provider, extensionId: offer.extensionId, label, description, auth, hosts,
    // How an operator recognises the provider in a list. The pack ships the
    // mark inline, so the Admin renders it without fetching anything.
    ...(offer.def.brand ? { brand: offer.def.brand } : {}),
    oauthClient: auth.kind === 'oauth2' ? (supplied ? 'deployment' : 'operator') : null,
    /**
     * E2: which active extensions actually USE this provider, derived from
     * their grants rather than from a list anyone maintains - so a catalogue
     * can say "used by SEO, Flows" and an operator knows what a revoke
     * breaks. The owning pack is excluded: it holds the grant to run its own
     * services, which is not a use of the integration.
     */
    usedBy: holders
      .filter(({ extensionId }) => extensionId !== offer.extensionId)
      .filter(({ grants }) => grants.some((g) => g === `connections:${provider}` || g.startsWith(`connections:${provider}.`)))
      .map(({ extensionId }) => extensionId)
      .sort(),
    capabilities,
    resources: Object.entries(offer.def.resources ?? {}).map(([type, r]) => ({ type, label: r.label, parent: r.parent ?? null, capability: r.capability ?? null })),
  }
}

function labelOf(body: Record<string, unknown>): string {
  if (typeof body.label !== 'string' || body.label.trim() === '') throw new RequestError('VALIDATION_ERROR', 'label is required', 422)
  return body.label.trim()
}

/** The credentials a connector's auth declares, exactly: apiKey its fields, basic username and password; OAuth2 never arrives this way. */
export function validateCredentials(auth: ConnectorDefinition['auth'], input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError('VALIDATION_ERROR', 'credentials must be an object', 422)
  const creds = input as Record<string, unknown>
  const fields = auth.kind === 'apiKey' ? auth.fields : auth.kind === 'basic' ? ['username', 'password'] : null
  if (!fields) throw new RequestError('VALIDATION_ERROR', 'This connector authenticates with OAuth2: start it with POST .../connections/oauth/start', 422)
  const out: Record<string, string> = {}
  const fieldErrors: Record<string, string> = {}
  for (const f of fields) {
    const v = creds[f]
    if (typeof v !== 'string' || v.trim() === '') fieldErrors[f] = `${f} is required`
    else out[f] = v
  }
  for (const k of Object.keys(creds)) if (!fields.includes(k)) fieldErrors[k] = `${k} is not a field of this connector`
  if (Object.keys(fieldErrors).length) throw new RequestError('VALIDATION_ERROR', `Credentials do not match the connector: ${Object.values(fieldErrors).join('; ')}`, 422, fieldErrors)
  return out
}

function bodyOf(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('VALIDATION_ERROR', 'Request body must be an object', 422)
  return body as Record<string, unknown>
}

const originOf = (request: Request) => new URL(request.url).origin

/**
 * One health record from one check, with the previous one to fall back on.
 *
 * A TRANSIENT failure - the provider could not answer - keeps the verdict it
 * had and records the attempt, because a provider having a bad ten minutes is
 * not a broken connection (the user, 2026-09-20). A real refusal replaces it,
 * with the reason. Exported and pure: the Test button and the hourly sweep
 * must record the same thing.
 */
export function healthFromVerdict(
  verdict: { ok: boolean; message?: string; transient?: boolean },
  checkedAt: string,
  previous?: ConnectionSummary['health'],
): NonNullable<ConnectionSummary['health']> {
  if (verdict.ok) return { ok: true, checkedAt }
  if (verdict.transient) {
    return {
      // Unknown, so nothing is claimed: what it WAS stands until a check can
      // actually reach the provider.
      ok: previous?.ok ?? false,
      checkedAt,
      message: `Could not be checked: ${verdict.message ?? 'the provider did not answer'}`,
    }
  }
  return { ok: false, checkedAt, message: verdict.message ?? 'The connector reported the connection as not working, and gave no reason' }
}

/**
 * The connector PACKS this workspace has, enabled or not (plan-connectors E2).
 *
 * A pack that is installed and switched off offers no connectors, so without
 * this it would vanish from the one page it belongs on - and an operator
 * looking at a dormant connection would have nowhere to go. Read from the
 * install rows rather than from the active set, for exactly that reason.
 */
async function connectorPacks(db: unknown, workspaceId: string, activeIds: readonly string[]) {
  let rows: Array<{ extensionId: string; state: string; enabled: boolean; version?: string | null }> = []
  try {
    rows = await listInstalls(installExecFromDb(db as never), { workspaceId }) as never
  } catch {
    return []   // no database here (a test, a degraded boot): the page shows what it has
  }
  return rows
    .filter((r) => r.state === 'installed')
    .flatMap((r) => {
      const manifest = getExtensionManifest(r.extensionId) as
        | { id: string; name?: string; kind?: string; connectors?: Array<{ provider: string; brand?: unknown }> }
        | undefined
      if (manifest?.kind !== 'connector-pack') return []
      const providers = [...new Set((manifest.connectors ?? []).map((c) => c.provider))].sort()
      return [{
        extensionId: r.extensionId,
        name: manifest.name ?? r.extensionId,
        version: r.version ?? null,
        enabled: r.enabled === true,
        /** Enabled AND loaded: what actually offers connectors right now. */
        active: activeIds.includes(r.extensionId),
        providers,
        // The mark from the DECLARATION, so a pack that is off still has a face.
        ...((manifest.connectors ?? []).find((c) => c.brand)?.brand ? { brand: (manifest.connectors ?? []).find((c) => c.brand)!.brand } : {}),
      }]
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

const PREFIX = '/api/v1/admin/workspaces/:workspaceId/connections'

/** A FUNCTION over the app, not a module-scope `new Elysia()`: routes mount when the composer composes them (the framework boundary). */
export const connectionsRoutes = (app: Elysia) => app
  .get(PREFIX, async (ctx: any) => {
    assertConnectionsAdmin(ctx, ctx.params.workspaceId)
    const { scope, offers, conflicts, active } = await scopeOf(ctx.params.workspaceId)
    const rows = await scope.store.list()
    return {
      data: rows.map((r) => publicConnection(r, offers, conflicts)),
      connectors: offers.map((o) => publicConnector(o, { workspaceId: ctx.params.workspaceId, activeIds: active, ...(scope.oauthClient ? { oauthClient: scope.oauthClient } : {}) })),
      // The most actionable reason first (invariant 11): a page that shows
      // only dormancy would hide the one thing an operator can act on.
      conflicts,
      // E2: the packs themselves belong on this page, not among the
      // extensions - including one that is installed and switched off, which
      // offers nothing and would otherwise be invisible here.
      packs: await connectorPacks(ctx.db, ctx.params.workspaceId, active),
    }
  })
  .post(PREFIX, async (ctx: any) => {
    assertConnectionsAdmin(ctx, ctx.params.workspaceId)
    const body = bodyOf(ctx.body)
    const { scope, offers, conflicts } = await scopeOf(ctx.params.workspaceId)
    const offer = offerFor(offers, body.connectorId, conflicts)
    const label = labelOf(body)
    const credentials = validateCredentials(offer.def.auth, body.credentials ?? {})
    const row = await scope.store.create({
      connectorId: storedConnectorId(offer.extensionId, offer.def.id), label, kind: offer.def.auth.kind as ConnectionKind,
      credentials, createdBy: ctx.memberId ?? null,
    })
    ctx.set.status = 201
    return publicConnection(row, offers)
  })
  .patch(`${PREFIX}/:id`, async (ctx: any) => {
    assertConnectionsAdmin(ctx, ctx.params.workspaceId)
    const body = bodyOf(ctx.body)
    const { scope, offers } = await scopeOf(ctx.params.workspaceId)
    const row = (await scope.store.list()).find((r) => r.id === ctx.params.id)
    if (!row) throw new RequestError('NOT_FOUND', 'Connection not found', 404)
    const patch: { label?: string; credentials?: Record<string, unknown> } = {}
    if (body.label !== undefined) patch.label = labelOf(body)
    if (body.credentials !== undefined) {
      const offer = offerForRow(offers, row.connectorId)
      if (!offer) throw new RequestError('CONFLICT', 'No active extension offers this connector any more; delete the connection instead', 409)
      patch.credentials = validateCredentials(offer.def.auth, body.credentials)
    }
    await scope.store.update(row.id, patch)
    return publicConnection((await scope.store.list()).find((r) => r.id === row.id)!, offers)
  })
  .delete(`${PREFIX}/:id`, async (ctx: any) => {
    assertConnectionsAdmin(ctx, ctx.params.workspaceId)
    const { scope } = await scopeOf(ctx.params.workspaceId)
    await scope.store.remove(ctx.params.id)
    return new Response(null, { status: 204 })
  })
  .post(`${PREFIX}/:id/test`, async (ctx: any) => {
    assertConnectionsAdmin(ctx, ctx.params.workspaceId)
    const { scope, offers } = await scopeOf(ctx.params.workspaceId)
    const opened = await scope.store.open(ctx.params.id)
    if (!opened) throw new RequestError('NOT_FOUND', 'Connection not found', 404)
    if (opened.status === 'pending') throw new RequestError('CONFLICT', 'This connection has not finished connecting', 409)
    if (opened.status === 'unreadable') throw new RequestError('CONNECTION_UNREADABLE', 'This connection was sealed under another connections key; reconnect it', 409)
    if (opened.status !== 'active') throw new RequestError('CONFLICT', `This connection is ${opened.status}; only an active connection can be tested`, 409)
    const offer = offerForRow(offers, opened.connectorId)
    if (!offer) throw new RequestError('CONFLICT', 'No active extension offers this connector any more', 409)
    const checkedAt = new Date().toISOString()
    let health: NonNullable<ConnectionSummary['health']>
    if (typeof offer.def.health !== 'function') {
      health = { ok: false, checkedAt, message: 'This connector declares no health check' }
    } else {
      const client = connectionClientFor({
        row: opened, credentials: opened.credentials, offer, workspaceId: ctx.params.workspaceId, extensionId: null,
        store: scope.store, fetchImpl: scope.fetchImpl, lookup: scope.lookup,
      })
      const verdict = await client.health()
      // The provider's own words where there are any: "the connector reported
      // the connection as not working" is true and useless (the user,
      // 2026-09-20).
      health = healthFromVerdict(verdict, checkedAt, opened.health)
    }
    await scope.store.update(opened.id, { health })
    /**
     * The WHOLE row, not just the health - because what a page renders is the
     * DERIVED state (B1), and a caller handed only a health blob has to guess
     * the rest. It guessed wrong: a successful test left the row still
     * reading "not working" until a reload (acme, 2026-09-19). Same shape as
     * revoke, for the same reason.
     */
    const rows = await scope.store.list()
    return publicConnection(rows.find((r) => r.id === opened.id)!, offers)
  })
  /**
   * B2: one page of what an operator can pick inside a connection. Core
   * proxies it, so the Admin never sees a credential and no provider call is
   * made without the capability the listing needs. Only DECLARED resource
   * types are reachable: there is no generic passthrough.
   */
  /**
   * B3: what a picker may see - id, label, provider and the derived state.
   * Never a kind's fields, never meta, never health detail, never material.
   */
  .get(`${PREFIX}/pickable`, async (ctx: any) => {
    assertConnectionsPicker(ctx, ctx.params.workspaceId)
    const { scope, offers, conflicts } = await scopeOf(ctx.params.workspaceId)
    const q = (ctx.query ?? {}) as Record<string, string | undefined>
    const wantProvider = typeof q.provider === 'string' && q.provider !== '' ? q.provider : undefined
    const required = typeof q.capabilities === 'string' && q.capabilities !== ''
      ? q.capabilities.split(',').map((c) => c.trim()).filter(Boolean)
      : []
    const rows = await scope.store.list()
    const data = rows.flatMap((row) => {
      const parts = parseStored(row.connectorId)
      const offer = offerForRow(offers, row.connectorId)
      const provider = offer ? providerOf(offer.def) : parts.connectorId.split('.')[0]!
      if (wantProvider && provider !== wantProvider && parts.connectorId !== wantProvider) return []
      const conflict = offer ? undefined : conflicts.find((c) => provider === c.provider)
      const verdict = connectionState({
        row: row as never,
        ...(offer ? { offer: { provider, def: offer.def } } : {}),
        ...(conflict ? { conflict } : {}),
        ...(required.length > 0 ? { required } : {}),
      })
      return [{
        id: row.id, label: row.label, provider, connectorId: parts.connectorId, state: verdict,
        // The pack's mark travels with a pickable connection too, so a picker
        // in a flow node shows what the Connections page shows.
        ...(offer?.def.brand ? { brand: offer.def.brand } : {}),
      }]
    })
    const resources = offers
      .filter((o) => !wantProvider || providerOf(o.def) === wantProvider)
      .flatMap((o) => Object.entries(o.def.resources ?? {}).map(([type, r]) => ({ provider: providerOf(o.def), type, label: r.label, parent: r.parent ?? null })))
    return {
      data,
      meta: {
        provider: wantProvider ?? null,
        // What the picker needs to render an empty state that is worth reading.
        offered: offers.filter((o) => !wantProvider || providerOf(o.def) === wantProvider).map((o) => ({ provider: providerOf(o.def), connectorId: o.def.id, label: o.def.label, extensionId: o.extensionId })),
        conflicts: wantProvider ? conflicts.filter((c) => c.provider === wantProvider) : conflicts,
        resources,
      },
    }
  })
  .get(`${PREFIX}/:id/resources/:type`, async (ctx: any) => {
    assertConnectionsPicker(ctx, ctx.params.workspaceId)
    const { scope, offers, conflicts } = await scopeOf(ctx.params.workspaceId)
    const row = (await scope.store.list()).find((r) => r.id === ctx.params.id)
    if (!row) throw new RequestError('NOT_FOUND', 'Connection not found', 404)
    const offer = offerForRow(offers, row.connectorId)
    // A dormant or conflicted row answers the SAME sentence the page shows.
    if (!offer) {
      const parts = parseStored(row.connectorId)
      const conflict = conflicts.find((c) => parts.connectorId === c.provider || parts.connectorId.startsWith(`${c.provider}.`))
      const verdict = connectionState({ row: row as never, ...(conflict ? { conflict } : {}) })
      throw new RequestError('CONFLICT', `${verdict.reason}${verdict.fix ? ` ${verdict.fix.hint}` : ''}`, 409)
    }
    const type = String(ctx.params.type)
    const resource = offer.def.resources?.[type]
    if (!resource) throw new RequestError('NOT_FOUND', `Connector '${offer.def.id}' has no resource '${type}'`, 404)

    const q = (ctx.query ?? {}) as Record<string, string | undefined>
    const parent = typeof q.parent === 'string' && q.parent !== '' ? q.parent : undefined
    if (resource.parent && !parent) {
      throw new RequestError('VALIDATION_ERROR', `Choose a ${offer.def.resources?.[resource.parent]?.label ?? resource.parent} first: '${type}' is listed within one`, 422)
    }
    if (!resource.parent && parent) throw new RequestError('VALIDATION_ERROR', `Resource '${type}' is not listed within another`, 422)

    // The capability the LISTING needs, checked before the provider is called.
    if (resource.capability) {
      const missing = missingCapabilities({ def: offer.def, granted: typeof row.meta.scope === 'string' ? row.meta.scope : null, required: [resource.capability] })
      if (missing.length > 0) {
        const names = missing.map((m) => `'${m.label}'`).join(', ')
        throw new RequestError('CONNECTION_CAPABILITY', `The connection '${row.label}' is not authorized for ${names}. Reconnect it and include it to pick a ${resource.label.toLowerCase()}.`, 403, undefined, { capability: resource.capability, missing })
      }
    }

    const query = typeof q.query === 'string' ? q.query.trim().slice(0, 200) : ''
    const cursor = typeof q.cursor === 'string' && q.cursor !== '' ? q.cursor : undefined
    const limit = resourceLimit(q.limit, resource)
    const opened = await scope.store.open(row.id)
    if (!opened || opened.status !== 'active') throw new RequestError('CONFLICT', `This connection is ${opened?.status ?? 'unreadable'}; only an active connection can be listed`, 409)

    // The row's own `updatedAt` is part of the key, so re-consenting,
    // rotating a credential or revoking invalidates every cached page of that
    // connection without a tag sweep: the old keys simply stop being asked for.
    const fingerprint = createHash('sha256').update(JSON.stringify([row.id, row.updatedAt, type, parent ?? '', query, cursor ?? '', limit])).digest('hex').slice(0, 16)
    const key = `connres:${fingerprint}`
    const ttl = Math.max(1, Math.round((resource.cacheTtlMs ?? RESOURCE_CACHE_TTL_MS) / 1000))
    // `refresh=1` skips the cache once: an operator who just created a
    // spreadsheet should not wait a minute to see it.
    if (q.refresh === '1') await clearRouteCache(scope.redis, ctx.params.workspaceId, key)
    const page = await withRouteCache<ResourcePage>(scope.redis, ctx.params.workspaceId, { key, ttl }, async () => {
      const client = connectionClientFor({
        row: opened, credentials: opened.credentials, offer, workspaceId: ctx.params.workspaceId, extensionId: null,
        store: scope.store, fetchImpl: scope.fetchImpl, lookup: scope.lookup,
      })
      const conn = { id: opened.id, connectorId: opened.connectorId, label: opened.label, kind: opened.kind, meta: opened.meta, credentials: opened.credentials, fetch: scope.fetchImpl ?? fetch, request: client.request }
      // A provider that refuses is not a platform failure, and saying so
      // matters: Google's own message usually names the fix (enable an API,
      // grant access to a property), and an operator reading "something went
      // wrong" would look for the bug in Tangen instead.
      let answered: ResourcePage
      try {
        answered = await resource.search({ query: query || undefined, cursor, parent, limit }, conn as never)
      } catch (e) {
        throw new RequestError('PROVIDER_REFUSED', (e as Error).message || `The provider refused to list ${resource.label.toLowerCase()}`, 502)
      }
      const options = (answered?.options ?? []).slice(0, limit)
      return { options, ...(answered?.nextCursor ? { nextCursor: answered.nextCursor } : {}), ...(answered?.truncated || (answered?.options?.length ?? 0) > limit ? { truncated: true } : {}) }
    })
    return { data: page.options, meta: { type, label: resource.label, limit, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}), ...(page.truncated ? { truncated: true } : {}) } }
  })
  .post(`${PREFIX}/:id/revoke`, async (ctx: any) => {
    assertConnectionsAdmin(ctx, ctx.params.workspaceId)
    const { scope, offers } = await scopeOf(ctx.params.workspaceId)
    const opened = await scope.store.open(ctx.params.id)
    if (!opened) throw new RequestError('NOT_FOUND', 'Connection not found', 404)
    if (opened.status !== 'active') throw new RequestError('CONFLICT', `This connection is ${opened.status}; only an active connection can be revoked`, 409)
    // Best effort at the provider (RFC 7009) when the connector says where; the material goes regardless.
    const offer = offerForRow(offers, opened.connectorId)
    if (offer?.def.auth.kind === 'oauth2' && offer.def.auth.revokeUrl) {
      const token = (opened.credentials.refreshToken ?? opened.credentials.accessToken) as string | undefined
      if (token) await revokeTokenAtProvider({
        revokeUrl: offer.def.auth.revokeUrl, token,
        clientId: typeof opened.credentials.clientId === 'string' ? opened.credentials.clientId : undefined,
        clientSecret: typeof opened.credentials.clientSecret === 'string' ? opened.credentials.clientSecret : undefined,
        fetchImpl: scope.fetchImpl,
      })
    }
    /**
     * The material goes, and so does the RECORD of what it was authorized
     * for: `meta.scope` describes an authorization that no longer exists, and
     * a row that keeps it reads as though it still holds those scopes. The
     * capability list stays, because it is what the operator asked for and is
     * what a reconnect starts ticked from.
     */
    const { scope: _revokedScope, capabilitiesDenied: _denied, ...keptMeta } = opened.meta
    await scope.store.update(opened.id, { status: 'revoked', credentials: {}, health: null, meta: keptMeta })
    return publicConnection((await scope.store.list()).find((r) => r.id === opened.id)!, offers)
  })
  .post(`${PREFIX}/oauth/start`, async (ctx: any) => {
    assertConnectionsAdmin(ctx, ctx.params.workspaceId)
    const body = bodyOf(ctx.body)
    const { scope, offers, conflicts, active } = await scopeOf(ctx.params.workspaceId)
    /**
     * A RE-CONSENT names the connection it is for, so an operator adding a
     * capability upgrades the row they already have instead of collecting a
     * second Google connection beside it. Everything configured against its
     * id keeps working, because the id does not change.
     */
    const reconnecting = typeof body.connectionId === 'string' && body.connectionId.trim() !== ''
      ? (await scope.store.list()).find((r) => r.id === body.connectionId)
      : undefined
    if (typeof body.connectionId === 'string' && body.connectionId.trim() !== '' && !reconnecting) {
      throw new RequestError('NOT_FOUND', 'Connection not found', 404)
    }
    const offer = offerFor(offers, reconnecting ? parseStored(reconnecting.connectorId).connectorId : body.connectorId, conflicts)
    if (offer.def.auth.kind !== 'oauth2') throw new RequestError('VALIDATION_ERROR', 'This connector does not authenticate with OAuth2', 422)
    const label = reconnecting ? reconnecting.label : labelOf(body)
    // The operator's OAuth app: typed here, or supplied once by the
    // deployment (CONNECTOR_<PROVIDER>_CLIENT_ID). Either way it is the
    // operator's own client and it never leaves the server.
    const fromDeployment = scope.oauthClient?.(providerOf(offer.def)) ?? {}
    const typedId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    const typedSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : ''
    const clientId = typedId || fromDeployment.clientId
    const clientSecret = typedSecret || fromDeployment.clientSecret
    if (!clientId) {
      const names = connectorOAuthEnvNames(providerOf(offer.def))
      throw new RequestError('VALIDATION_ERROR', `This connector needs your own OAuth client. Set ${names.clientId} and ${names.clientSecret} on the deployment, or send clientId and clientSecret with this request.`, 422, { clientId: `clientId is required, or set ${names.clientId} on the deployment` })
    }
    // C2/guardrail 3: the operator's capability selection decides the scopes.
    // Anything an active extension REQUIRES is included whether it was ticked
    // or not - the checklist locks those, and the server does not trust a
    // client that unticked one anyway.
    // On a re-consent the capabilities the row already carries are the floor:
    // ticking one more must not drop the ones an operator already approved.
    const already = reconnecting && Array.isArray(reconnecting.meta.capabilities)
      ? (reconnecting.meta.capabilities as unknown[]).filter((c): c is string => typeof c === 'string')
      : []
    const chosen = Array.isArray(body.capabilities) ? body.capabilities.filter((c): c is string => typeof c === 'string') : null
    const declared = offer.def.capabilities ?? {}
    const provider = providerOf(offer.def)
    const holders = active.map((extensionId) => ({ extensionId, grants: effectiveGrants(extensionId, ctx.params.workspaceId) }))
    // Only a capability-specific grant from ANOTHER extension is a
    // requirement; the owning pack's provider-wide grant is permission.
    const requiredKeys = Object.keys(declared).filter((key) => holders.some(({ extensionId, grants }) =>
      extensionId !== offer.extensionId && grants.includes(`connections:${qualifiedCapability(provider, key)}`)))
    const unknownChosen = (chosen ?? []).filter((c) => !(c in declared))
    if (unknownChosen.length > 0) throw new RequestError('VALIDATION_ERROR', `Connector '${offer.def.id}' declares no capability ${unknownChosen.map((c) => `'${c}'`).join(', ')}`, 422)
    const selected = Object.keys(declared).length === 0 ? [] : [...new Set([...(chosen ?? Object.keys(declared)), ...requiredKeys, ...already])]
    const scopes = Object.keys(declared).length === 0
      ? offer.def.auth.scopes
      : [...new Set(selected.flatMap((key) => declared[key]?.scopes ?? []))]
    const usePkce = offer.def.auth.pkce !== false
    const codeVerifier = usePkce ? pkceVerifier() : undefined
    const nonce = oauthNonce()
    const redirectUri = `${(scope.publicUrl ?? originOf(ctx.request)).replace(/\/$/, '')}${OAUTH_CALLBACK_PATH}`
    const pendingMeta = { oauthState: nonce, oauthStartedAt: Date.now(), oauthRedirectUri: redirectUri, ...(selected.length > 0 ? { capabilities: selected } : {}) }
    /**
     * A re-consent keeps the row: its id, its label and everything configured
     * against it. Its status goes back to `pending` and its material is
     * replaced when the provider answers, so a flow pointed at it is
     * unavailable for the length of the flow and correct afterwards.
     */
    const row = reconnecting
      ? await (async () => {
          await scope.store.update(reconnecting.id, {
            status: 'pending',
            credentials: { clientId, ...(clientSecret ? { clientSecret } : {}), ...(codeVerifier ? { codeVerifier } : {}) },
            // The previously recorded scope goes with the old credentials: it
            // describes an authorization that is being replaced.
            meta: { ...Object.fromEntries(Object.entries(reconnecting.meta).filter(([k]) => k !== 'scope')), ...pendingMeta },
          })
          return (await scope.store.list()).find((r) => r.id === reconnecting.id)!
        })()
      : await scope.store.create({
          connectorId: storedConnectorId(offer.extensionId, offer.def.id), label, kind: 'oauth2', status: 'pending',
          credentials: { clientId, ...(clientSecret ? { clientSecret } : {}), ...(codeVerifier ? { codeVerifier } : {}) },
          meta: pendingMeta,
          createdBy: ctx.memberId ?? null,
        })
    const authorizeUrl = buildAuthorizeUrl({
      authorizeUrl: offer.def.auth.authorizeUrl, clientId, redirectUri, scopes,
      state: `${ctx.params.workspaceId}.${row.id}.${nonce}`, codeChallenge: codeVerifier ? pkceChallenge(codeVerifier) : undefined,
      // Adding a capability must not cost an operator the ones they have.
      incremental: Boolean(reconnecting),
    })
    return { id: row.id, authorizeUrl, capabilities: selected, reconnected: Boolean(reconnecting), ...(requiredKeys.length > 0 ? { required: requiredKeys } : {}) }
  })
