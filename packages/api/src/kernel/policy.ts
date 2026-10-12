/**
 * File Name: policy.ts
 * Purpose: The one policy entry (kernel plan §6): `decide(actor, action)`
 *          answers "may this actor do this to this resource now" for every
 *          actor kind, and `requireDecision` turns a refusal into the 403
 *          the routes already answer. The rules are the ones the guard
 *          families held; what changes is where the decision is keyed:
 *          on the actor's explicit authority and kind, never on whether a
 *          member id happens to be present.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The bundle rules (objects, media, tables, globals) stay
 *          in lib/permissions.ts as pure functions of a grant bundle; this
 *          module supplies the actor's admin flag and bundle to them. The
 *          member-session, capability, field and locale rules live here.
 *          lib/member-access.ts, lib/field-access.ts and lib/public-view.ts
 *          are adapters over this module for code still on the decorations.
 */
import type { ActorContext } from '@tangen/types'
import { RequestError } from '../lib/errors'
import { assertObjectPermission, assertMediaPermission, assertTablePermission, assertGlobalsPermission, type ObjectAction, type EffectivePermissions } from '../lib/permissions'
import { expandCapabilities } from '../lib/member-access'

export type PolicyAction =
  | { kind: 'object'; action: ObjectAction; type?: string }
  | { kind: 'media'; action: 'read' | 'write' | 'delete' }
  | { kind: 'table'; action: 'read' | 'write'; table: string }
  | { kind: 'globals'; action: 'read' | 'write'; name?: string }
  /** A member-only management right, expanded through the declared implications. */
  | { kind: 'capability'; capability: string }
  /** Any of these capabilities; an owner or superadmin passes outright. */
  | { kind: 'owner-or-capability'; capabilities: string[] }
  /** The route needs a member behind it (an admin-panel surface). */
  | { kind: 'member-session' }
  /** A field's declared access lists, checked for the actor's role. */
  | { kind: 'field'; action: 'read' | 'write'; access: { read?: string[]; write?: string[] } | undefined }
  /** Writing one locale (null = the base row) against the actor's locale scope. */
  | { kind: 'locale'; action: 'write'; locale: string | null; defaultLocale?: string | null }
  /** A ctx facility (`db:own`, `jobs:enqueue`, `events:emit`, `ai:generate`, `delegation:act-as`): an extension holds it by grant; every other kind holds it. */
  | { kind: 'facility'; facility: string }

export type DecisionCode = 'OK' | 'FORBIDDEN' | 'NO_ACTOR'

export interface Decision {
  allow: boolean
  code: DecisionCode
  /** Why, when refused - the text the 403 carries. */
  reason: string | null
}

const ALLOW: Decision = { allow: true, code: 'OK', reason: null }
const refuse = (reason: string): Decision => ({ allow: false, code: 'FORBIDDEN', reason })

/** The bundle the grant rules read, with the admin flag restored as the sentinel they understand. */
function bundleOf(actor: ActorContext): EffectivePermissions {
  return actor.authority.admin ? { admin: true } : (actor.authority.bundle as unknown as EffectivePermissions)
}

function fromGuard(run: () => void): Decision {
  try {
    run()
    return ALLOW
  } catch (err) {
    if (err instanceof RequestError && err.statusCode === 403) return refuse(err.message)
    throw err
  }
}

function listAllows(list: string[] | undefined, role: string | null): boolean {
  if (!list || list.length === 0) return true
  if (!role) return true            // a key or a system actor: field lists name member roles only (v1)
  return list.includes(role)
}

export function decide(actor: ActorContext | null | undefined, action: PolicyAction): Decision {
  if (!actor) return { allow: false, code: 'NO_ACTOR', reason: 'No actor resolved for this execution' }
  const member = actor.identity.kind === 'member'
  const { authority } = actor
  switch (action.kind) {
    case 'object':
      return fromGuard(() => assertObjectPermission(bundleOf(actor), action.action, action.type))
    case 'media':
      return fromGuard(() => assertMediaPermission(bundleOf(actor), action.action))
    case 'table':
      return fromGuard(() => assertTablePermission(bundleOf(actor), action.action, action.table, { isMember: member }))
    case 'globals':
      return fromGuard(() => assertGlobalsPermission(bundleOf(actor), action.action, action.name))
    case 'member-session':
      // The admin fast path belongs to a member; a system actor holds the framework's authority.
      return member || actor.identity.kind === 'system' ? ALLOW : refuse('This endpoint requires member authentication')
    case 'capability': {
      // Capabilities are held by members, by identities (K8: an agent or a
      // service holds them in its record) and by extensions (their compiled
      // `capability:<id>` grants); a key never satisfies one, whatever its document says.
      const holds = member || actor.identity.kind === 'service' || actor.identity.kind === 'agent' || actor.identity.kind === 'extension'
      if (!holds) return refuse(`This action requires the ${action.capability} permission`)
      if (authority.admin) return ALLOW
      const held = authority.capabilities as never[]
      if (held.includes(action.capability as never) || expandCapabilities(held).includes(action.capability as never)) return ALLOW
      return refuse(`This action requires the ${action.capability} permission`)
    }
    case 'owner-or-capability': {
      if (member && (actor.role === 'owner' || authority.superadmin)) return ALLOW
      for (const cap of action.capabilities) if (decide(actor, { kind: 'capability', capability: cap }).allow) return ALLOW
      return action.capabilities.length === 1
        ? refuse(`This action requires the ${action.capabilities[0]} permission`)
        : refuse(`This action requires one of: ${action.capabilities.join(', ')}`)
    }
    case 'field': {
      if (authority.admin || !action.access) return ALLOW
      const role = member ? actor.role : null
      const ok = action.action === 'read'
        ? listAllows(action.access.read, role)
        : listAllows(action.access.read, role) && listAllows(action.access.write, role)
      return ok ? ALLOW : refuse(`Your role cannot ${action.action} this field`)
    }
    case 'facility': {
      // K1.5: only the extension principal is facility-gated; a member, a key
      // or the system reach the facilities their surfaces expose today.
      if (actor.identity.kind !== 'extension') return ALLOW
      const held = authority.facilities ?? []
      const family = action.facility.split(':')[0]
      if (held.includes(action.facility) || held.includes(`${family}:*`) || held.includes(`${family}:any`)) return ALLOW
      return refuse(`This extension is not granted ${action.facility}: declare it in the manifest grants`)
    }
    case 'locale': {
      if (authority.admin) return ALLOW
      const scope = authority.locales
      if (scope === 'all') return ALLOW
      if (scope === 'base') return action.locale === null ? ALLOW : refuse(`This credential writes the base locale only`)
      // A member's list names the locales it may write, the base included only when listed.
      const target = action.locale ?? (member ? (action.defaultLocale ?? null) : null)
      if (target === null) return member ? refuse('Your role can only edit specific languages - this action needs base-language rights') : ALLOW
      if (scope.includes(target)) return ALLOW
      // A base-row action (publish, archive, bulk) by a locale-scoped member, or one locale it does not hold.
      return action.locale === null
        ? refuse('Your role can only edit specific languages - this action needs base-language rights')
        : refuse(`Your role cannot edit the "${target}" language`)
    }
  }
}

/** The routes' contract for a refusal: a 403 FORBIDDEN carrying the reason. */
export function requireDecision(actor: ActorContext | null | undefined, action: PolicyAction): void {
  const d = decide(actor, action)
  if (d.allow) return
  throw new RequestError('FORBIDDEN', d.reason ?? 'Forbidden', 403)
}
