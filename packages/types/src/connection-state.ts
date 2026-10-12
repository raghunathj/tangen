/**
 * File Name: connection-state.ts
 * Purpose: ONE derivation of what a connection and an integration are worth,
 *          for every surface that has to say so (plan-connectors B1): the
 *          Admin's Connections page, an extension's settings form, the Flows
 *          builder, `ctx.connections.availability`, a typed service's error
 *          text, `tangen doctor --deployment` and the CLI. Written in the
 *          shape extension-review.ts established: pure functions over plain
 *          data, so five surfaces cannot disagree about why an integration is
 *          unavailable, and none of them recomputes a state of its own.
 *
 *          Every state here is DERIVED from what is already stored - a row's
 *          status, its health, the scope it recorded at consent, whether a
 *          pack is active, whether two packs claim its provider - so nothing
 *          in this module needs a migration.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: ./connections only. No I/O.
 */
import { missingCapabilities, type ConnectorDefinition, type MissingCapability } from './connections'

/** What one configured connection IS. */
export type ConnectionState =
  /** An OAuth flow was started and the provider has not answered yet. */
  | 'pending'
  /** Usable now. */
  | 'connected'
  /** Usable, but never authorized for something a consumer requires. */
  | 'needs_capability'
  /** Usable as far as we know, but the last health check failed. */
  | 'degraded'
  /** An operator revoked it; the material is gone. */
  | 'revoked'
  /** The deployment's connections key cannot open it. */
  | 'unreadable'
  /** Nothing active owns its connector, so it cannot be used. Its material is kept. */
  | 'dormant'

/** Whether a FEATURE can work here, and what an operator would do about it. */
export type IntegrationState =
  /** Nothing installed offers the provider. */
  | 'pack_absent'
  /** A pack that offers it is installed but not enabled here. */
  | 'pack_disabled'
  /** Two active packs offer it, so none of it resolves. */
  | 'provider_conflict'
  /** Offered, and no usable connection exists yet. */
  | 'not_configured'
  /** A connection is mid-authorization. */
  | 'needs_authorization'
  /** A connection exists but was not authorized for what this feature needs. */
  | 'needs_capability'
  /** Connected, and the last health check failed. */
  | 'degraded'
  /** Usable now. */
  | 'ready'

/** The one thing an operator should do next. `hint` is a sentence, not a label. */
export interface OperatorFix {
  action: 'install_pack' | 'enable_pack' | 'disable_pack' | 'connect' | 'finish_authorization' | 'reconnect' | 'test'
  hint: string
  /** The packs the fix is about, when it names any. */
  extensionIds?: string[]
}

/**
 * Which heading a connection belongs under in a catalogue (plan-connectors
 * E2). Derived HERE, with the state, so a page groups by reading rather than
 * by deciding: a surface that re-sorted the states itself would be a second
 * opinion on what "needs attention" means, and they would drift.
 */
export type ConnectionGroup = 'connected' | 'attention' | 'dormant' | 'conflicted'

export interface ConnectionVerdict {
  state: ConnectionState
  /** The heading it belongs under. One rule, in one place. */
  group: ConnectionGroup
  /** Operator-safe: names, never values. */
  reason: string
  fix?: OperatorFix
  /**
   * False when the connection recorded no scope: LEGACY authorization, which
   * is unknown rather than unrestricted. It keeps working; a reconnect is what
   * makes it known.
   */
  authorizationKnown: boolean
  /** Capabilities it was never authorized for, when any were required. */
  missing: MissingCapability[]
}

export interface IntegrationVerdict {
  state: IntegrationState
  reason: string
  fix?: OperatorFix
  /** The connection this verdict is about, when one was chosen. */
  connectionId?: string
}

/** The slice of a row this module reads. */
export interface ConnectionStateInput {
  row: {
    id: string
    label: string
    /** `ext:<pack>/<connector>`, or a bare connector id. */
    connectorId: string
    status: 'active' | 'pending' | 'revoked' | 'unreadable'
    /**
     * The auth model behind it. It decides whether "we do not know what this
     * is authorized for" is a GAP an operator can close or a FACT of the
     * credential: a consent screen records its scopes, a pasted key never
     * does (found with the first real pasted key, 2026-09-19).
     */
    kind?: 'oauth2' | 'apiKey' | 'basic'
    health?: { ok: boolean; checkedAt: string; message?: string } | null
    meta?: Record<string, unknown>
  }
  /** The connector that owns it, when an active pack still offers one. */
  offer?: { provider: string; def: Pick<ConnectorDefinition, 'capabilities'> }
  /** Two packs claim its provider. Outranks dormancy: it is the actionable one. */
  conflict?: { provider: string; extensionIds: string[] }
  /** What a caller needs of it, provider-relative (`sheets.append`). */
  required?: readonly string[]
}

