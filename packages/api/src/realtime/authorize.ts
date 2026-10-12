/**
 * File Name: authorize.ts
 * Purpose: Who may subscribe to what - topics checked against CURRENT
 *          permissions with the helpers REST and GraphQL use, the
 *          workspace/env prefix the server owns, and the re-check that runs
 *          when a role changes under an open connection.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R1 of tasks/plan-realtime.md (section 4.1 is the
 *          topic table; section 7 names "permission drift on open
 *          connections" as the risk this file exists to close) and the
 *          architecture's sections 30-33: package choice never decides
 *          authorization, the ticket is a snapshot but permissions are not.
 *
 *          Three things are deliberate. First, the client sends a TOPIC
 *          (`objects:post`) and the server builds the channel
 *          (`<workspaceId>/objects:post`) from the ticket, so a
 *          connection cannot name another tenant's channel however the
 *          string is shaped; a topic that contains a slash is refused as
 *          invalid rather than parsed. Porter runs are the one topic scoped to
 *          the workspace rather than an environment, because REST lists them
 *          per workspace; its channel uses `_` in the env segment so the
 *          shape stays one string with three parts.
 *
 *          Second, `object:<id>` can only be checked properly per envelope:
 *          content lives in per-type tables and an id alone does not say
 *          which. So subscribe checks "may read objects at all" and
 *          mayReceive() withholds each envelope whose `typeSlug` the caller
 *          may not read - or which names none, because fail-closed is the
 *          only safe default for a gate. The same gate withholds draft-only
 *          changes (updated, created) from a caller without read_draft,
 *          since "a draft changed" is itself a fact about the draft.
 *
 *          Third, reauthorize() re-reads the truth - the members row, the
 *          env override, the API key row - not the in-process cache that
 *          just got invalidated, and drops every subscription the fresh
 *          bundle no longer allows. Extension channels (`ext:`) open by the
 *          manifest declaration (R4, extension-channels.ts); the Studio
 *          topic landed in R3.
 *
 *          R2 added the admin topics the full bridge table feeds. Each is
 *          gated by what the matching REST surface requires: `members`,
 *          `apikeys` and `webhooks` by the manage capability (members only,
 *          never a key); `forms` and `forms:<id>` by the Forms extension's
 *          forms:submissions capability (members only); `media` by the
 *          media read action, which a key may hold like GET /media.
 *          Workspace-scoped topics (`members`, `releases`, `porter:runs`,
 *          `migration:<runId>`) use the `_` env segment because REST lists
 *          those rows per workspace.
 */
import { eq, and, isNull } from 'drizzle-orm'
import type { ApiKeyPermissions, WorkspaceProject } from '@tangen/types'
// The object-read gate comes from @tangen/types, NOT from @tangen/graphql.
// It used to come from there, which resolved the whole GraphQL package at boot
// in every process and undid the lazy import routes/graphql.ts arranges.
import { isNoAccessRole, checkBundle, canReadType, canReadDraftsType } from '@tangen/types'
import { members, apiKeys } from '@tangen/db'
import { hasCapability } from '../lib/member-access'
import { isSuperAdmin } from '../lib/workspace-boundary'
import { resolveMemberPermissions } from '../middleware/auth'
import type { RealtimeEnvelope } from './router'
import { getExtensionChannel } from './extension-channels'

export type EffectivePermissions = ApiKeyPermissions | { admin: true }

/** A connection's identity: the ticket's claims plus the permissions in force. */
export interface RealtimeIdentity {
  workspaceId: string
  memberId: string | null
  apiKeyId: string | null
  memberRole: string | null
  authMode: 'member' | 'api_key'
  /**
   * R5: the site member behind a `site-key` ticket. The connection holds the
   * key's grants (authMode stays `api_key`: the key is the permission
   * source, and every key rule applies), and this names who is listening.
   */
  siteUserId?: string | null
  permissions: EffectivePermissions
}

export type RefusalReason =
  | 'forbidden' | 'members_only' | 'invalid_topic' | 'unknown_topic' | 'not_declared'
  | 'extension_inactive' | 'unsupported'

export type TopicDecision = { ok: true } | { ok: false; reason: RefusalReason }

/** Close code when the identity behind a connection no longer resolves. */
export const CLOSE_REVOKED = 4403

/** ACTIVE in a scope, synchronously (true, false, or null when not yet known). Boot sets it from the extension gate. */
let _extensionActivity: ((extensionId: string, workspaceId: string) => boolean | null) | null = null
export function setRealtimeExtensionActivity(fn: ((extensionId: string, workspaceId: string) => boolean | null) | null): void {
  _extensionActivity = fn
}

const TOPIC_RE = /^[a-z][a-z0-9_-]*(?::[A-Za-z0-9_.-]+)*$/
const TOPIC_MAX = 200

// ── Channels and topics ───────────────────────────────────────────────────────

