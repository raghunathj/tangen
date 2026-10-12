/**
 * File Name: actor.ts
 * Purpose: The one place a credential becomes an ActorContext (kernel plan
 *          §4, §5): a member session, an API key, a site user, or an
 *          explicit system reason. Authority is stated in full here, once,
 *          so that policy, attribution, locale checks and hooks never
 *          derive it from the presence or absence of a member id.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A key's stored document is sanitized on the way in
 *          (K0: it never carries the admin sentinel). The adapters at the
 *          bottom hand the old decorations (memberId / apiKeyId / memberRole /
 *          permissions) and the hook actor shape to code that has not yet
 *          moved to the execution; they are the migration seam, not the API.
 */
import type { ActorContext, ActorIdentity, ApiKeyPermissions, MemberPermissions, LocaleScope, ExecutionContext, ActorKind } from '@tangen/types'
import { sanitizeApiKeyPermissions } from '../lib/api-key-permissions'
import { compileGrants } from './grants'

type Bundle = ApiKeyPermissions | MemberPermissions | { admin: true }

function isAdminSentinel(p: unknown): boolean {
  return !!p && typeof p === 'object' && (p as { admin?: unknown }).admin === true
}

/** A member session: the role's bundle, the admin fast path as a flag, superadmin as the cross-workspace flag. */
export function memberActor(input: {
  memberId: string
  role: string | null | undefined
  workspaceId: string
  permissions: Bundle | null | undefined
}): ActorContext {
  const p = (input.permissions ?? {}) as MemberPermissions & { admin?: boolean }
  const admin = isAdminSentinel(p)
  const { admin: _admin, ...bundle } = p
  const locales: LocaleScope = admin ? 'all' : (bundle.locales ?? 'all')
  return {
    identity: { kind: 'member', id: input.memberId },
    workspaceId: input.workspaceId,
    role: input.role ?? null,
    authority: {
      bundle: bundle as MemberPermissions,
      admin,
      superadmin: input.role === 'superadmin',
      capabilities: admin ? [] : [...(bundle.capabilities ?? [])],
      locales,
    },
    onBehalfOf: null,
    reason: null,
  }
}

/** An API key: grants only, never a fast path, base-locale writes unless the key says otherwise. */
export function apiKeyActor(input: {
  apiKeyId: string
  workspaceId: string
  permissions: unknown
  /** The member behind a Playground call, or the site user behind a site key. */
  onBehalfOf?: ActorIdentity | null
}): ActorContext {
  const bundle = sanitizeApiKeyPermissions(input.permissions)
  return {
    identity: { kind: 'api_key', id: input.apiKeyId },
    workspaceId: input.workspaceId,
    role: null,
    authority: { bundle, admin: false, superadmin: false, capabilities: [], locales: bundle.locales ?? 'base' },
    onBehalfOf: input.onBehalfOf ?? null,
    reason: null,
  }
}

/**
 * A service or agent identity (K8): grants in the key model and
 * capabilities in the member model, from its record. A key is only its
 * credential; the identity is what acts, is checked and is attributed.
 * `onBehalfOf` records the member an agent says it acts for - attribution
 * and audit, never the member's authority.
 */
export function identityActor(input: {
  identity: { id: string; kind: 'service' | 'agent'; permissions: unknown; capabilities?: string[] | null }
  workspaceId: string
  onBehalfOf?: ActorIdentity | null
}): ActorContext {
  const bundle = sanitizeApiKeyPermissions(input.identity.permissions)
  return {
    identity: { kind: input.identity.kind, id: input.identity.id },
    workspaceId: input.workspaceId,
    role: null,
    authority: { bundle, admin: false, superadmin: false, capabilities: Array.isArray(input.identity.capabilities) ? [...input.identity.capabilities] : [], locales: bundle.locales ?? 'base' },
    onBehalfOf: input.onBehalfOf ?? null,
    reason: null,
  }
}

/** Whether an actor kind is a record with an id that the audit columns store (a member, a key, an identity). */
export function isRecordedKind(kind: ActorKind): boolean {
  // K8.5: an extension acting under its own execution is attributed by id, like a key or an agent.
  return kind === 'member' || kind === 'api_key' || kind === 'service' || kind === 'agent' || kind === 'extension'
}

/** A site user acting through application code: no CMS grants of their own. */
export function siteUserActor(input: { userId: string; workspaceId: string }): ActorContext {
  return {
    identity: { kind: 'site_user', id: input.userId },
    workspaceId: input.workspaceId,
    role: null,
    authority: { bundle: {}, admin: false, superadmin: false, capabilities: [], locales: 'base' },
    onBehalfOf: null,
    reason: null,
  }
}

/**
 * Tangen itself, for work where the framework holds the authority
 * (retention, reindexing, Porter, the CLI, site-code jobs with no human
 * behind them). Explicit, with a reason, never the absence of an actor.
 */
/**
 * An extension acting as ITSELF (Extension Kernel K1.1): the authority is the
 * bundle compiled from the grants it was approved for - never the admin fast
 * path, never Tangen's own authority - so every guard refuses it exactly as it
 * refuses a key. Unknown grants fail closed: construction throws rather than
 * dropping them. `onBehalfOf` is attribution only; it never widens authority.
 */
