/**
 * File Name: extension-connections.ts
 * Purpose: `ctx.connections` (Extension Kernel K6.1/K6.2,
 *          tasks/plan-extension-kernel.md): what an extension gets from an
 *          operator's connection. A consumer holding `connections:<connector>`
 *          (or the platform's authority) receives an AUTHED CLIENT - the
 *          connector's `request` bound to the sealed credentials and to an
 *          http that reaches only the connector's declared hosts - and never
 *          the token itself. Connectors come from the `connectors@1` point of
 *          the extensions active in the scope; a connector nobody offers, or
 *          a connection nobody configured, answers undefined; the missing
 *          grant is a refusal. Several connections of one connector are told
 *          apart by label.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExecutionContext, ConnectorDefinition } from '@tangen/types'
import { missingCapabilities, qualifiedCapability, connectionState, connectorSupersedes, integrationState, type IntegrationVerdict } from '@tangen/types'
import { listExtensionServerIds, getExtensionManifest } from '../hooks/app-hooks-registry'
import { RequestError } from '../lib/errors'
import { decide } from '../kernel/policy'
import { contributions, noteContributionWarning } from '../kernel/contributions'
import { createExtensionHttp, type ExtensionHttp } from './extension-http'
import type { ConnectionsStore, ConnectionSummary } from './connections'
import { refreshAccessToken } from './oauth2'

/** A token this close to expiry is refreshed before it is used. */
export const OAUTH_REFRESH_SKEW_MS = 60_000

/** What a consumer holds: identity and a way to call, never material. */
export interface ConnectionClient {
  id: string
  connectorId: string
  label: string
  kind: ConnectionSummary['kind']
  meta: Record<string, unknown>
  /** The connector's request, authenticated, host-bound to the connector's hosts. */
  request: (path: string, init?: RequestInit) => Promise<Response>
  /**
   * One of the connector's named operations, for a provider that is not HTTP.
   * The material stays with the connector, exactly as for `request` - a
   * consumer that needed the credential itself would break the one invariant
   * this whole seam exists for (found building the SMTP pack, 2026-09-20:
   * SMTP has no path to bind and no header to add).
   */
  invoke: <T = unknown>(operation: string, input?: unknown) => Promise<T>
  /** The connector's health check over this connection; false when the connector declares none and the client cannot tell. */
  health: () => Promise<boolean>
  /**
   * A3: false when the connection has no recorded scope - LEGACY authorization,
   * unknown rather than unrestricted. It still works; a consumer that wants to
   * be sure asks the operator to reconnect.
   */
  authorizationKnown: boolean
}

export interface ExtensionConnections {
  /** The connections this extension may use (its grants), without material. */
  list(): Promise<ConnectionSummary[]>
  /**
   * B1: why an integration is or is not usable here, without failing. Takes a
   * provider (`google`) or a qualified capability (`google.sheets.append`) and
   * answers the ONE derivation every surface renders, so a consumer degrades
   * with the same sentence the Admin shows.
   */
  availability(ref: string): Promise<IntegrationVerdict>
  /**
   * An authed client for an active connection of a PROVIDER (a connector id is
   * still accepted): the one named by id, else by label, else the first.
   * Undefined when nothing is configured or offered - a degrade. A configured
   * connection that lacks a required capability, or a provider two packs claim,
   * REFUSES by name, because both are operator-fixable.
   */
  get(providerOrConnector: string, options?: { id?: string; label?: string; capabilities?: readonly string[] }): Promise<ConnectionClient | undefined>
}

export interface ExtensionConnectionsDeps {
  exec: ExecutionContext
  store: ConnectionsStore
  activeIds: ReadonlySet<string>
  fetchImpl?: typeof fetch
  lookup?: (host: string) => Promise<string[]>
}

export interface ConnectorOffer { extensionId: string; def: ConnectorDefinition }

/** `ext:<extension>/<connector>` - the stored id, so a connector renamed or an extension removed is still diagnosable. */
export const storedConnectorId = (extensionId: string, connectorId: string) => `ext:${extensionId}/${connectorId}`

/**
 * The offer a stored row belongs to: the connector that owns its id, else one
 * that ADOPTS it (F2, `supersedes`).
 *
 * One function, used by every surface that maps a row to a connector, because
 * a row visible in Settings and invisible to `ctx.connections` - or the other
 * way round - would be worse than either answer alone.
 */
