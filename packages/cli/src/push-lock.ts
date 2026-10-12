/**
 * File Name: push-lock.ts
 * Purpose: One schema mutation at a time. A Postgres advisory lock held for the
 *          whole of `tangen push`, from before the plan is computed until after
 *          the ledger row is final.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Freeze review finding C1. Round 1 made a single push
 *          atomic, which prevents a half-applied schema; it does nothing about
 *          two pushes racing, because each transaction is individually valid.
 *          Two pipelines, or a developer and a pipeline, each read the
 *          pre-change schema, each compute a plan against it, and each apply.
 *          The second plan was calculated against a database that no longer
 *          exists by the time it runs.
 *
 *          The lock is taken BEFORE preflight reads schema state, not just
 *          around the apply, because a plan computed from a stale read is the
 *          defect. Locking only the write would produce a correct transaction
 *          executing wrong statements.
 *
 *          SCOPE: `(namespace, hash32(workspaceId))`, and the namespace is not
 *          the scheduler's. Advisory locks are per DATABASE, so two different
 *          databases never contend and no unrelated environment is serialized.
 *          Within one database every push contends: content tables are one
 *          set per database, so a
 *          push to development and a push to staging pointing at the same
 *          database ALTER the same physical tables. Keying per environment
 *          would look tidier and would not prevent the race it exists for.
 *          Keying per workspace lets two workspaces in one database proceed
 *          together; where they touch the same system table, Postgres' own
 *          ACCESS EXCLUSIVE lock serializes the statement without corruption.
 *
 *          POLICY: fail fast, do not wait. A push is short and a queued CI job
 *          that silently blocks for minutes is worse than one that stops and
 *          says why. `pg_try_advisory_lock` returns immediately.
 *
 *          RELEASE: the lock is a SESSION lock held on a dedicated connection
 *          created here, so the same session always releases it, which a
 *          pooled connection cannot promise. If the process is killed, the
 *          socket closes and Postgres drops the lock; nothing can leak a lock
 *          that outlives its process.
 */
import { createDb } from '@tangen/db'

/**
 * Namespace for schema-mutation locks. Deliberately not
 * `SCHEDULER_ADVISORY_LOCK` (761_204_001): a scheduler tick and a push must
 * never exclude one another.
 */
export const PUSH_LOCK_NAMESPACE = 761_204_002

/** Stable 32-bit signed hash. Postgres advisory keys are int4 in the two-key form. */
export function lockKeyFor(workspaceId: string): number {
  let h = 2166136261
  for (let i = 0; i < workspaceId.length; i++) {
    h ^= workspaceId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // Fold to a signed 32-bit integer, which is what int4 accepts.
  return h | 0
}

export interface PushLock {
  /** Releases the lock and closes the connection holding it. Safe to call twice. */
  release(): Promise<void>
}

export class PushLockBusyError extends Error {
  constructor(public readonly workspaceId: string) {
    super(
      `another schema change is running for workspace "${workspaceId}" on this database.\n`
      + '  A push holds the migration lock from planning through apply, so two of them\n'
      + '  cannot compute plans against the same schema and then both write.\n'
      + '  Wait for the other push to finish and run this again.',
    )
    this.name = 'PushLockBusyError'
  }
}

/**
 * Takes the schema-mutation lock, or throws `PushLockBusyError`.
 *
 * @param databaseUrl - The environment's database.
 * @param workspaceId - Scopes the lock; see the note above for why not the env.
 */
export async function acquirePushLock(databaseUrl: string, workspaceId: string): Promise<PushLock> {
  // A pool of our own, capped at ONE connection: a session advisory lock
  // belongs to the session that took it, and a shared pool may hand a
  // different connection back for the unlock, which would silently fail to
  // release. `createDb` rather than a bare postgres client so this uses the
  // same connection handling as everything else.
  // connectTimeout matters: a scaffolded project carries a placeholder
  // DATABASE_URL, and without a bound this connect hangs rather than failing,
  // which turned a 100-second test suite into one that never finished.
  const own = createDb(databaseUrl, { max: 1, connectTimeout: 5 })
  const client = own.$rawClient
  const key = lockKeyFor(workspaceId)
  let released = false
  const close = async () => { try { await own.end() } catch { /* closing is best effort */ } }

  let got: boolean
  try {
    const rows = await client.unsafe(
      `SELECT pg_try_advisory_lock(${PUSH_LOCK_NAMESPACE}, ${key}) AS locked`,
    ) as unknown as Array<{ locked: boolean }>
    got = rows[0]?.locked === true
  } catch (err) {
    await close()
    throw err
  }

  if (!got) {
    await close()
    throw new PushLockBusyError(workspaceId)
  }

  return {
    async release() {
      if (released) return
      released = true
      try {
        await client.unsafe(`SELECT pg_advisory_unlock(${PUSH_LOCK_NAMESPACE}, ${key})`)
      } catch { /* the session is going away, which releases it anyway */ }
      await close()
    },
  }
}
