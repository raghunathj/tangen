/**
 * File Name: admin-access.ts
 * Purpose: The server evaluator for an extension's AdminAccessRule (kernel
 *          K7): the same rule the Admin applies to a page - owner and admin
 *          pass, a listed role passes, a held capability passes - decided on
 *          the server for the route that backs the page, through `decide`.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ActorContext, AdminAccessRule } from '@tangen/types'
import { decide, type Decision } from './policy'

export function evaluateAdminAccess(rule: AdminAccessRule | null | undefined, actor: ActorContext | null | undefined): Decision {
  if (!rule || (!rule.roles?.length && !rule.capability)) return { allow: true, code: 'OK', reason: null }
  if (!actor) return { allow: false, code: 'NO_ACTOR', reason: 'No actor resolved for this execution' }
  if (actor.identity.kind === 'member' && (actor.authority.admin || actor.role === 'owner' || actor.role === 'admin')) return { allow: true, code: 'OK', reason: null }
  if (rule.roles?.length && actor.identity.kind === 'member' && actor.role && rule.roles.includes(actor.role as never)) return { allow: true, code: 'OK', reason: null }
  if (rule.capability) {
    const d = decide(actor, { kind: 'capability', capability: rule.capability })
    if (d.allow) return d
  }
  const wants = [rule.roles?.length ? `one of the roles ${rule.roles.join(', ')}` : null, rule.capability ? `the ${rule.capability} permission` : null].filter(Boolean).join(' or ')
  return { allow: false, code: 'FORBIDDEN', reason: `This route requires ${wants}` }
}
