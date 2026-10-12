/**
 * File Name: extension-cleanup.ts
 * Purpose: What UNINSTALL cleans up on an extension's behalf (Extension
 *          Kernel K8.6, tasks/plan-extension-kernel.md), in a ledger the
 *          operator sees. Its connections are revoked with their material
 *          cleared - the connector is gone and a credential must not
 *          linger; its queued jobs are cancelled - the handler is gone,
 *          while a claimed run finishes on its own; and the node names it
 *          contributed to Flows are gathered BEFORE the registry forgets
 *          them, so the `extension.uninstalled` event can name what flows
 *          lost. Extension data stays until PURGE, as before. Idempotent:
 *          a second pass finds nothing.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { sealSecret, type SealedKey } from '../lib/sealed'
import { contributions } from '../kernel/contributions'

type SqlExec = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>

export interface CleanupLedger {
  /** Connections of the extension's connectors, revoked with their material cleared. */
  connections: number
  /** Queued jobs of the extension's tasks, cancelled. */
  jobs: number
  /** The node names the extension contributed, by point (`flow.actions@1`, `flow.triggers@1`). */
  contributions: Record<string, string[]>
}

/** The points whose items other extensions reference by name and would dangle. */
export const REFERENCED_POINTS = ['flow.actions@1', 'flow.triggers@1'] as const

/** The names an extension contributes on the referenced points - read while it is still registered. */
export function contributedNodesOf(extensionId: string, workspaceId?: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const point of REFERENCED_POINTS) {
    const names = contributions<{ name?: unknown }>(point, { activeIds: new Set([extensionId]), ...(workspaceId ? { workspaceId } : {}) })
      .map((c) => (c.item && typeof c.item.name === 'string' ? c.item.name : null))
      .filter((n): n is string => Boolean(n))
    out[point] = names
  }
  return out
}

export async function cleanupOnUninstall(
  exec: SqlExec,
  scope: { workspaceId: string; extensionId: string },
  opts: { key?: SealedKey; contributions: Record<string, string[]> },
): Promise<CleanupLedger> {
  // Each statement stands alone and tolerates a database that predates its table: an
  // uninstall must retire the row even where nothing of this kind exists yet.
  const count = async (text: string, params: unknown[]): Promise<number> => {
    try { return (await exec(text, params)).length } catch { return 0 }
  }
  let connections = 0
  if (opts.key) {
    // The material goes with the connector: re-sealed as nothing, so the row stays diagnosable but useless.
    connections = await count(
      `UPDATE connections SET status = 'revoked', secret = $3, health = NULL, updated_at = now() WHERE workspace_id = $1 AND connector_id LIKE $2 AND status <> 'revoked' RETURNING id`,
      [scope.workspaceId, `ext:${scope.extensionId}/%`, sealSecret(opts.key, {})],
    )
  }
  const jobs = await count(
    `UPDATE job_queue SET status = 'cancelled', last_error = $3, finished_at = now() WHERE workspace_id = $1 AND task_id LIKE $2 AND status = 'queued' RETURNING id`,
    [scope.workspaceId, `ext:${scope.extensionId}:%`, `extension '${scope.extensionId}' was uninstalled before this job ran`],
  )
  return { connections, jobs, contributions: opts.contributions }
}