/** `ext:<pack>/<connector>` back into its parts; a row whose pack is gone still names it. */
export function parseStoredConnectorId(stored: string): { extensionId: string; connectorId: string } {
  const m = /^ext:([^/]+)\/(.+)$/.exec(stored)
  return m ? { extensionId: m[1]!, connectorId: m[2]! } : { extensionId: '', connectorId: stored }
}

const scopeOf = (meta: Record<string, unknown> | undefined): string | null =>
  typeof meta?.scope === 'string' && meta.scope.trim() !== '' ? meta.scope : null

/**
 * The heading each state belongs under.
 *
 * `attention` is the one that matters: every state in it is something an
 * OPERATOR can act on today - a consent to re-give, a credential to replace,
 * an authorization to finish. `dormant` and `conflicted` are about packs, not
 * connections, which is why they are not in it: the fix is elsewhere.
 */
const GROUP_OF: Record<ConnectionState, ConnectionGroup> = {
  connected: 'connected',
  needs_capability: 'attention',
  degraded: 'attention',
  pending: 'attention',
  revoked: 'attention',
  unreadable: 'attention',
  dormant: 'dormant',
}

/** The heading one verdict belongs under. A conflict outranks its own dormancy. */
export function connectionGroup(state: ConnectionState, conflicted = false): ConnectionGroup {
  if (conflicted) return 'conflicted'
  return GROUP_OF[state] ?? 'attention'
}

/** What one row is, and what to do about it. */
export function connectionState(input: ConnectionStateInput): ConnectionVerdict {
  const { row } = input
  const granted = scopeOf(row.meta)
  const authorizationKnown = granted !== null
  const pack = parseStoredConnectorId(row.connectorId).extensionId

  if (input.conflict) {
    const others = input.conflict.extensionIds
    return {
      state: 'dormant', group: connectionGroup('dormant', true), authorizationKnown, missing: [],
      reason: `${others.join(' and ')} both offer ${input.conflict.provider}, so this connection cannot be used.`,
      fix: { action: 'disable_pack', hint: `Disable one of ${others.join(' or ')}. Nothing is lost while both are active.`, extensionIds: others },
    }
  }
  if (row.status === 'pending') {
    return {
      state: 'pending', group: connectionGroup('pending'), authorizationKnown, missing: [],
      reason: 'Authorization was started and the provider has not answered yet.',
      fix: { action: 'finish_authorization', hint: 'Connect again to finish authorizing, or remove this half-made connection.' },
    }
  }
  if (row.status === 'revoked') {
    return {
      state: 'revoked', group: connectionGroup('revoked'), authorizationKnown, missing: [],
      reason: 'This connection was revoked, so its credentials are gone.',
      fix: { action: 'reconnect', hint: 'Connect again to use it.' },
    }
  }
  if (row.status === 'unreadable') {
    return {
      state: 'unreadable', group: connectionGroup('unreadable'), authorizationKnown, missing: [],
      reason: 'This deployment\'s connections key cannot open this connection.',
      fix: { action: 'reconnect', hint: 'Restore the key it was sealed with, or connect again.' },
    }
  }
  if (!input.offer) {
    return {
      state: 'dormant', group: connectionGroup('dormant'), authorizationKnown, missing: [],
      reason: pack
        ? `'${pack}' is not active here, so this connection cannot be used. Its credentials are kept.`
        : 'Nothing active offers this connector, so this connection cannot be used. Its credentials are kept.',
      fix: { action: 'enable_pack', hint: pack ? `Enable '${pack}' and it works again, with no re-consent.` : 'Install the extension that offers it.', ...(pack ? { extensionIds: [pack] } : {}) },
    }
  }

  const missing = input.required && input.required.length > 0
    ? missingCapabilities({ def: input.offer.def, granted, required: input.required })
    : []
  if (missing.length > 0) {
    const names = missing.map((m) => `'${m.label}'`).join(', ')
    /**
     * Whose decision it was. A provider that asks per item and grants a subset
     * leaves an operator staring at "not authorized" for a box they are sure
     * they ticked, so when the callback recorded the gap, say so.
     */
    const declined = Array.isArray(row.meta?.capabilitiesDenied)
      ? (row.meta!.capabilitiesDenied as unknown[]).filter((c): c is string => typeof c === 'string')
      : []
    const providerDeclined = missing.every((m) => declined.includes(m.capability))
    return {
      state: 'needs_capability', group: connectionGroup('needs_capability'), authorizationKnown, missing,
      reason: providerDeclined
        ? `The provider did not grant ${names} at the last connection, even though it was asked for.`
        : `This connection was not authorized for ${names}.`,
      fix: {
        action: 'reconnect',
        hint: providerDeclined
          ? `Reconnect and tick ${missing.length === 1 ? 'it' : 'them'} on the provider's own consent screen: it lists each item separately and grants only what is ticked.`
          : `Reconnect it and include ${missing.length === 1 ? 'that capability' : 'those capabilities'}.`,
      },
    }
  }
  if (row.health && !row.health.ok) {
    return {
      state: 'degraded', group: connectionGroup('degraded'), authorizationKnown, missing: [],
      reason: row.health.message ?? 'The last health check failed.',
      fix: { action: 'test', hint: 'Test it again; if it still fails, reconnect.' },
    }
  }
  if (authorizationKnown) return { state: 'connected', group: connectionGroup('connected'), authorizationKnown, missing: [], reason: 'Connected.' }
  /**
   * Not knowing what a connection may do has two quite different causes, and
   * telling an operator the wrong one is worse than saying nothing.
   *
   * A credential that carries no scopes - a pasted key, a username and
   * password - can never record them. "Reconnect it once to record what it is
   * authorized for" is impossible advice there: re-pasting the same key
   * records nothing, and the provider is the one that decides at the call.
   * An OAuth row with no recorded scope, by contrast, is a row from before
   * capability records, and one reconnect really does close the gap.
   */
  if (row.kind === 'apiKey' || row.kind === 'basic') {
    return {
      state: 'connected', group: connectionGroup('connected'), authorizationKnown, missing: [],
      reason: 'Connected. What this credential may do is the provider\'s to decide: it refuses the call if the credential is not allowed to make it.',
    }
  }
  return {
    state: 'connected', group: connectionGroup('connected'), authorizationKnown, missing: [],
    reason: 'Connected. This connection predates capability records, so what it is authorized for is unknown.',
    fix: { action: 'reconnect', hint: 'Reconnect it once to record what it is authorized for.' },
  }
}