export function offerForRow(offers: readonly ConnectorOffer[], storedId: string): ConnectorOffer | undefined {
  return offers.find((o) => storedConnectorId(o.extensionId, o.def.id) === storedId)
    ?? offers.find((o) => connectorSupersedes(o.def, storedId))
}

/**
 * The RAW claims: every connector the active extensions offer, conflicts
 * included. A surface that has to explain a conflict needs both claimants, so
 * this stays unfiltered; everything that RESOLVES a connector goes through
 * `resolveConnectorOffers` instead.
 */
export function offeredConnectors(activeIds: ReadonlySet<string>): ConnectorOffer[] {
  return contributions<ConnectorDefinition>('connectors@1', { activeIds })
    .filter((c) => c.item && typeof c.item === 'object' && typeof c.item.id === 'string')
    .map((c) => ({ extensionId: c.extensionId, def: c.item }))
}

/**
 * Guardrail 4: the manifest and the runtime must agree, both ways.
 *
 * A pack declares its connectors so the install review and the ownership
 * preflight can see a provider without running its code (A1). That
 * declaration is therefore a promise, and this is where it is kept:
 *
 * - a CONTRIBUTED connector the manifest does not declare is dropped, because
 *   an operator approved hosts and providers they were shown, and a runtime
 *   that can add a provider afterwards makes that review a formality;
 * - a DECLARED connector nothing contributes is a warning, so stale manifest
 *   metadata is visible rather than silently claiming a provider the pack no
 *   longer offers (it also still counts for ownership, since the operator was
 *   told the pack owns it).
 *
 * An extension that declares NO connectors is exempt: every connector written
 * before the field existed keeps working, and `kind: 'connector-pack'` is
 * where the declaration becomes mandatory (C1).
 */
export function connectorDeclarationIssues(extensionId: string, contributed: readonly ConnectorDefinition[]): string[] {
  const declared = (getExtensionManifest(extensionId) as { connectors?: Array<{ id?: string; provider?: string }> } | undefined)?.connectors
  if (!Array.isArray(declared) || declared.length === 0) return []
  const issues: string[] = []
  const byId = new Map(declared.filter((c) => typeof c.id === 'string').map((c) => [c.id!, c] as const))
  for (const def of contributed) {
    const row = byId.get(def.id)
    if (!row) { issues.push(`extension '${extensionId}' contributes connector '${def.id}', which its manifest does not declare; it is not offered`); continue }
    const declaredProvider = row.provider ?? row.id
    if (providerOf(def) !== declaredProvider) {
      issues.push(`extension '${extensionId}' contributes connector '${def.id}' for provider '${providerOf(def)}', but its manifest declares provider '${declaredProvider}'; it is not offered`)
    }
  }
  // C1: two auth models of one provider are the same provider, so they must
  // describe it the same way. A capability set that drifts between them would
  // make a consumer's requirement mean different things depending on how the
  // operator happened to authenticate.
  const byProvider = new Map<string, ConnectorDefinition[]>()
  for (const def of contributed) {
    const list = byProvider.get(providerOf(def)) ?? []
    list.push(def)
    byProvider.set(providerOf(def), list)
  }
  for (const [provider, defs] of byProvider) {
    if (defs.length < 2) continue
    const keysOf = (d: ConnectorDefinition) => Object.keys(d.capabilities ?? {}).sort().join(',')
    const first = keysOf(defs[0]!)
    for (const other of defs.slice(1)) {
      if (keysOf(other) !== first) {
        issues.push(`extension '${extensionId}' declares different capabilities for provider '${provider}' on '${defs[0]!.id}' and '${other.id}'; every auth model of a provider offers the same capabilities`)
      }
    }
  }

  const contributedIds = new Set(contributed.map((c) => c.id))
  for (const row of declared) {
    if (typeof row.id === 'string' && !contributedIds.has(row.id)) {
      issues.push(`extension '${extensionId}' declares connector '${row.id}' but contributes none; its manifest metadata is stale`)
    }
  }
  return issues
}

/** Does the manifest declare this exact contribution? Undeclared is not offered. */
function isDeclared(extensionId: string, def: ConnectorDefinition): boolean {
  const declared = (getExtensionManifest(extensionId) as { connectors?: Array<{ id?: string; provider?: string }> } | undefined)?.connectors
  if (!Array.isArray(declared) || declared.length === 0) return true
  const row = declared.find((c) => c.id === def.id)
  return row !== undefined && (row.provider ?? row.id) === providerOf(def)
}

