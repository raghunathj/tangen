/**
 * File Name: push.ts
 * Purpose: The extension's `tangen push` hook: every declared profile field
 *          becomes a real column on auth_users (ADD COLUMN IF NOT EXISTS),
 *          once the content schema committed. Runs in the CLI process against
 *          the project's database; never at API boot.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { sql } from 'drizzle-orm'
import type { ProfileFieldDef } from './contract'
import { profileColumnStatements } from './profile'
import { rowsOf } from './context'

export interface PushHookContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { execute: (q: any) => Promise<unknown> }
  workspaceId: string
  configCwd: string
  options: Record<string, unknown>
  log: { ok: (m: string) => void; warn: (m: string) => void; info?: (m: string) => void }
}

export async function afterPush(ctx: PushHookContext): Promise<void> {
  const fields = (ctx.options?.profileFields as ProfileFieldDef[] | undefined) ?? []
  if (fields.length === 0) return
  let statements: Array<{ field: string; sql: string }>
  try {
    statements = profileColumnStatements(fields)
  } catch (err) {
    ctx.log.warn(`Site users: profile fields skipped - ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  const [exists] = rowsOf<{ t: string | null }>(await ctx.db.execute(sql`SELECT to_regclass('public.auth_users') AS t`))
  if (!exists?.t) {
    ctx.log.warn('Site users: profile fields declared but the auth_users table is not there yet - run `tangen extension install auth` first.')
    return
  }
  for (const s of statements) await ctx.db.execute(sql.raw(s.sql))
  ctx.log.ok(`Site users: profile fields ${statements.map((s) => s.field).join(', ')}`)
}
