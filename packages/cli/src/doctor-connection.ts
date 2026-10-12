/**
 * File Name: doctor-connection.ts
 * Purpose: Tell an operator how their database connection is actually
 *   executing, and what it costs, without them having to read the source.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. `tangen doctor` already opens a connection and runs
 *   SELECT 1, so the round trip is free to measure and is the number that makes
 *   the preparation setting make sense: one saved round trip is invisible on a
 *   socket and is most of a statement on a database 25 ms away.
 *
 *   No pooler detection. Tangen cannot see what sits between it and PostgreSQL,
 *   and guessing wrong either breaks a deployment or nags a correct one. This
 *   reports what Tangen chose and why, and leaves the topology to the operator.
 */
import type { PrepareSource } from '@tangen/db'

export interface ConnectionDiagnostics {
  /** The effective preparation policy. */
  prepare: boolean
  /** Where it came from: a caller option, the environment, or the default. */
  source: PrepareSource
  /** Median round trip to the database in ms, or null when not measured. */
  rttMs: number | null
}

const WHY: Record<PrepareSource, string> = {
  option: 'set in code',
  env: 'TANGEN_DB_PREPARE',
  default: 'default',
}

/** Round trip worth mentioning: below this, preparation is not worth explaining. */
const REMOTE_MS = 5

/**
 * The doctor line for prepared statements, plus advice only when there is
 * something worth acting on.
 *
 * @param d - The effective policy, its source, and the measured round trip.
 * @returns `value` for the sources block; `advice` when disabled on a database
 *   far enough away for it to matter, otherwise null.
 */
export function preparedStatementsSummary(d: ConnectionDiagnostics): { value: string; advice: string | null } {
  // Sub-millisecond is a local socket, and "0ms" reads like a failed
  // measurement rather than the good news it is.
  const rtt = d.rttMs === null ? '' : `, round trip ${d.rttMs < 1 ? `${d.rttMs.toFixed(1)}ms` : `${d.rttMs.toFixed(0)}ms`}`
  const value = `${d.prepare ? 'enabled' : 'disabled'} (${WHY[d.source]})${rtt}`

  if (d.prepare) return { value, advice: null }
  // Disabled is a legitimate, supported choice - so say what it costs once,
  // here, rather than warning on every request.
  if (d.rttMs !== null && d.rttMs >= REMOTE_MS) {
    return {
      value,
      advice: `Prepared statements are off, so every parameterized statement pays an extra ${d.rttMs.toFixed(0)}ms round trip. `
        + 'Keep it off only for a pooler or proxy that cannot carry named statements; otherwise unset TANGEN_DB_PREPARE.',
    }
  }
  return { value, advice: null }
}
