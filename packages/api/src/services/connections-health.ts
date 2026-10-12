/**
 * File Name: connections-health.ts
 * Purpose: The scheduled health sweep (Extension Kernel K6.3,
 *          tasks/plan-extension-kernel.md): once an hour (runtime
 *          housekeeping, one replica per pass) every active connection whose
 *          connector declares a `health` is checked over the platform's own
 *          authed client and the result recorded on the row, so Settings →
 *          Connections shows a broken connection before an extension trips
 *          on it. Pending, revoked and unreadable rows, and connectors no
 *          active extension offers, are skipped - they are not health
 *          questions.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { connectionsScopeFor } from './connections-scope'
import { resolveConnectorOffers, storedConnectorId, offerForRow, connectionClientFor } from './extension-connections'
import { healthFromVerdict } from '../routes/connections/manage'

export interface HealthSweepSummary { checked: number; ok: number; failed: number; skipped: number }

export async function sweepConnectionsHealth(input: {
  workspaceIds: readonly string[]
  /**
   * Records each workspace's pass in the platform's own run history, so an
   * hourly check that nobody can see becomes one an operator can (the user,
   * 2026-09-20: "auto check every 1 hour is happening right?? if yes why is
   * it no present in jobs & crons?").
   */
  recordRun?: (run: { workspaceId: string; startedAt: Date; summary: HealthSweepSummary }) => void | Promise<void>
}): Promise<HealthSweepSummary> {
  const summary: HealthSweepSummary = { checked: 0, ok: 0, failed: 0, skipped: 0 }
  for (const workspaceId of input.workspaceIds) {
    const startedAt = new Date()
    const before = { ...summary }
    const scope = connectionsScopeFor(workspaceId)
    if (!scope) continue
    // A1: a conflicted provider offers nothing, so its rows are skipped here
    // too. Checking one would mean choosing a connector, which is the thing
    // the conflict exists to refuse.
    const { offers } = resolveConnectorOffers(new Set(await scope.activeIds()))
    for (const row of await scope.store.list()) {
      const offer = offerForRow(offers, row.connectorId)
      if (row.status !== 'active' || !offer || typeof offer.def.health !== 'function') { summary.skipped++; continue }
      const opened = await scope.store.open(row.id)
      if (!opened || opened.status !== 'active') { summary.skipped++; continue }
      const client = connectionClientFor({
        row: opened, credentials: opened.credentials, offer, workspaceId, extensionId: null,
        store: scope.store, fetchImpl: scope.fetchImpl, lookup: scope.lookup,
      })
      const verdict = await client.health()
      const checkedAt = new Date().toISOString()
      // The provider's reason, recorded where an operator reads it, through
      // the SAME rule the Test button uses - including "could not be checked",
      // which keeps the previous verdict rather than inventing a failure.
      const health = healthFromVerdict(verdict, checkedAt, row.health)
      await scope.store.update(row.id, { health })
      summary.checked++
      if (health.ok) summary.ok++; else summary.failed++
    }
    // What THIS workspace's pass did, so the history reads per workspace like
    // every other run in it.
    await input.recordRun?.({
      workspaceId, startedAt,
      summary: {
        checked: summary.checked - before.checked,
        ok: summary.ok - before.ok,
        failed: summary.failed - before.failed,
        skipped: summary.skipped - before.skipped,
      },
    })
  }
  return summary
}