/** Every REGISTERED extension that declares a connector for this provider, from its manifest. */
export function packsDeclaring(provider: string, activeIds: ReadonlySet<string>): Array<{ extensionId: string; installed: boolean; active: boolean }> {
  const out: Array<{ extensionId: string; installed: boolean; active: boolean }> = []
  for (const extensionId of listExtensionServerIds()) {
    const declared = (getExtensionManifest(extensionId) as { connectors?: Array<{ id?: string; provider?: string }> } | undefined)?.connectors ?? []
    if (!declared.some((c) => (c.provider ?? c.id) === provider)) continue
    out.push({ extensionId, installed: true, active: activeIds.has(extensionId) })
  }
  return out
}

/** The provider a connector belongs to; its own id when it declares none. */
export const providerOf = (def: ConnectorDefinition): string => def.provider ?? def.id

/** Two active packs claiming one provider: nothing of it resolves until one is disabled. */
export interface ProviderConflict {
  provider: string
  /** Every claimant, sorted, so the answer never depends on registration order. */
  extensionIds: string[]
}

/**
 * Ownership, decided by the DECLARATIONS rather than by load order (A1). One
 * active pack owns a provider and every auth model under it. Two or more is a
 * conflict, and a conflicted provider offers NOTHING: resolving it would mean
 * choosing, and every rule for choosing (first registered, incumbent, newest)
 * is either order-dependent or silently routes an operator's credentials into
 * a different vendor's code. The conflict is loud instead, and the interactive
 * install path refuses before it can happen.
 */
export function resolveConnectorOffers(activeIds: ReadonlySet<string>): { offers: ConnectorOffer[]; conflicts: ProviderConflict[] } {
  const claimed0 = offeredConnectors(activeIds)
  // Guardrail 4, the runtime half: report both directions once, and offer
  // nothing the manifest did not declare.
  for (const extensionId of new Set(claimed0.map((o) => o.extensionId))) {
    const mine = claimed0.filter((o) => o.extensionId === extensionId).map((o) => o.def)
    for (const issue of connectorDeclarationIssues(extensionId, mine)) noteContributionWarning(issue)
  }
  const raw = claimed0.filter((o) => isDeclared(o.extensionId, o.def))
  const claimants = new Map<string, Set<string>>()
  for (const offer of raw) {
    const provider = providerOf(offer.def)
    const set = claimants.get(provider) ?? new Set<string>()
    set.add(offer.extensionId)
    claimants.set(provider, set)
  }
  const conflicts: ProviderConflict[] = []
  for (const [provider, packs] of [...claimants].sort(([a], [b]) => a.localeCompare(b))) {
    if (packs.size < 2) continue
    const extensionIds = [...packs].sort()
    conflicts.push({ provider, extensionIds })
    noteContributionWarning(`provider '${provider}' is claimed by ${extensionIds.map((id) => `'${id}'`).join(' and ')}; none of its connectors is offered until one is disabled`)
  }
  const conflicted = new Set(conflicts.map((c) => c.provider))
  return { offers: raw.filter((o) => !conflicted.has(providerOf(o.def))), conflicts }
}

/**
 * The refusal a connection that was never authorized for a capability answers
 * with - before the provider call, so an operator reads a sentence naming the
 * capability and the connection instead of a provider's opaque 403.
 */
export function capabilityRefusal(input: {
  provider: string
  label: string
  missing: ReturnType<typeof missingCapabilities>
}): RequestError {
  const first = input.missing[0]!
  const names = input.missing.map((m) => `'${m.label}'`).join(', ')
  const undeclared = input.missing.some((m) => m.undeclared)
  const message = undeclared
    ? `Connector '${input.provider}' declares no capability ${input.missing.filter((m) => m.undeclared).map((m) => `'${m.capability}'`).join(', ')}.`
    : `The connection '${input.label}' is not authorized for ${names}. Reconnect it under Settings > Connections and include ${input.missing.length === 1 ? 'that capability' : 'those capabilities'}.`
  return new RequestError('CONNECTION_CAPABILITY', message, 403, undefined, {
    provider: input.provider, capability: first.capability, missing: input.missing,
  })
}

