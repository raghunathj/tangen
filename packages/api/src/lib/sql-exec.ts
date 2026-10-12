/**
 * File Name: sql-exec.ts
 * Purpose: One `(text, params) => rows` executor over whichever drizzle
 *          client the deployment runs (postgres.js exposes `$rawClient.unsafe`,
 *          PGlite in tests only `execute`), so a seam that needs positional
 *          SQL - the extension store Porter hands a provider (E.4) - does
 *          not care which it was given.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { sql, type SQL } from 'drizzle-orm'

export type SqlExec = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>
type Rows = Array<Record<string, unknown>>

/** `$1, $2 ...` placeholders bound into a drizzle SQL fragment for a client without `unsafe`. */
function bind(text: string, params: unknown[]): SQL {
  const parts = text.split(/\$(\d+)/)
  const chunks: SQL[] = []
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) { if (parts[i]) chunks.push(sql.raw(parts[i]!)) }
    else chunks.push(sql`${params[Number(parts[i]) - 1]}`)
  }
  return sql.join(chunks, sql.raw(''))
}

/** The executor for a drizzle client, or null when the handle is not one. */
export function sqlExecOf(db: unknown): SqlExec | null {
  const d = db as { execute?: (q: SQL) => Promise<unknown>; $rawClient?: { unsafe?: Function }; session?: { client?: { unsafe?: Function } } } | null | undefined
  if (!d) return null
  const raw = d.$rawClient ?? d.session?.client
  if (typeof raw?.unsafe === 'function') return (text, params = []) => raw.unsafe!(text, params as never) as Promise<Rows>
  if (typeof d.execute === 'function') {
    return async (text, params = []) => {
      const res = await d.execute!(bind(text, params)) as Rows | { rows: Rows }
      return Array.isArray(res) ? res : (res.rows ?? [])
    }
  }
  return null
}
