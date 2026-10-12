/**
 * File Name: connector.ts
 * Purpose: The two Slack connectors (plan-connectors E1): ONE provider,
 *          `slack`, reached either through an OAuth app or with a bot token an
 *          operator pastes. This is the case the provider-ownership model
 *          exists for - two auth models of one provider coexist, while a
 *          SECOND pack claiming `slack` is a conflict.
 *
 *          They share the provider's capabilities, its hosts, its resource and
 *          its `request`, so nothing downstream can tell them apart: a service
 *          asks for `chat.post` and is handed an authenticated client either
 *          way. The one honest difference is where a refusal comes from - see
 *          the capability comments below.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/cms for types only. No Admin, no React.
 */
import type { ConnectorContext, ConnectorDefinition, ResourcePage, ResourceRequest } from '@tangen/cms'
import { SLACK_CAPABILITIES, SLACK_OAUTH_CONNECTOR, SLACK_PROVIDER, SLACK_TOKEN_CONNECTOR } from './contract'

/** Slack's own hosts, and the only ones a connection of either connector reaches. */
export const SLACK_HOSTS = ['slack.com', 'api.slack.com'] as const

const SCOPE = {
  chatWrite: 'chat:write',
  channelsRead: 'channels:read',
  groupsRead: 'groups:read',
} as const

/**
 * Slack answers 200 with `{ ok: false, error: 'missing_scope' }`, so the HTTP
 * status is not the answer - the body is. A refusal is surfaced with Slack's
 * own error code, because "not_in_channel" and "missing_scope" tell an
 * operator exactly what to do and a paraphrase would not.
 */
export async function readSlack<T>(res: Response, what: string): Promise<T & { ok: true }> {
  const body = await res.json().catch(() => ({ ok: false, error: `a non-JSON answer (${res.status})` })) as { ok?: boolean; error?: string }
  if (!body.ok) throw new Error(`Slack refused to ${what}: ${body.error ?? 'no reason given'}`)
  return body as T & { ok: true }
}

/** Slack's own paging: `cursor` in, `response_metadata.next_cursor` out. */
async function searchChannels(input: ResourceRequest, conn: ConnectorContext): Promise<ResourcePage> {
  const params = new URLSearchParams({
    // Public and private, because an app is invited to either; archived ones
    // would be listed and then refuse the post.
    types: 'public_channel,private_channel',
    exclude_archived: 'true',
    limit: String(input.limit),
  })
  if (input.cursor) params.set('cursor', input.cursor)
  const answer = await readSlack<{
    channels?: Array<{ id: string; name: string; is_private?: boolean; is_member?: boolean; num_members?: number }>
    response_metadata?: { next_cursor?: string }
  }>(await conn.request!(`https://slack.com/api/conversations.list?${params.toString()}`), 'list your channels')

  // Slack's conversations.list has no search: it pages. So the query filters
  // the page, and the cursor is handed back either way - which is why the
  // picker must page rather than expect one answer (E1 acceptance: a
  // workspace with thousands of channels).
  const q = input.query?.trim().toLowerCase().replace(/^#/, '')
  const all = (answer.channels ?? []).map((c) => ({
    id: c.id,
    label: `#${c.name}`,
    ...(c.num_members ? { hint: `${c.num_members} members` } : {}),
    // Listed but not selectable: Slack refuses a post to a public channel the
    // app has not joined, and finding that out at the first run is worse.
    ...(c.is_member === false ? { disabled: { reason: 'The app is not in this channel yet - invite it in Slack first' } } : {}),
  }))
  const matched = q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all
  const next = answer.response_metadata?.next_cursor
  return {
    options: matched,
    ...(next ? { nextCursor: next } : {}),
    // A filtered page that came back empty while Slack has more is not "no
    // channels": the picker says so rather than looking broken.
    ...(q && matched.length === 0 && next ? { truncated: true } : {}),
  }
}

/** Both connectors reach Slack the same way; only the header's source differs. */
const bearer = (conn: ConnectorContext): string =>
  String(conn.credentials.accessToken ?? conn.credentials.botToken ?? '')

const request: ConnectorDefinition['request'] = (conn, path, init) => conn.fetch(path, {
  ...init,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    ...(init?.headers as Record<string, string> | undefined),
    authorization: `Bearer ${bearer(conn)}`,
  },
})

/** `auth.test` needs no scope at all, so any connection is checkable. */
/** Slack errors that are about the CREDENTIAL; anything else is Slack, not you. */
const DEAD_CREDENTIAL = new Set([
  'invalid_auth', 'not_authed', 'account_inactive', 'token_revoked', 'token_expired', 'no_permission',
])

const health: ConnectorDefinition['health'] = async (conn) => {
  let res: Response
  try {
    res = await conn.request!('https://slack.com/api/auth.test', { method: 'POST' })
  } catch (e) {
    return { ok: false, transient: true, message: `Slack could not be reached: ${(e as Error).message}` }
  }
  const body = await res.json().catch(() => ({ ok: false, error: `a non-JSON answer (${res.status})` })) as { ok?: boolean; error?: string }
  if (body.ok === true) return { ok: true }
  const error = body.error ?? 'no reason given'
  // Slack's own code, and what it means: `invalid_auth` is a dead token and a
  // reconnect; `ratelimited` or `fatal_error` is Slack, and the connection is
  // as good as it was.
  if (DEAD_CREDENTIAL.has(error)) return { ok: false, message: `Slack refused this connection: ${error}` }
  return { ok: false, transient: true, message: `Slack could not answer: ${error}` }
}

