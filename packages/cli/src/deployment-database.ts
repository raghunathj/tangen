/**
 * File Name: deployment-database.ts
 * Purpose: The ONE place a CLI command asks which database this deployment
 *          holds: `DATABASE_URL`, through the resolver the API boots with.
 *          A development machine without one gets the local default; a
 *          staging or production deployment without one is refused with the
 *          sentence that names the fix.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Replaces the environment binding map
 *          (tasks/remove-environments-programme.md, stage R8). No command reads
 *          `process.env.DATABASE_URL` itself.
 */
import { resolveProcessDatabase, resolveDeploymentRole, type DeploymentRole, type ProcessDatabase } from '@tangen/types'

export type DeploymentDatabase = ProcessDatabase

/** The database of this deployment. Throws when a deployed process has none. */
export function resolveDeploymentDatabase(variables: Record<string, string | undefined> = process.env): DeploymentDatabase {
  return resolveProcessDatabase(variables)
}

/** The role of THIS process (TANGEN_DEPLOYMENT_ROLE, else NODE_ENV): what safety keys on. */
export function deploymentRole(variables: Record<string, string | undefined> = process.env): DeploymentRole {
  return resolveDeploymentRole(variables)
}

/** One sentence for a refused resolution, for the commands that print and exit rather than throw. */
export function describeDatabaseError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
