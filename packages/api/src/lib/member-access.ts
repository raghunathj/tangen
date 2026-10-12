/**
 * File Name: member-access.ts
 * Purpose: Member-only gates for admin-panel routes - capabilities, the
 *          member session, owner-or-capability - as adapters over the kernel
 *          policy (K2). Each takes the request context a route still holds
 *          (or an execution), resolves the actor once, and asks `decide`;
 *          no rule here looks at whether a member id is present.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: kernel/policy.ts holds the rules; kernel/actor.ts holds
 *          the one adapter from the decorations to an actor. Capabilities are
 *          held by members: a key never satisfies a gate, whatever its
 *          document says (K0).
 */
import type { Capability } from '@tangen/types'
import { decide, requireDecision } from '../kernel/policy'
import { actorFromContext, type LegacyIdentityContext } from '../kernel/actor'

export { expandCapabilities } from '../kernel/capabilities'

/** What a gate needs: the execution, or the decorations a route still reads. */
export type MemberAccessContext = LegacyIdentityContext

export function hasCapability(ctx: MemberAccessContext, cap: Capability): boolean {
  return decide(actorFromContext(ctx), { kind: 'capability', capability: cap }).allow
}

export function requireCapability(ctx: MemberAccessContext, cap: Capability): void {
  requireDecision(actorFromContext(ctx), { kind: 'capability', capability: cap })
}

export function requireMemberSession(ctx: MemberAccessContext): void {
  requireDecision(actorFromContext(ctx), { kind: 'member-session' })
}

export function requireOwnerOrCapability(ctx: MemberAccessContext, cap: Capability): void {
  requireDecision(actorFromContext(ctx), { kind: 'owner-or-capability', capabilities: [cap] })
}

export function requireAnyCapability(ctx: MemberAccessContext, caps: Capability[]): void {
  requireDecision(actorFromContext(ctx), { kind: 'owner-or-capability', capabilities: caps })
}
