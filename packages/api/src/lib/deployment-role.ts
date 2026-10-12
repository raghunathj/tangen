/**
 * File Name: deployment-role.ts
 * Purpose: This process's deployment role and policy, resolved once from the
 *          process environment (tasks/remove-environments-programme.md, stage
 *          R1). Every production gate in the API - cookies, JWT secret, CORS
 *          posture, error redaction, schema writes, seeds, purges - asks this
 *          module, so the matrix in @tangen/types is the only place the
 *          roles are interpreted.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Resolved per call from process.env (a string compare),
 *          so a test that sets TANGEN_DEPLOYMENT_ROLE or NODE_ENV needs no
 *          reset. `deploymentPolicyFor(env)` is the pure form for code that
 *          is handed an environment map rather than the process.
 */
import { resolveDeploymentRole, deploymentPolicy, type DeploymentRole, type DeploymentPolicy } from '@tangen/types'

export type { DeploymentRole, DeploymentPolicy } from '@tangen/types'
export { resolveDeploymentRole, deploymentPolicy, isProductionLikeRole, DEPLOYMENT_ROLES, DEPLOYMENT_ROLE_VARIABLE, DeploymentRoleError } from '@tangen/types'

/** The role of THIS process. */
export function deploymentRole(): DeploymentRole {
  return resolveDeploymentRole(process.env)
}

/** The policy of THIS process. Read per call: resolution is a string compare, and tests set the variables between calls. */
export function currentDeploymentPolicy(): DeploymentPolicy {
  return deploymentPolicy(resolveDeploymentRole(process.env))
}

/** The policy an arbitrary environment map describes (pure; for Doctor and tests). */
export function deploymentPolicyFor(env: Record<string, string | undefined>): DeploymentPolicy {
  return deploymentPolicy(resolveDeploymentRole(env))
}
