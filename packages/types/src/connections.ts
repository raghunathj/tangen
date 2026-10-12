/**
 * File Name: connections.ts
 * Purpose: The connector an extension contributes (Extension Kernel K6,
 *          tasks/plan-extension-kernel.md): what a connection to an outside
 *          service is - how it authenticates, which hosts it reaches, how a
 *          request is made with it, how its health is checked. Core owns the
 *          credentials (sealed at rest) and the lifecycle; the extension
 *          owns the protocol. Contributed under `connectors@1`.
 *
 * Author: Raghunath J
 * License: MIT
 */

export type ConnectorAuth =
  | { kind: 'oauth2'; authorizeUrl: string; tokenUrl: string; scopes?: string[]; pkce?: boolean; /** RFC 7009 revocation endpoint: told, best effort, when an operator revokes the connection. */ revokeUrl?: string }
  | { kind: 'apiKey'; fields: string[] }
  | { kind: 'basic' }

/** What the connector's `request` and `health` receive: the material (kernel-side only) and an http bound to the connector's hosts. */
export interface ConnectorContext {
  id: string
  connectorId: string
  label: string
  kind: ConnectorAuth['kind']
  meta: Record<string, unknown>
  credentials: Record<string, unknown>
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  /** Present for `health`: the authed request. */
  request?: (path: string, init?: RequestInit) => Promise<Response>
}

/**
 * What a manifest DECLARES about a connector, so the CLI's install review and
 * the ownership preflight can see a provider without importing a server entry
 * they have not approved yet. The definition itself (auth URLs, request,
 * health, resources) stays in the server contribution; the kernel validates
 * that the two agree.
 */
export interface ConnectorDeclaration {
  /** `<provider>.<authKind>`, matching the contributed definition's id. */
  id: string
  provider: string
  label?: string
  /** The hosts the connector reaches; must be covered by declared `network:` grants. */
  hosts?: string[]
  /** Connector ids whose connections this one adopts (F2); declared so an operator sees it at install. */
  supersedes?: string[]
  /**
   * How the provider is recognised in a list. Declared in the MANIFEST too,
   * so a catalogue can show a pack that is installed but not enabled - and
   * so an operator sees the mark before any of the pack's code runs.
   */
  brand?: ConnectorBrand
}

/**
 * A named operation a connector performs with the material, for a provider
 * that is NOT HTTP.
 *
 * `request` covers every provider with a REST API: the connector adds its
 * authentication and the platform binds the client to the declared hosts. A
 * provider reached over another protocol - SMTP, a queue, a database - has no
 * path to bind and no header to add, and the credential still must not reach
 * the consumer. So the connector declares operations, the material stays with
 * it, and a consumer calls `conn.invoke('send', message)` under exactly the
 * capability check a request would have had.
 *
 * The input and the answer are the connector's own shape; a consumer that
 * knows the provider (its own pack's service) knows them too.
 */
export type ConnectorOperation = (conn: ConnectorContext, input: unknown) => Promise<unknown>

/**
 * One active pack owns a provider (plan-connectors invariant 4), so enabling a
 * second pack that claims one is refused BEFORE it disrupts anything. Pure, so
 * the CLI, the Admin and a test all reach the same answer.
 * @returns the refusal text, or null when there is no clash.
 */
export function providerOwnershipRefusal(input: {
  /** The pack being installed or enabled. */
  extensionId: string
  /** The providers it declares. */
  declares: readonly string[]
  /** Providers already claimed by ACTIVE packs, by provider id. */
  claimed: Readonly<Record<string, string>>
  /** How many configured connections would go dormant, by provider id. */
  connections?: Readonly<Record<string, number>>
}): string | null {
  const clashes = [...new Set(input.declares)]
    .filter((p) => input.claimed[p] && input.claimed[p] !== input.extensionId)
    .sort()
  if (clashes.length === 0) return null
  const lines = clashes.map((p) => {
    const at = input.connections?.[p] ?? 0
    const risk = at > 0 ? `, and ${at} configured connection${at === 1 ? '' : 's'} would stop working` : ''
    return `  ${p} is already offered by '${input.claimed[p]}'${risk}`
  })
  return [
    `'${input.extensionId}' offers a provider another active extension already owns:`,
    ...lines,
    `While two extensions offer one provider, none of its connections can be used.`,
    `Disable the other extension first: tangen extension disable ${clashes.map((p) => `'${input.claimed[p]}'`).join(' ')}`,
  ].join('\n')
}