/** The refusal a conflicted provider answers with, everywhere. */
export function providerConflictError(conflict: ProviderConflict): RequestError {
  return new RequestError(
    'PROVIDER_CONFLICT',
    `Provider '${conflict.provider}' is offered by ${conflict.extensionIds.map((id) => `'${id}'`).join(' and ')}. Disable one of them; while both are active none of its connections can be used.`,
    409,
    undefined,
    { provider: conflict.provider, extensionIds: conflict.extensionIds },
  )
}

/**
 * One line of a failure an operator may read: trimmed, and never a token.
 *
 * A message comes from a provider or from a thrown error, so it is treated as
 * text rather than trusted: long output is cut, and anything that looks like
 * material is dropped rather than shown.
 */
export function operatorSafe(message: string | undefined, max = 200): string | undefined {
  if (typeof message !== 'string' || message.trim() === '') return undefined
  const cleaned = message
    .replace(/\b(ya29|xoxb|xoxp|sk_live|sk_test|ghp)[-_][A-Za-z0-9._-]+/g, '<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>')
    .replace(/access_token=[^&\s]+/gi, 'access_token=<redacted>')
    .trim()
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned
}

/**
 * The authed client over one opened connection. `extensionId` null means the
 * platform itself (a member's Settings test): its http carries Tangen's
 * authority; an extension's http carries its facilities plus the connector's
 * hosts - a connection implies its connector's reach, nothing more.
 */