/** The channel a topic lives on for this identity: the workspace from the ticket, then the topic. */
export function channelFor(identity: Pick<RealtimeIdentity, 'workspaceId'>, topic: string): string {
  return `${identity.workspaceId}/${topic}`
}

/** The topic of a channel: everything after the first slash. */
export function topicOf(channel: string): string {
  const first = channel.indexOf('/')
  return first === -1 ? channel : channel.slice(first + 1)
}

/** Splits a topic into its kind and the colon-separated rest, or null when it is not a topic. */
export function parseTopic(topic: string): { kind: string; rest: string[] } | null {
  if (typeof topic !== 'string' || topic.length === 0 || topic.length > TOPIC_MAX) return null
  if (!TOPIC_RE.test(topic)) return null
  const [kind, ...rest] = topic.split(':')
  return { kind: kind!, rest }
}

// ── Subscribe-time decision ───────────────────────────────────────────────────

const isAdmin = (p: EffectivePermissions) => 'admin' in p && p.admin === true

function canReadAnyObjects(p: EffectivePermissions): boolean {
  if (isAdmin(p)) return true
  const objects = (p as ApiKeyPermissions).objects
  if (!objects) return false
  if (objects.actions?.includes('read')) return true
  return Object.values(objects.types ?? {}).some((actions) => actions.includes('read'))
}

function capability(identity: RealtimeIdentity, cap: string): TopicDecision {
  if (!identity.memberId && !isAdmin(identity.permissions)) return { ok: false, reason: 'members_only' }
  const ctx = { permissions: identity.permissions as never, memberId: identity.memberId }
  return hasCapability(ctx, cap as never) ? { ok: true } : { ok: false, reason: 'forbidden' }
}

/**
 * May this identity subscribe to the topic, as its permissions stand now?
 * @param identity - The connection's identity with current permissions.
 * @param topic - The client's topic, never a channel.
 */
export function authorizeTopic(identity: RealtimeIdentity, topic: string): TopicDecision {
  const parsed = parseTopic(topic)
  if (!parsed) return { ok: false, reason: 'invalid_topic' }
  const { kind, rest } = parsed
  switch (kind) {
    case 'objects':
      if (rest.length !== 1) return { ok: false, reason: 'invalid_topic' }
      return canReadType(identity.permissions, rest[0]!) ? { ok: true } : { ok: false, reason: 'forbidden' }
    case 'object':
      if (rest.length !== 1) return { ok: false, reason: 'invalid_topic' }
      return canReadAnyObjects(identity.permissions) ? { ok: true } : { ok: false, reason: 'forbidden' }
    case 'jobs':
      if (rest.length !== 0) return { ok: false, reason: 'invalid_topic' }
      return capability(identity, 'manage:cron')
    case 'porter':
      if (rest.length !== 1 || rest[0] !== 'runs') return { ok: false, reason: 'invalid_topic' }
      return capability(identity, 'porter:read')
    case 'system':
      if (rest.length !== 0) return { ok: false, reason: 'invalid_topic' }
      return identity.memberId || isAdmin(identity.permissions) ? { ok: true } : { ok: false, reason: 'members_only' }
    case 'media':
      // Media read is a bundle action a key may hold too, like GET /media.
      if (rest.length !== 0) return { ok: false, reason: 'invalid_topic' }
      return checkBundle(identity.permissions as never, 'read', 'media') ? { ok: true } : { ok: false, reason: 'forbidden' }
    case 'forms':
      // `forms` for every form, `forms:<id>` for one; a submission is a fact
      // about submissions, so the gate is the Forms extension's submissions
      // capability (members only, because submissions are).
      if (rest.length > 1) return { ok: false, reason: 'invalid_topic' }
      return capability(identity, 'forms:submissions')
    case 'members':
      if (rest.length !== 0) return { ok: false, reason: 'invalid_topic' }
      return capability(identity, 'manage:members')
    case 'apikeys':
      if (rest.length !== 0) return { ok: false, reason: 'invalid_topic' }
      return capability(identity, 'manage:apiKeys')
    case 'webhooks':
      if (rest.length !== 0) return { ok: false, reason: 'invalid_topic' }
      return capability(identity, 'manage:webhooks')
    case 'presence':
      if (rest.length === 0) return { ok: false, reason: 'invalid_topic' }
      return authorizeTopic(identity, rest.join(':'))
    case 'ext': {
      // R4: `ext:<extensionId>:<name>` opens only when the extension's
      // manifest declares the channel - by the declared capability, else to
      // any member. Keys never subscribe: extension channels are an admin
      // surface, and a site gets its own topics (`objects:`, `object:`).
      if (rest.length !== 2) return { ok: false, reason: 'invalid_topic' }
      const declared = getExtensionChannel(rest[0]!, rest[1]!)
      if (!declared) return { ok: false, reason: 'not_declared' }
      // Phase 4: a channel of an extension that is not active in this
      // workspace x environment is closed (disabled, uninstalled, blocked).
      if (_extensionActivity?.(rest[0]!, identity.workspaceId) === false) return { ok: false, reason: 'extension_inactive' }
      if (declared.capability) return capability(identity, declared.capability)
      return identity.memberId || isAdmin(identity.permissions) ? { ok: true } : { ok: false, reason: 'members_only' }
    }
    case 'migration':
      // One run's progress; the same gate as the runs list it belongs to.
      if (rest.length !== 1) return { ok: false, reason: 'invalid_topic' }
      return capability(identity, 'porter:read')
    case 'releases':
      if (rest.length !== 0) return { ok: false, reason: 'invalid_topic' }
      return capability(identity, 'porter:read')
    case 'studio':
      // R3: `studio:<objectId>` (publish.* and design changes on one page) and
      // `studio:classes` (the workspace class library), both behind the Studio
      // editing capability the extension declares.
      if (rest.length !== 1) return { ok: false, reason: 'invalid_topic' }
      return capability(identity, 'studio:edit')
    default:
      return { ok: false, reason: 'unknown_topic' }
  }
}

