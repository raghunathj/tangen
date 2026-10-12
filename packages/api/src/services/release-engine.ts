/**
 * File Name: release-engine.ts
 * Purpose: The plan of a Release before it applies: what each item would do
 *          in place - publish, nothing (already live as frozen), or fail
 *          because its type is gone.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { readObjectSource, fingerprintObject, reviveFrozen } from './object-snapshot'
import type { FrozenRelease } from './release-approval'
export { applyReleaseItem, type EngineInput, type ReleaseItemResult, type ApplyOutcome } from './release-apply'

export type PlannedAction = 'publish' | 'unchanged' | 'changed-since-approval' | 'missing-type' | 'missing-object'
export interface ReleasePlanEntry { position: number; typeName: string; objectId: string; action: PlannedAction }

export async function planRelease(deps: { db: any; workspaceId: string; tables: Record<string, any> }, frozen: FrozenRelease): Promise<ReleasePlanEntry[]> {
  const plan: ReleasePlanEntry[] = []
  for (const item of frozen.order) {
    const table = deps.tables[item.typeName]
    if (!table) { plan.push({ position: item.position, typeName: item.typeName, objectId: item.objectId, action: 'missing-type' }); continue }
    const current = await readObjectSource(deps.db, deps.workspaceId, item.typeName, table, item.objectId)
    if (!current) { plan.push({ position: item.position, typeName: item.typeName, objectId: item.objectId, action: 'missing-object' }); continue }
    const source = reviveFrozen(frozen.frozen[item.objectId]!, table)
    const same = fingerprintObject(current) === fingerprintObject(source)
    const live = current.row.status === 'published'
    const action: PlannedAction = !same ? 'changed-since-approval' : live && current.row.publishedValues ? 'unchanged' : 'publish'
    plan.push({ position: item.position, typeName: item.typeName, objectId: item.objectId, action })
  }
  return plan
}
