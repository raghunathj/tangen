/**
 * File Name: deployment-role.ts
 * Purpose: The deployment role as the SEO extension may see it (closure plan
 *          Phase 9A). The platform's role service is INTERNAL to @tangen/api,
 *          so the extension names the shape it needs and receives the value
 *          through the ctx seam rather than importing across the boundary.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** The three roles, or null when the deployment has not adopted one. */
export type DeploymentRoleLike = 'development' | 'staging' | 'production' | null | undefined

/** Whether this deployment is the live site. Unknown is never production. */
export function isProductionRole(role: DeploymentRoleLike): boolean {
  return role === 'production'
}