export interface IntegrationStateInput {
  provider: string
  /** Packs that DECLARE the provider, with how they stand in this workspace. */
  packs?: ReadonlyArray<{ extensionId: string; installed: boolean; active: boolean }>
  conflict?: { provider: string; extensionIds: string[] }
  /** Is a connector for this provider offered right now? */
  offered?: boolean
  /** The rows for this provider, already derived. */
  connections?: ReadonlyArray<{ id: string; label: string; verdict: ConnectionVerdict }>
}

/**
 * Whether a feature can work here. The order is the order an operator would
 * act in: a conflict first because it blocks everything, then the pack, then
 * the connection, then its authorization, then its health.
 */
export function integrationState(input: IntegrationStateInput): IntegrationVerdict {
  const packs = input.packs ?? []
  const rows = input.connections ?? []

  if (input.conflict) {
    const ids = input.conflict.extensionIds
    return {
      state: 'provider_conflict',
      reason: `${ids.join(' and ')} both offer ${input.provider}, so none of its connections can be used.`,
      fix: { action: 'disable_pack', hint: `Disable one of ${ids.join(' or ')}.`, extensionIds: ids },
    }
  }
  if (!input.offered) {
    const installed = packs.filter((p) => p.installed)
    if (installed.length === 0) {
      return {
        state: 'pack_absent',
        reason: `Nothing installed offers ${input.provider}.`,
        fix: { action: 'install_pack', hint: `Install a connector pack that offers ${input.provider}.` },
      }
    }
    const ids = installed.map((p) => p.extensionId)
    return {
      state: 'pack_disabled',
      reason: `${ids.join(' and ')} offer${ids.length === 1 ? 's' : ''} ${input.provider} but ${ids.length === 1 ? 'is' : 'are'} not enabled here.`,
      fix: { action: 'enable_pack', hint: `Enable ${ids.join(' or ')} for this workspace.`, extensionIds: ids },
    }
  }

  const ready = rows.find((r) => r.verdict.state === 'connected')
  if (ready) return { state: 'ready', reason: `Using '${ready.label}'.`, connectionId: ready.id }
  const pending = rows.find((r) => r.verdict.state === 'pending')
  if (pending) return { state: 'needs_authorization', reason: pending.verdict.reason, fix: pending.verdict.fix, connectionId: pending.id }
  const capability = rows.find((r) => r.verdict.state === 'needs_capability')
  if (capability) return { state: 'needs_capability', reason: capability.verdict.reason, fix: capability.verdict.fix, connectionId: capability.id }
  const degraded = rows.find((r) => r.verdict.state === 'degraded')
  if (degraded) return { state: 'degraded', reason: degraded.verdict.reason, fix: degraded.verdict.fix, connectionId: degraded.id }

  // Only unusable rows, or none at all: an operator connects. A revoked or
  // unreadable row is named, so "not configured" never contradicts a list
  // that plainly shows one.
  const stale = rows[0]
  return {
    state: 'not_configured',
    reason: stale ? `No usable connection for ${input.provider}: '${stale.label}' is ${stale.verdict.state}.` : `No connection for ${input.provider} yet.`,
    fix: { action: 'connect', hint: `Connect ${input.provider} under Settings > Connections.` },
  }
}