/**
 * What a connection may DO, in the vocabulary a consumer uses. A capability is
 * declared provider-relative (`sheets.append`) and qualified by core
 * (`google.sheets.append`); a consumer requires it by name and never types a
 * provider scope string.
 */
export interface ConnectorCapability {
  /** Operator-facing, for the consent checklist: "Add rows". */
  label: string
  description?: string
  /**
   * The provider scopes this capability needs. Omit for an auth kind that has
   * none (an API key, basic auth): the capability is then satisfied by any
   * active connection of the provider, so capability checking reads the same
   * whatever the auth model.
   *
   * These may never broaden silently: widening them puts every existing
   * connection into re-consent (`needs_capability`), which is the point.
   */
  scopes?: string[]
}

/**
 * Where an operator's OAuth client for a provider comes from, when they would
 * rather not paste it into a form. A deployment supplies it once, per provider,
 * and it stays server-side: `CONNECTOR_GOOGLE_CLIENT_ID` /
 * `CONNECTOR_GOOGLE_CLIENT_SECRET` for provider `google`.
 *
 * The OAuth app is still the operator's own - Tangen ships no client
 * credentials - this only changes where they are read from.
 */
export function connectorOAuthEnvNames(provider: string): { clientId: string; clientSecret: string } {
  const slug = provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  return { clientId: `CONNECTOR_${slug}_CLIENT_ID`, clientSecret: `CONNECTOR_${slug}_CLIENT_SECRET` }
}

/** The deployment-registry secret keys for the same thing, for a deployment that uses a secret provider. */
export function connectorOAuthSecretKeys(provider: string): { clientId: string; clientSecret: string } {
  return { clientId: `connectors.${provider}.clientId`, clientSecret: `connectors.${provider}.clientSecret` }
}

/**
 * Whether a connector adopts a connection stored under another id (F2).
 *
 * Pure, and matched on either spelling, because a stored id carries the
 * extension that made it (`ext:seo/google-search-console`) while a
 * declaration reads more naturally without it.
 */
export function connectorSupersedes(
  def: { supersedes?: readonly string[] },
  storedConnectorId: string,
): boolean {
  const bare = /^ext:[^/]+\/(.+)$/.exec(storedConnectorId)?.[1] ?? storedConnectorId
  return (def.supersedes ?? []).some((s) => s === storedConnectorId || s === bare)
}

/** `<provider>.<capability>`: what a grant names and what state is reported against. */
export const qualifiedCapability = (provider: string, capability: string): string => `${provider}.${capability}`

/** The scopes a connection was granted, as a set; null when none was ever recorded. */
export function grantedScopes(granted: string | null | undefined): Set<string> | null {
  if (typeof granted !== 'string' || granted.trim() === '') return null
  return new Set(granted.split(/[\s,]+/).filter(Boolean))
}

export interface MissingCapability {
  capability: string
  label: string
  missingScopes: string[]
  /** The connector declares no such capability: a consumer bug, not a consent gap. */
  undeclared?: true
}

/**
 * Which of the required capabilities a connection is NOT authorized for.
 * Empty means the call may proceed.
 *
 * A connection with no recorded scope is LEGACY: its authorization is
 * unknown, not unrestricted, so nothing is reported missing (it keeps
 * working) and the caller learns the difference from `authorizationKnown`.
 */
