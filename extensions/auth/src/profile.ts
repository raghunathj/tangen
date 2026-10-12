/**
 * File Name: profile.ts
 * Purpose: Profile fields as real columns on auth_users: adding them (the
 *          push hook), reading and writing them by name for one user.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { sql } from 'drizzle-orm'
import { RESERVED_PROFILE_COLUMNS, profileFieldSqlType, validateProfileFieldName, type ProfileFieldDef } from './contract'
import { rowsOf } from './context'

export { validateProfileFields, profileFieldSqlType } from './contract'

/** The column name, or a throw: never interpolate a name this did not pass. */
export function safeCol(name: string): string {
  validateProfileFieldName(name)
  if (RESERVED_PROFILE_COLUMNS.has(name)) throw new Error(`Profile field "${name}" shadows a built-in column of auth_users`)
  return name
}

/** ALTER TABLE ... ADD COLUMN IF NOT EXISTS for each field; the SQL statements, so a caller can log or run them. */
export function profileColumnStatements(fields: ProfileFieldDef[]): Array<{ field: string; sql: string }> {
  return fields.map((f) => ({ field: f.name, sql: `ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS "${safeCol(f.name)}" ${profileFieldSqlType(f)}` }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensureProfileColumns(db: any, fields: ProfileFieldDef[]): Promise<void> {
  for (const s of profileColumnStatements(fields)) await db.execute(sql.raw(s.sql))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readProfileValues(db: any, userId: string, workspaceId: string, fields: ProfileFieldDef[]): Promise<Record<string, unknown>> {
  if (!fields.length) return {}
  const cols = sql.join(fields.map((f) => sql.raw(`"${safeCol(f.name)}"`)), sql`, `)
  const rows = rowsOf(await db.execute(sql`SELECT ${cols} FROM auth_users WHERE id = ${userId} AND workspace_id = ${workspaceId} LIMIT 1`))
  return rows[0] ?? {}
}

/** Writes the values whose keys are among `allowedFields`; returns what was written. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function writeProfileValues(db: any, userId: string, workspaceId: string, allowedFields: ProfileFieldDef[], incoming: Record<string, unknown>): Promise<Record<string, unknown>> {
  const allowed = new Set(allowedFields.map((f) => f.name))
  const filtered = Object.fromEntries(Object.entries(incoming).filter(([k]) => allowed.has(k)))
  if (!Object.keys(filtered).length) return filtered
  const sets = sql.join(Object.entries(filtered).map(([k, v]) => sql`${sql.raw(`"${safeCol(k)}"`)} = ${v}`), sql`, `)
  await db.execute(sql`UPDATE auth_users SET ${sets} WHERE id = ${userId} AND workspace_id = ${workspaceId}`)
  return filtered
}
