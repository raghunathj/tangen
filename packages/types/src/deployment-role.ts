/**
 * File Name: deployment-role.ts
 * Purpose: The deployment role - development, staging or production - as the
 *          ONE process-level safety signal (tasks/remove-environments-programme.md,
 *          stage R1). A deployment is a running build with one database; its
 *          role says which protections are on. The role never selects content,
 *          a workspace, a database or a request scope: it is policy, not scope.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `TANGEN_DEPLOYMENT_ROLE` is explicit and wins. Unset,
 *          the role follows NODE_ENV (production → production, staging →
 *          staging, anything else → development) so an existing deployment
 *          that only sets NODE_ENV=production keeps every protection. An
 *          unknown value refuses the boot: a typo must never relax production.
 *          The policy matrix below is the single place that says what each
 *          role turns on; every gate in the API and the CLI reads it.
 */

export const DEPLOYMENT_ROLES = ['development', 'staging', 'production'] as const
export type DeploymentRole = (typeof DEPLOYMENT_ROLES)[number]

export const DEPLOYMENT_ROLE_VARIABLE = 'TANGEN_DEPLOYMENT_ROLE'

export function isDeploymentRole(value: unknown): value is DeploymentRole {
  return typeof value === 'string' && (DEPLOYMENT_ROLES as readonly string[]).includes(value)
}

export class DeploymentRoleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeploymentRoleError'
  }
}

/**
 * The role of the process described by `env`. Explicit `TANGEN_DEPLOYMENT_ROLE`
 * first; otherwise derived from NODE_ENV; otherwise development.
 * @throws DeploymentRoleError when the variable names something that is not a role.
 */
export function resolveDeploymentRole(env: Record<string, string | undefined>): DeploymentRole {
  const explicit = env[DEPLOYMENT_ROLE_VARIABLE]?.trim()
  if (explicit) {
    const lower = explicit.toLowerCase()
    if (isDeploymentRole(lower)) return lower
    throw new DeploymentRoleError(
      `${DEPLOYMENT_ROLE_VARIABLE}=${JSON.stringify(explicit)} is not a deployment role. ` +
      `Use one of: ${DEPLOYMENT_ROLES.join(', ')}. The role is safety policy for this process; it never selects content or a database.`,
    )
  }
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase()
  if (nodeEnv === 'production') return 'production'
  if (nodeEnv === 'staging') return 'staging'
  return 'development'
}

/** Staging and production: the roles that carry the deployed protections. */
export function isProductionLikeRole(role: DeploymentRole): boolean {
  return role === 'production' || role === 'staging'
}

/**
 * What a role turns on. Booleans read as "the protection is active"; the
 * three-valued entries name the posture the CLI and the API enforce.
 */
export interface DeploymentPolicy {
  role: DeploymentRole
  /** Staging and production. */
  productionLike: boolean
  /** The admin refresh cookie is sent with `Secure` (TANGEN_COOKIE_SECURE still overrides). */
  secureCookies: boolean
  /** A generated JWT secret is refused; JWT_SECRET must be set. */
  requireJwtSecret: boolean
  /** An empty CORS allow-list fails closed instead of answering every origin. */
  strictCors: boolean
  /** Unmapped exceptions reach clients as "Internal server error", never with detail. */
  redactErrors: boolean
  /** The Admin schema builder may write `app/content-objects` on this deployment. */
  schemaWritable: boolean
  /** Destructive schema operations in `tangen push` (drop column, drop table, incompatible type change). */
  destructiveSchemaChanges: 'allowed' | 'approval-required'
  /** `tangen purge` and the extension purge. */
  purge: 'allowed' | 'refused'
  /** Seeding demo or sample content. */
  seed: 'allowed' | 'refused'
  /** Developer tooling in the Admin (Devspace, Query Monitor, schema builder surfaces). */
  developerTooling: boolean
  /** A config key marked `required: 'production'` is required here. */
  requiresProductionSecrets: boolean
  /** The CORS observe-mode notice is a warning (deployed) rather than an informational line (laptop). */
  warnOnObservedCors: boolean
}

export function deploymentPolicy(role: DeploymentRole): DeploymentPolicy {
  const productionLike = isProductionLikeRole(role)
  const production = role === 'production'
  return {
    role,
    productionLike,
    secureCookies: productionLike,
    requireJwtSecret: productionLike,
    strictCors: productionLike,
    redactErrors: productionLike,
    schemaWritable: role === 'development',
    destructiveSchemaChanges: production ? 'approval-required' : 'allowed',
    purge: production ? 'refused' : 'allowed',
    seed: production ? 'refused' : 'allowed',
    developerTooling: role === 'development',
    requiresProductionSecrets: production,
    warnOnObservedCors: productionLike,
  }
}