export function missingCapabilities(input: {
  def: Pick<ConnectorDefinition, 'capabilities'>
  /** The row's recorded scope (`meta.scope`), or null for a legacy connection. */
  granted: string | null | undefined
  required: readonly string[]
}): MissingCapability[] {
  const declared = input.def.capabilities ?? {}
  const out: MissingCapability[] = []
  for (const capability of input.required) {
    const def = declared[capability]
    if (!def) { out.push({ capability, label: capability, missingScopes: [], undeclared: true }); continue }
    const need = def.scopes ?? []
    if (need.length === 0) continue
    const have = grantedScopes(input.granted)
    if (have === null) continue
    const missingScopes = need.filter((s) => !have.has(s))
    if (missingScopes.length > 0) out.push({ capability, label: def.label ?? capability, missingScopes })
  }
  return out
}

/** What an operator picks inside a connection: a spreadsheet, a tab, a channel. */
export interface ResourceOption {
  id: string
  label: string
  /** One short line: an owner, a path, a count. Never a credential. */
  hint?: string
  /** The parent this option belongs to, when the type declares one. */
  parent?: string
  /** Listed but not selectable, with the reason an operator can read. */
  disabled?: { reason: string }
}

/** What core asks a resource for. `limit` is already clamped when a connector sees it. */
export interface ResourceRequest {
  query?: string
  cursor?: string
  parent?: string
  limit: number
}

/** One page of options. A connector pages with the provider's own cursor. */
export interface ResourcePage {
  options: ResourceOption[]
  /** Opaque, passed back as `cursor`; absent on the last page. */
  nextCursor?: string
  /** The provider had more than it would return for this query. */
  truncated?: boolean
}

/** Core's page cap: a picker asks for at most this many, whatever it requests. */
export const RESOURCE_LIMIT_MAX = 50
/** What a picker gets when it names no limit. */
export const RESOURCE_LIMIT_DEFAULT = 25
/** How long one page is cached, so typing in a picker is not a provider incident. */
export const RESOURCE_CACHE_TTL_MS = 60_000

/**
 * One kind of thing an operator selects inside a connection. `search` is the
 * only code: core owns the credentials, the proxy route, the cap, the cache
 * and the refusals.
 */
export interface ConnectorResource {
  /** Singular, Title Case: "Spreadsheet", "Channel". */
  label: string
  /** The capability listing it needs, provider-relative (`sheets.read`). */
  capability?: string
  /** The resource type whose selected id arrives as `parent` (a tab needs a spreadsheet). */
  parent?: string
  /** Lower than core's cap, when a provider's own page is smaller. */
  maxLimit?: number
  /** Shorter or longer than core's 60s, when a provider's list is volatile or expensive. */
  cacheTtlMs?: number
  search(input: ResourceRequest, conn: ConnectorContext): Promise<ResourcePage>
}

/** Clamp a requested page size to the connector's and core's caps. */
export function resourceLimit(requested: unknown, resource?: Pick<ConnectorResource, 'maxLimit'>): number {
  const n = Number(requested)
  const want = Number.isFinite(n) && n > 0 ? Math.floor(n) : RESOURCE_LIMIT_DEFAULT
  return Math.min(want, resource?.maxLimit ?? RESOURCE_LIMIT_MAX, RESOURCE_LIMIT_MAX)
}

/** What a provider looks like in a list. Never behaviour, only recognition. */
export interface ConnectorBrand {
  /** A `data:image/svg+xml` or `data:image/png;base64` URI, at most 16KB. */
  icon?: string
  /** A CSS hex colour (`#4285F4`): the tile behind the mark, or behind the initial. */
  color?: string
}

/** A brand that is safe to render: a data URI of a known image type, within the cap. */
export const CONNECTOR_BRAND_ICON_MAX = 16 * 1024

export function connectorBrandIconIssue(icon: string): string | null {
  if (!/^data:image\/(svg\+xml|png|webp)[;,]/.test(icon)) {
    return "must be a data: URI of an image (image/svg+xml, image/png or image/webp) - a pack ships its own mark rather than naming a host to fetch it from"
  }
  if (icon.length > CONNECTOR_BRAND_ICON_MAX) return `must be at most ${CONNECTOR_BRAND_ICON_MAX} bytes (got ${icon.length})`
  return null
}