// ── Dispatch-time gate ────────────────────────────────────────────────────────

const DRAFT_ONLY_TYPES = new Set(['object.updated', 'object.created'])

/**
 * May this identity receive this particular envelope on a channel it holds?
 * Object envelopes are re-checked by the type they name; everything else
 * was fully decided at subscribe time.
 */
export function mayReceive(identity: RealtimeIdentity, envelope: RealtimeEnvelope): boolean {
  if (!envelope.type.startsWith('object.') && !envelope.type.startsWith('publish.')) return true
  if (isAdmin(identity.permissions)) return true
  const typeSlug = envelope.data.typeSlug
  if (typeof typeSlug !== 'string' || !typeSlug) return false
  if (!canReadType(identity.permissions, typeSlug)) return false
  if (DRAFT_ONLY_TYPES.has(envelope.type) && !canReadDraftsType(identity.permissions, typeSlug)) return false
  return true
}

// ── Re-check on permission change ─────────────────────────────────────────────

/** What reauthorize needs of a connection; the transport's connection satisfies it. */
export interface ReauthorizableConnection {
  identity: RealtimeIdentity
  channels(): string[]
  unsubscribe(channel: string, reason: RefusalReason): void
  close(code: number, reason: string): void
}

/**
 * Applies freshly loaded permissions to an open connection: installs them,
 * drops every subscription they no longer allow, closes the connection when
 * the identity resolved to nothing.
 */
export function reauthorize(
  conn: ReauthorizableConnection,
  fresh: EffectivePermissions | null,
): { dropped: string[]; closed: boolean } {
  if (!fresh) {
    conn.close(CLOSE_REVOKED, 'revoked')
    return { dropped: [], closed: true }
  }
  conn.identity.permissions = fresh
  const dropped: string[] = []
  for (const channel of conn.channels()) {
    const decision = authorizeTopic(conn.identity, topicOf(channel))
    if (!decision.ok) {
      conn.unsubscribe(channel, decision.reason)
      dropped.push(channel)
    }
  }
  return { dropped, closed: false }
}

export interface PermissionLoaderDeps {
  db: any
  redis: any
  projects: () => WorkspaceProject[]
}

/**
 * Loads the permissions an identity holds RIGHT NOW, from the rows rather
 * than from any cache: the members row for the base role, the env override
 * on top, the API key row as it stands. Null means the identity is gone
 * (member deleted, key revoked or expired, `none` in this environment).
 */
export async function loadIdentityPermissions(
  deps: PermissionLoaderDeps,
  identity: RealtimeIdentity,
): Promise<EffectivePermissions | null> {
  if (identity.authMode === 'api_key') {
    if (!identity.apiKeyId) return null
    const [key] = await deps.db.select().from(apiKeys)
      .where(and(eq(apiKeys.id, identity.apiKeyId), eq(apiKeys.workspaceId, identity.workspaceId), isNull(apiKeys.revokedAt)))
      .limit(1)
    if (!key) return null
    if (key.revokedAt) return null
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) return null
    return key.permissions as ApiKeyPermissions
  }

  if (!identity.memberId) return null
  const [member] = await deps.db.select().from(members)
    .where(and(eq(members.id, identity.memberId), eq(members.workspaceId, identity.workspaceId)))
    .limit(1)
  if (!member) return null
  const baseRole = String(member.role ?? 'viewer')
  const effective = baseRole
  if (isNoAccessRole(effective) && !isSuperAdmin(baseRole)) return null
  const project = deps.projects().find((p) => p.workspaceId === identity.workspaceId)
  return resolveMemberPermissions(deps.db, deps.redis, identity.workspaceId, effective, project, identity.memberId) as Promise<EffectivePermissions>
}
