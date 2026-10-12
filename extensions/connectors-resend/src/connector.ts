/**
 * File Name: connector.ts
 * Purpose: The Resend connector: provider `resend`, one auth model - an API
 *          key an operator pastes. The smallest honest shape a pack can have,
 *          and the point of building it is that EMAIL becomes a connection an
 *          operator manages, tests and revokes on the Connections page, rather
 *          than a value in a deployment's environment (the user, 2026-09-20).
 *
 *          What that buys, all of it from the platform rather than from here:
 *          the key is sealed at rest and never shown again, a Test says
 *          whether Resend accepts it, a capability this connector does not
 *          declare is refused before Resend is called, the connection reaches
 *          Resend's host and nothing else, and every consumer - a Flow, a form
 *          destination - is handed an authenticated client instead of a key.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/cms for types only. No Admin, no React.
 */
import type { ConnectorContext, ConnectorDefinition, ResourcePage, ResourceRequest } from '@tangen/cms'
import { RESEND_CAPABILITIES, RESEND_CONNECTOR, RESEND_PROVIDER } from './contract'

/** Resend's API host, and the only one a connection of this connector reaches. */
export const RESEND_HOSTS = ['api.resend.com'] as const

export const RESEND_API = 'https://api.resend.com'

/**
 * Resend answers JSON with an `{ name, message }` error object and a real
 * HTTP status, so unlike Slack the status IS part of the answer. The message
 * is surfaced unchanged: "The acme.test domain is not verified" tells an
 * operator exactly what to do, and a paraphrase would not.
 */
export async function readResend<T>(res: Response, what: string): Promise<T> {
  const body = await res.json().catch(() => null) as { name?: string; message?: string } | T | null
  if (res.ok) return (body ?? {}) as T
  const detail = (body as { message?: string } | null)?.message
    ?? (body as { name?: string } | null)?.name
    ?? `${res.status} ${res.statusText}`
  throw new Error(`Resend refused to ${what}: ${detail}`)
}

/** The key rides as a bearer token; the connector adds it, nobody else sees it. */
const request: ConnectorDefinition['request'] = (conn, path, init) => conn.fetch(path, {
  ...init,
  headers: {
    'content-type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
    authorization: `Bearer ${String(conn.credentials.apiKey ?? '')}`,
  },
})

/**
 * The verified domains, as a RESOURCE - so a From address is picked from what
 * the account can actually send as, rather than typed and discovered to be
 * unverified at the first send.
 *
 * An unverified domain is listed and NOT selectable, with Resend's status as
 * the reason: seeing it greyed out is how an operator learns the verification
 * is still pending.
 */
async function searchDomains(input: ResourceRequest, conn: ConnectorContext): Promise<ResourcePage> {
  const answer = await readResend<{ data?: Array<{ id: string; name: string; status?: string; region?: string }> }>(
    await conn.request!(`${RESEND_API}/domains`), 'list your domains',
  )
  const q = input.query?.trim().toLowerCase()
  const all = (answer.data ?? []).map((d) => ({
    id: d.name,
    label: d.name,
    ...(d.region ? { hint: d.region } : {}),
    ...(d.status && d.status !== 'verified'
      ? { disabled: { reason: `Resend says this domain is ${d.status} - it cannot send until it is verified` } }
      : {}),
  }))
  const matched = q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all
  return { options: matched.slice(0, Math.max(1, input.limit)) }
}

/**
 * A key that Resend has revoked, or was never valid, is the operator's to fix
 * (paste a new one); a 429 or a 5xx is Resend's, and the connection is as good
 * as it was - so one is a failure and the other is transient.
 */
const health: ConnectorDefinition['health'] = async (conn) => {
  let res: Response
  try {
    // `/domains` is the cheapest authenticated read Resend has, and it needs
    // no send permission: a send-only key answers 401/403 here, which is why
    // the verdict below reads a 403 as "the key is real but narrow" rather
    // than as a dead credential.
    res = await conn.request!(`${RESEND_API}/domains`)
  } catch (e) {
    return { ok: false, transient: true, message: `Resend could not be reached: ${(e as Error).message}` }
  }
  if (res.ok) return { ok: true }
  if (res.status === 401) return { ok: false, message: 'Resend refused this API key. Paste a current one to reconnect.' }
  if (res.status === 403) {
    // The key authenticated and is not allowed to list domains. Sending may
    // still work, so this is not a dead connection.
    return { ok: true, message: 'The key works. It may not list domains, so pick the From domain by hand.' }
  }
  if (res.status === 429) return { ok: false, transient: true, message: 'Resend is rate limiting this account right now.' }
  const detail = await res.text().catch(() => '')
  return { ok: false, transient: res.status >= 500, message: `Resend answered ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` }
}

/** Resend's own mark, inline as a data URI (plan-connectors E2). */
export const RESEND_BRAND = {
  icon: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='10' fill='%23000'/%3E%3Cpath fill='%23fff' d='M15 13h10.6c4.6 0 7.4 2.4 7.4 6.3 0 2.9-1.6 5-4.3 5.8L34 35h-5.9l-4.6-8.6h-3.1V35H15V13zm5.4 4.2v5.4h4.6c1.9 0 3-1 3-2.7 0-1.8-1.1-2.7-3-2.7h-4.6z'/%3E%3C/svg%3E`,
  color: '#000000',
} as const

export const resendConnector: ConnectorDefinition = {
  id: RESEND_CONNECTOR,
  provider: RESEND_PROVIDER,
  label: 'Resend',
  brand: { ...RESEND_BRAND },
  description: 'Send email through Resend with an API key from your Resend account. The key is sealed here and never shown again.',
  auth: {
    kind: 'apiKey',
    // One field, under Resend's own name for it, so an operator pasting from
    // Resend's dashboard knows they have the right string.
    fields: ['apiKey'],
  },
  hosts: [...RESEND_HOSTS],
  /**
   * Declared with no scopes, which is the honest model rather than a
   * shortcut: a pasted key carries no statement of what it may do, and asking
   * Resend at create time would be a snapshot that a dashboard edit
   * invalidates. So the platform's check is the DECLARATION - a capability
   * this connector does not declare is refused before Resend is called - and
   * the permission check is Resend's, arriving in its own words.
   */
  capabilities: {
    [RESEND_CAPABILITIES.emailSend]: {
      label: 'Send email',
      description: 'Send email from a domain this account has verified. It cannot read anything you have sent.',
    },
    [RESEND_CAPABILITIES.domainsRead]: {
      label: 'List your verified domains',
      description: 'List the domains the account may send from, so a From address can be picked rather than typed.',
    },
  },
  resources: {
    domain: { label: 'Sending domain', capability: RESEND_CAPABILITIES.domainsRead, search: searchDomains },
  },
  request,
  health,
}
