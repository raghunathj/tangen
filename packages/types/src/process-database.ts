/**
 * File Name: process-database.ts
 * Purpose: The ONE database a process holds. A deployment is one build, one
 *          database and its secrets; the database is `DATABASE_URL`, nothing
 *          else selects it. A development process without one falls back to
 *          the local default; a staging or production process refuses to
 *          start rather than serve a database it was never given.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Shared by the API (boot) and the CLI (every command
 *          that opens a database), so both answer the same question the same
 *          way (tasks/remove-environments-programme.md, stage R8).
 */
import { resolveDeploymentRole, isProductionLikeRole } from './deployment-role'

export const LOCAL_DEFAULT_DATABASE_URL = 'postgres://localhost/tangen_dev'

export interface ProcessDatabase {
  url: string
  /** Where the URL came from: the variable, or the development default. */
  source: 'DATABASE_URL' | 'local-default'
}

/** The database of this process. Throws when a deployed process has none. */
export function resolveProcessDatabase(env: Record<string, string | undefined>): ProcessDatabase {
  const url = env.DATABASE_URL?.trim()
  if (url) return { url, source: 'DATABASE_URL' }
  const role = resolveDeploymentRole(env)
  if (isProductionLikeRole(role)) {
    const because = env.TANGEN_DEPLOYMENT_ROLE ? `TANGEN_DEPLOYMENT_ROLE=${role}` : `NODE_ENV=${env.NODE_ENV}`
    throw new Error(
      `DATABASE_URL is not set (${because}). A ${role} deployment never falls back to the local development database; set DATABASE_URL for this deployment.`,
    )
  }
  return { url: LOCAL_DEFAULT_DATABASE_URL, source: 'local-default' }
}

export function resolveProcessDatabaseUrl(env: Record<string, string | undefined>): string {
  return resolveProcessDatabase(env).url
}

/** `host:port/database` - what two connection strings are compared by. Null when the URL does not parse. */
export function databaseIdentity(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return `${u.hostname || 'localhost'}:${u.port || '5432'}${u.pathname || ''}`
  } catch {
    return null
  }
}

/** The URL with its credentials replaced, for a log line. */
export function redactDatabaseUrl(url: string): string {
  return url.replace(/\/\/[^@/]*@/, '//***@')
}
