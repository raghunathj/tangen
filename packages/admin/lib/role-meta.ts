/**
 * File Name: role-meta.ts
 * Purpose: The single deployment-role colour language - which dot, text
 *          colour and Publish wording each role gets, and whether it is
 *          production. A deployment has one role (TANGEN_DEPLOYMENT_ROLE);
 *          the Admin shows it and never selects it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. Surfaces that ESCAPE the shell (Studio's
 *          takeover) announce the role the same way through this module.
 */

export type DeploymentRoleName = 'development' | 'staging' | 'production'

export interface RoleMeta {
  /** Human label for the role. */
  label: string
  /** Tailwind class for the status dot. */
  dot: string
  /** Tailwind class for the role's text. */
  text: string
  /** Production is the one role whose mistakes are public. */
  isProduction: boolean
  /** Publish wording - production says so out loud. */
  publishLabel: string
}

type KnownMeta = Pick<RoleMeta, 'label' | 'dot' | 'text'>

export const ROLE_META: Record<DeploymentRoleName, KnownMeta> = {
  // The role is information, not a control: a neutral label with one
  // coloured dot (UI V2 spec §15). Indigo for development (the place work
  // originates), warning for staging, success for production ('Live').
  development: { label: 'Development', dot: 'bg-accent', text: 'text-fg-muted' },
  staging: { label: 'Staging', dot: 'bg-warning', text: 'text-fg-muted' },
  production: { label: 'Production', dot: 'bg-success', text: 'text-fg-muted' },
}

const FALLBACK: KnownMeta = { label: 'Deployment', dot: 'bg-fg-faint', text: 'text-fg-muted' }

export function isProductionRole(role: string | null | undefined): boolean {
  return role === 'production'
}

export function roleMeta(role: string | null | undefined): RoleMeta {
  const known = (typeof role === 'string' && (ROLE_META as Record<string, KnownMeta>)[role]) || null
  const base = known ?? { ...FALLBACK, label: (typeof role === 'string' && role) || FALLBACK.label }
  const isProduction = isProductionRole(role)
  return { ...base, isProduction, publishLabel: isProduction ? 'Publish live' : 'Publish' }
}