const resources: ConnectorDefinition['resources'] = {
  channel: { label: 'Channel', capability: SLACK_CAPABILITIES.channelsRead, search: searchChannels },
}

/**
 * Slack's own mark, inline as a data URI (plan-connectors E2), shared by BOTH
 * connectors: an operator recognises the PROVIDER, not the auth model.
 */
export const SLACK_BRAND = {
  icon: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath fill='%2336C5F0' d='M14 20a4 4 0 1 1 4-4h4v4a4 4 0 0 1-4 4h-4zm6-4a4 4 0 0 1 8 0v10a4 4 0 0 1-8 0V16z'/%3E%3Cpath fill='%232EB67D' d='M28 14a4 4 0 1 1 4 4v4h-4a4 4 0 0 1-4-4v-4zm4 6a4 4 0 0 1 0 8H22a4 4 0 0 1 0-8h10z'/%3E%3Cpath fill='%23ECB22E' d='M34 28a4 4 0 1 1-4 4v-4h4zm-6 4a4 4 0 0 1-8 0V22a4 4 0 0 1 8 0v10z'/%3E%3Cpath fill='%23E01E5A' d='M20 34a4 4 0 1 1-4-4h4v4zm-4-6a4 4 0 0 1 0-8h10a4 4 0 0 1 0 8H16z'/%3E%3C/svg%3E`,
  color: '#611F69',
} as const

export const slackOAuthConnector: ConnectorDefinition = {
  id: SLACK_OAUTH_CONNECTOR,
  provider: SLACK_PROVIDER,
  label: 'Slack',
  brand: { ...SLACK_BRAND },
  description: 'Connect a Slack workspace through a Slack app. An operator approves each capability at Slack.',
  auth: {
    kind: 'oauth2',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    // NO PKCE: Slack's v2 endpoint does not implement RFC 7636, so declaring
    // it would advertise a protection that is not there. `state` still binds
    // the callback to the request that started it, which is core's job.
    // Slack also answers 200 with `{ok:false}` on a refusal - core's exchange
    // requires an `access_token` in the body, so that is already a 502 with
    // Slack's own error in it rather than an empty connection.
    // `auth.revoke` takes the token as a form field, which is what RFC 7009
    // revocation sends, so an operator's revoke really does reach Slack.
    revokeUrl: 'https://slack.com/api/auth.revoke',
  },
  hosts: [...SLACK_HOSTS],
  // One Slack scope per capability where Slack has one, so an operator can
  // approve posting without granting a channel listing (the lesson real
  // Google taught in the 2026-09-19 run: consent is per scope).
  capabilities: {
    [SLACK_CAPABILITIES.chatPost]: {
      label: 'Post a message',
      description: 'Post to a channel the app has been invited to. It cannot read messages.',
      scopes: [SCOPE.chatWrite],
    },
    [SLACK_CAPABILITIES.channelsRead]: {
      label: 'List your channels',
      description: 'List and search the channels, so you can pick one. It reads names, not messages.',
      // Two, because Slack splits public from private, and a picker that
      // offered only public channels would look broken in a private workspace.
      scopes: [SCOPE.channelsRead, SCOPE.groupsRead],
    },
  },
  resources,
  request,
  health,
}

export const slackTokenConnector: ConnectorDefinition = {
  id: SLACK_TOKEN_CONNECTOR,
  provider: SLACK_PROVIDER,
  label: 'Slack (bot token)',
  brand: { ...SLACK_BRAND },
  description: 'Connect a Slack workspace with a bot token from your own Slack app. Nothing leaves this deployment to set it up.',
  auth: {
    kind: 'apiKey',
    // One field, and its Slack name, so an operator pasting from Slack's own
    // page knows they have the right string.
    fields: ['botToken'],
  },
  hosts: [...SLACK_HOSTS],
  /**
   * The SAME capabilities, declared with NO scopes - and that is the honest
   * model, not a shortcut.
   *
   * A pasted token's scopes are Slack's business: nothing in the paste says
   * what it may do, and asking Slack at create time would still be a snapshot
   * that a Slack-side edit invalidates. So the platform's check here is the
   * DECLARATION - a capability this connector does not declare is refused
   * before the call, exactly as for OAuth - and the scope check is Slack's,
   * arriving as `missing_scope` in its own words.
   */
  capabilities: {
    [SLACK_CAPABILITIES.chatPost]: {
      label: 'Post a message',
      description: "Post to a channel the app has been invited to. Whether the token allows it is Slack's to say, and it says so at the first attempt.",
    },
    [SLACK_CAPABILITIES.channelsRead]: {
      label: 'List your channels',
      description: "List and search the channels. Whether the token allows it is Slack's to say.",
    },
  },
  resources,
  request,
  health,
}
