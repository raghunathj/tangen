/**
 * File Name: production-defaults.ts
 * Purpose: Boot-time warnings about a deployment whose role and process
 *          settings disagree (tasks/remove-environments-programme.md, stage
 *          R1): a staging or production role under a non-production NODE_ENV
 *          (libraries relax their own behaviour on NODE_ENV), and the cookie
 *          override on a production-like deployment.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure; index.ts logs each line at warn level.
 */
import { deploymentPolicy, type DeploymentRole } from '@tangen/types'

export interface DeploymentProcessInput {
  role: DeploymentRole
  nodeEnv: string | undefined
  cookieSecureOverride?: string | undefined
}

export function deploymentProcessWarnings(input: DeploymentProcessInput): string[] {
  const out: string[] = []
  const policy = deploymentPolicy(input.role)
  if (policy.productionLike && input.nodeEnv !== 'production') {
    out.push(`this is a ${input.role} deployment (TANGEN_DEPLOYMENT_ROLE) but NODE_ENV is ${JSON.stringify(input.nodeEnv ?? '')}: Tangen's own protections follow the role, but libraries key on NODE_ENV. Set NODE_ENV=production on a deployed process.`)
  }
  if (policy.productionLike && input.cookieSecureOverride === 'false') {
    out.push('TANGEN_COOKIE_SECURE=false on a production-like deployment: the admin refresh cookie is sent over plain HTTP.')
  }
  return out
}