export function connectionClientFor(input: {
  row: ConnectionSummary
  credentials: Record<string, unknown>
  offer: ConnectorOffer
  workspaceId: string
  extensionId: string | null
  facilities?: readonly string[]
  /** When present, OAuth2 tokens about to expire, or refused with a 401, are refreshed and re-sealed here (K6.3). */
  store?: ConnectionsStore
  fetchImpl?: typeof fetch
  lookup?: (host: string) => Promise<string[]>
}): ConnectionClient {
  const { row, offer } = input
  let credentials = input.credentials
  const hosts = offer.def.hosts ?? []
  const grants = [...(input.facilities ?? []), ...hosts.map((h) => `network:${h}`)]
  const http: ExtensionHttp = createExtensionHttp({
    extensionId: input.extensionId ?? `connection:${row.id}`, workspaceId: input.workspaceId,
    // E.14: the platform's own use of a connection reaches the connector's hosts and nothing else; an extension's adds its facilities.
    grants, fetchImpl: input.fetchImpl, lookup: input.lookup,
  })
  /**
   * ONE object, carrying a LIVE view of the material: `credentials` is a
   * getter, so whatever a refresh writes is what a connector reads next.
   *
   * `request` is assigned below rather than spread in later, because a spread
   * EVALUATES the getter and freezes it - which is how a connection whose
   * hour was up came to be reported broken while working perfectly (acme,
   * 2026-09-19): core refreshed, and then handed `health` the dead token,
   * which a connector that builds its own check URL from the material put
   * straight into the provider's query string.
   */
  const conn = {
    id: row.id, connectorId: row.connectorId, label: row.label, kind: row.kind, meta: row.meta,
    get credentials() { return credentials },
    fetch: http,
    request: undefined as unknown as (path: string, init?: RequestInit) => Promise<Response>,
  }
  const auth = offer.def.auth
  // OAuth2 upkeep, the kernel's job: a token about to expire is refreshed
  // before the request; a 401 with a refresh token in hand is refreshed once
  // and the request retried. A provider that refuses the refresh leaves the
  // 401 to the consumer; the material is never touched on failure.
  const canRefresh = () => auth.kind === 'oauth2' && !!input.store && typeof credentials.refreshToken === 'string' && !!credentials.refreshToken
  const refresh = async (): Promise<boolean> => {
    if (!canRefresh() || auth.kind !== 'oauth2') return false
    try {
      const tokens = await refreshAccessToken({
        tokenUrl: auth.tokenUrl, refreshToken: String(credentials.refreshToken),
        clientId: String(credentials.clientId ?? ''), clientSecret: typeof credentials.clientSecret === 'string' ? credentials.clientSecret : undefined,
        fetchImpl: input.fetchImpl,
      })
      credentials = { ...credentials, ...tokens }
      await input.store!.update(row.id, { credentials })
      return true
    } catch {
      return false
    }
  }
  const expiringSoon = () => typeof credentials.expiresAt === 'number' && credentials.expiresAt - Date.now() < OAUTH_REFRESH_SKEW_MS
  const request = async (path: string, init?: RequestInit) => {
    if (typeof offer.def.request !== 'function') throw new RequestError('NOT_IMPLEMENTED', `Connector '${offer.def.id}' declares no request`, 501)
    let refreshed = false
    if (canRefresh() && expiringSoon()) refreshed = await refresh()
    const res = await offer.def.request(conn as never, path, init)
    if (res.status !== 401 || refreshed || !canRefresh()) return res
    if (!(await refresh())) return res
    return offer.def.request(conn as never, path, init)
  }
  // The connector's own `health` calls this, and it must be the refreshing one.
  conn.request = request
  /**
   * A named operation, with the same upkeep a request gets: a token about to
   * expire is refreshed first. There is no retry-on-401 here, because a
   * non-HTTP protocol has no 401 to read - a connector that can tell says so
   * by throwing, and the refresh above is what prevents the common case.
   */
  const invoke = async <T = unknown>(operation: string, payload?: unknown): Promise<T> => {
    const op = offer.def.operations?.[operation]
    if (typeof op !== 'function') {
      throw new RequestError('NOT_IMPLEMENTED', `Connector '${offer.def.id}' declares no operation '${operation}'`, 501)
    }
    if (canRefresh() && expiringSoon()) await refresh()
    return await op(conn as never, payload) as T
  }
  return {
    id: row.id, connectorId: row.connectorId, label: row.label, kind: row.kind, meta: row.meta,
    authorizationKnown: typeof row.meta.scope === 'string' && row.meta.scope.trim() !== '',
    request,
    invoke,
    health: async () => {
      if (typeof offer.def.health !== 'function') return false
      /**
       * Core's OAuth upkeep applies to a CHECK as much as to a request.
       *
       * A connector's cheapest check often takes the token as a parameter
       * rather than a header (Google's `tokeninfo`), so it reads the material
       * BEFORE it calls anything - and refreshing inside the request would
       * then be too late. Found in acme (2026-09-19): a connection whose hour
       * was up ran a flow perfectly and reported "not working" when tested.
       */
      let refreshFailed = false
      if (canRefresh() && expiringSoon()) refreshFailed = !(await refresh())
      // `conn` itself, never a copy: a spread evaluates the `credentials`
      // getter and freezes it, so a refresh would go unseen.
      try {
        const answer = await offer.def.health(conn as never)
        const verdict: { ok: boolean; message?: string; transient?: boolean } = typeof answer === 'boolean' ? { ok: answer } : answer
        if (verdict.ok) return verdict
        // Say which of the two failed. A refusal AFTER a refresh that itself
        // failed is almost always the refresh, and telling an operator "the
        // provider says no" there sends them to the wrong place.
        return {
          ok: false,
          ...(verdict.transient ? { transient: true } : {}),
          ...(verdict.message ? { message: verdict.message }
            : refreshFailed ? { message: 'The provider refused to refresh this connection - reconnect it' }
            : {}),
        }
      } catch (e) {
        // A connector that throws could not REACH the provider - DNS, a
        // socket, a timeout - which says nothing about the credential, so it
        // is transient by default. A connector that means "this credential is
        // dead" returns `{ ok: false }` and says so.
        return { ok: false, transient: true, message: operatorSafe((e as Error)?.message) }
      }
    },
  }
}