/** A health answer with a reason. `boolean` stays valid: it means "no reason given". */
export interface ConnectorHealth {
  ok: boolean
  /** One line an operator can act on: the provider's own words. Never a credential. */
  message?: string
  /**
   * The provider could not ANSWER - a 5xx, a rate limit, a network error - so
   * this says nothing about the credential. Core keeps the previous verdict
   * and records the attempt, because a provider having a bad ten minutes must
   * not turn a working connection into "Not working" (the user, 2026-09-20:
   * "i assume this is because the service is down").
   */
  transient?: boolean
}

export interface ConnectorDefinition {
  /**
   * `<provider>.<authKind>`: `google.oauth`, `google.service-account`,
   * `slack.token`. Unique within the extension, stored as
   * `ext:<extension>/<id>`. The auth model is always explicit - there is no
   * implicit default - so two connectors of one provider read as siblings.
   */
  id: string
  /**
   * The outside service, and the unit of OWNERSHIP: one active pack owns a
   * provider and every auth model under it (plan-connectors invariant 4).
   * Declared rather than parsed out of the id, so the id stays a label and
   * this is the truth. A connector that declares none is its own provider,
   * which is exactly today's behaviour for every connector written before
   * this field existed.
   */
  provider?: string
  label: string
  description?: string
  auth: ConnectorAuth
  /** The hosts a connection reaches; a consumer's client may reach these and nothing else. */
  hosts: string[]
  /**
   * Connections made under ANOTHER connector's id that this one adopts
   * (plan-connectors F2). When a pack takes over what an extension used to
   * offer for itself - the SEO extension's own `google-search-console`
   * becoming the Google pack's `google.oauth` - the operator's connection must
   * keep working: the same account, the same consent, the same id stored in
   * settings and flows.
   *
   * Adoption is a READ: the row keeps its own stored id and every surface
   * resolves it through here. Nothing is rewritten, so uninstalling the pack
   * leaves exactly what was there before - the row dormant, naming the
   * extension that made it - rather than a half-migrated one.
   *
   * Either spelling is matched: the stored form (`ext:seo/google-search-console`)
   * or the bare connector id.
   */
  supersedes?: string[]
  /**
   * What a connection of this connector may be authorized to do, keyed
   * provider-relative (`sheets.append`). A consumer requires these by name;
   * core maps them to the provider scopes at consent time and verifies them
   * before any provider call.
   */
  capabilities?: Record<string, ConnectorCapability>
  /**
   * How an operator RECOGNISES the provider in a list (the user, 2026-09-19:
   * "add icons of slack and google so that they look different and
   * identifable"). A row of same-looking rows is a row nobody reads.
   *
   * `icon` is the pack's own asset, inline as a `data:` URI so it needs no
   * route, no host and no CSP exception, and is rendered in an `<img>` - where
   * a browser runs no script, whatever the pack put in it. `color` is the
   * fallback tile behind the provider's initial, for a pack that ships no
   * mark, and the tint a catalogue can group by.
   */
  brand?: ConnectorBrand
  /**
   * What an operator can pick inside a connection, keyed by type
   * (`spreadsheet`, `tab`, `channel`). Core proxies the listing so the Admin
   * never sees a credential, and caps, caches and refuses on its behalf.
   */
  resources?: Record<string, ConnectorResource>
  /** Make one authenticated request with a connection. */
  request?: (conn: ConnectorContext, path: string, init?: RequestInit) => Promise<Response>
  /**
   * Named operations for a provider that is not HTTP (SMTP, a queue, a
   * database): the connector does the work with the material, a consumer
   * calls `conn.invoke(name, input)`, and the capability check is the same
   * one a request gets. See `ConnectorOperation`.
   */
  operations?: Record<string, ConnectorOperation>
  /** Whether a connection still works. */
  /**
   * Whether a connection still works - and, when it does not, WHY in the
   * provider's own words.
   *
   * A bare `false` was all a connector could say, so an operator read "The
   * connector reported the connection as not working" and had nothing to act
   * on (the user, 2026-09-20). Returning `{ ok: false, message }` records the
   * provider's answer instead. A message is operator-safe by contract: the
   * provider's words and status, never a credential.
   */
  health?: (conn: ConnectorContext) => Promise<boolean | ConnectorHealth>
}