export function extensionActor(input: {
  extensionId: string
  workspaceId: string
  grants: readonly string[]
  onBehalfOf?: ActorIdentity | null
}): ActorContext {
  const id = typeof input.extensionId === 'string' ? input.extensionId.trim() : ''
  if (!id) throw new Error('An extension actor needs the extension id')
  const compiled = compileGrants(input.grants)
  if (compiled.unknown.length) throw new Error(`Unknown grant${compiled.unknown.length > 1 ? 's' : ''} for extension "${id}": ${compiled.unknown.join(', ')}`)
  const bundle = sanitizeApiKeyPermissions(compiled.bundle)
  return {
    identity: { kind: 'extension', id },
    workspaceId: input.workspaceId,
    role: null,
    authority: { bundle, admin: false, superadmin: false, capabilities: compiled.capabilities, locales: compiled.locales ?? 'base', facilities: [...compiled.facilities].sort() },
    onBehalfOf: input.onBehalfOf ?? null,
    reason: `extension:${id}`,
  }
}

export function systemActor(input: { workspaceId: string; reason: string }): ActorContext {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (!reason) throw new Error('A system actor needs a reason (scheduler, release, porter, cli, job:<id>, extension:<id>)')
  return {
    identity: { kind: 'system', id: reason },
    workspaceId: input.workspaceId,
    role: null,
    authority: { bundle: {}, admin: true, superadmin: false, capabilities: [], locales: 'all' },
    onBehalfOf: null,
    reason,
  }
}

// ── Adapters for code that still reads the old decorations ───────────────────

/** The request decorations a guard used to read, or the execution when the caller has one. */
export interface LegacyIdentityContext {
  exec?: ExecutionContext | null
  memberId?: string | null
  apiKeyId?: string | null
  memberRole?: string | null
  permissions?: unknown
  workspaceId?: string | null
  /** K8: the identity a credential belongs to, when the request acts as one. */
  identity?: { id: string; kind: string; permissions: unknown; capabilities?: string[] | null } | null
}

/**
 * The actor behind a context that predates the execution: the execution's
 * own actor when there is one, else the member or key the decorations name.
 * A bare bundle with no identity (a synthetic context) becomes a
 * credential-less actor: its grants speak, the admin sentinel keeps the
 * grant fast path it always had here, and it never holds a capability.
 * This is the ONE place the decorations are read; every rule is keyed on the
 * actor it returns.
 */
export function actorFromContext(ctx: LegacyIdentityContext | null | undefined): ActorContext | null {
  if (!ctx) return null
  if (ctx.exec?.actor) return ctx.exec.actor
  const workspaceId = String(ctx.workspaceId ?? '')
  if (ctx.memberId) return memberActor({ memberId: ctx.memberId, role: ctx.memberRole ?? null, workspaceId, permissions: ctx.permissions as Bundle })
  // K8: a credential of an identity decorates the request with the identity.
  if (ctx.identity && (ctx.identity.kind === 'service' || ctx.identity.kind === 'agent')) return identityActor({ identity: ctx.identity as never, workspaceId })
  if (ctx.apiKeyId) return apiKeyActor({ apiKeyId: ctx.apiKeyId, workspaceId, permissions: ctx.permissions })
  if (ctx.permissions && typeof ctx.permissions === 'object') {
    const bundle = sanitizeApiKeyPermissions(ctx.permissions)
    return {
      identity: { kind: 'api_key', id: '' },
      workspaceId, role: null,
      authority: { bundle, admin: isAdminSentinel(ctx.permissions), superadmin: false, capabilities: [], locales: bundle.locales ?? 'base' },
      onBehalfOf: null, reason: null,
    }
  }
  return null
}

/** The id the audit columns store today: a member's, a key's, or null. */
export function attributionIdOf(actor: ActorContext | null | undefined): string | null {
  if (!actor) return null
  return isRecordedKind(actor.identity.kind) ? actor.identity.id : null
}

/** The ContentHookCtx.actor shape (C2), as hooks have always seen it. */
export function hookActorOf(actor: ActorContext | null | undefined): { memberId?: string; apiKeyId?: string; role?: string; source: 'admin' | 'rest' | 'system' } {
  if (actor?.identity.kind === 'member') return { memberId: actor.identity.id, ...(actor.role ? { role: actor.role } : {}), source: 'admin' }
  if (actor?.identity.kind === 'api_key') return { apiKeyId: actor.identity.id, source: 'rest' }
  if (actor?.identity.kind === 'service' || actor?.identity.kind === 'agent') return { identityId: actor.identity.id, identityKind: actor.identity.kind, source: 'rest' } as never
  return { source: 'system' }
}

/** The four request decorations the routes read today, derived from the actor. */
export function legacyIdentityOf(actor: ActorContext): {
  memberId: string | null; apiKeyId: string | null; memberRole: string | null; permissions: Bundle
} {
  const member = actor.identity.kind === 'member'
  return {
    memberId: member ? actor.identity.id : null,
    // K8: an identity is the non-member actor the routes attribute to; the decoration keeps its old name.
    apiKeyId: actor.identity.kind === 'api_key' || actor.identity.kind === 'service' || actor.identity.kind === 'agent' ? actor.identity.id : null,
    memberRole: member ? actor.role : null,
    // The fast path the routes read as the sentinel: a member's admin, or Tangen's own authority.
    permissions: actor.authority.admin ? { admin: true } : actor.authority.bundle,
  }
}