export function createExtensionConnections(deps: ExtensionConnectionsDeps): ExtensionConnections {
  const { exec, store } = deps
  const actor = exec.actor
  const extensionId = actor.identity.kind === 'extension' ? actor.identity.id : null
  const holds = (facility: string) => decide(actor, { kind: 'facility', facility }).allow
  const mayUse = (ref: string) => holds(`connections:${ref}`)
  /**
   * A3: to use a capability a consumer holds either the capability grant or
   * the provider grant. The capability grant is the least-privilege one: a
   * pack granted `connections:google.sheets.append` cannot read Gmail through
   * the same connection.
   */
  const mayUseCapability = (provider: string, capability: string) =>
    holds(`connections:${qualifiedCapability(provider, capability)}`) || holds(`connections:${provider}`)

  return {
    async list() {
      const { offers } = resolveConnectorOffers(deps.activeIds)
      const rows = await store.list()
      return rows.filter((r) => {
        if (r.status !== 'active') return false
        const offer = offerForRow(offers, r.connectorId)
        return offer !== undefined && mayUse(providerOf(offer.def))
      })
    },
    async availability(ref) {
      const { offers, conflicts } = resolveConnectorOffers(deps.activeIds)
      const raw = offeredConnectors(deps.activeIds)
      // A ref is either a provider or a qualified capability: the provider is
      // the longest prefix some declaration actually claims, so
      // 'google.sheets.append' resolves to 'google' without guessing at dots.
      const providers = new Set([...raw.map((o) => providerOf(o.def)), ...conflicts.map((c) => c.provider)])
      const provider = [...providers].filter((p) => ref === p || ref.startsWith(`${p}.`)).sort((a, b) => b.length - a.length)[0] ?? ref
      const required = ref === provider ? [] : [ref.slice(provider.length + 1)]
      const conflict = conflicts.find((c) => c.provider === provider)
      const mine = offers.filter((o) => providerOf(o.def) === provider)
      const byStored = new Map(mine.map((o) => [storedConnectorId(o.extensionId, o.def.id), o]))
      const rows = mine.length === 0 ? [] : (await store.list()).filter((r) => byStored.has(r.connectorId))
      return integrationState({
        provider,
        offered: mine.length > 0,
        packs: packsDeclaring(provider, deps.activeIds),
        ...(conflict ? { conflict } : {}),
        connections: rows.map((r) => {
          const offer = byStored.get(r.connectorId)!
          return { id: r.id, label: r.label, verdict: connectionState({ row: r as never, offer: { provider, def: offer.def }, required }) }
        }),
      })
    },
    async get(ref, options) {
      const { offers, conflicts } = resolveConnectorOffers(deps.activeIds)
      // A conflicted provider is a refusal, not an absence: an operator has
      // two packs installed and has to disable one. Silence here would read
      // as "nothing configured" and send them to configure it again.
      const conflict = conflicts.find((c) => c.provider === ref)
      if (conflict) throw providerConflictError(conflict)
      // By PROVIDER first (the contract), then by a connector id, which is
      // what every consumer written before this slice passes.
      const mine = offers.filter((o) => providerOf(o.def) === ref)
      const matched = mine.length > 0 ? mine : offers.filter((o) => o.def.id === ref)
      if (matched.length === 0) return undefined
      const provider = providerOf(matched[0]!.def)
      const wanted = options?.capabilities ?? []
      if (wanted.length > 0) {
        const ungranted = wanted.filter((c) => !mayUseCapability(provider, c))
        if (ungranted.length > 0) {
          throw new RequestError('FORBIDDEN', `This extension is not granted ${ungranted.map((c) => `connections:${qualifiedCapability(provider, c)}`).join(', ')}: declare it in the manifest grants`, 403)
        }
      } else if (!mayUse(ref)) {
        throw new RequestError('FORBIDDEN', `This extension is not granted connections:${ref}: declare it in the manifest grants`, 403)
      }
      // Every auth model of the provider answers, oldest row first, so a
      // provider with an OAuth and a key connection behaves as one provider.
      // Rows of any of the provider's connectors, and any row an active
      // connector adopts from a connector that used to offer it (F2).
      const matchedSet = new Set(matched)
      const rows = (await store.list()).filter((r) => {
        const offer = offerForRow(matched, r.connectorId)
        return offer !== undefined && matchedSet.has(offer) && r.status === 'active'
      })
      // By id (a settings.connection() value), else by label, else the first active one.
      const chosen = options?.id !== undefined ? rows.find((r) => r.id === options.id)
        : options?.label !== undefined ? rows.find((r) => r.label === options.label)
        : rows[0]
      if (!chosen) return undefined
      const offer = offerForRow(matched, chosen.connectorId)!
      // Before the provider call: was this connection ever authorized for what
      // the consumer is about to do? A legacy row (no recorded scope) passes,
      // and says so through `authorizationKnown`.
      if (wanted.length > 0) {
        const missing = missingCapabilities({ def: offer.def, granted: typeof chosen.meta.scope === 'string' ? chosen.meta.scope : null, required: wanted })
        if (missing.length > 0) throw capabilityRefusal({ provider, label: chosen.label, missing })
      }
      const opened = await store.open(chosen.id)
      if (!opened || opened.status === 'unreadable') return undefined
      return connectionClientFor({
        row: opened, credentials: opened.credentials, offer, workspaceId: exec.workspaceId, extensionId,
        facilities: actor.authority.facilities, store, fetchImpl: deps.fetchImpl, lookup: deps.lookup,
      })
    },
  }
}
