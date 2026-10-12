/**
 * File Name: dangling.ts
 * Purpose: Flows' side of an extension uninstall (Extension Kernel K8.6).
 *          The platform announces the action and trigger names an
 *          uninstalled extension took with it; a flow that still references
 *          one would fail at that node on its next run. Pausing it now, with
 *          the reason and the nodes on the row, tells the operator what to
 *          fix and keeps the run history clean. Pure over the store.
 *
 * Author: Raghunath J
 * License: MIT
 */

interface StoredFlow { key: string; data: Record<string, unknown> }
interface FlowStore {
  list(prefix: string): Promise<StoredFlow[]>
  put(key: string, data: Record<string, unknown>): Promise<void>
}

const FLOW_PREFIX = 'flow:'

/** The node names (actions and trigger types) a flow references. */
function nodeNamesOf(flow: Record<string, unknown>): { actions: string[]; triggers: string[] } {
  const nodes = Array.isArray(flow.nodes) ? (flow.nodes as Array<Record<string, unknown>>) : []
  const actions: string[] = []
  const triggers: string[] = []
  for (const n of nodes) {
    const data = (n.data ?? {}) as Record<string, unknown>
    if (n.kind === 'action' && typeof data.action === 'string') actions.push(data.action)
    if (n.kind === 'trigger' && typeof data.type === 'string') triggers.push(data.type)
  }
  // v1 graphs carried the trigger at the top level.
  const legacy = (flow.trigger ?? null) as { type?: unknown } | null
  if (legacy && typeof legacy.type === 'string') triggers.push(legacy.type)
  return { actions, triggers }
}

/** The ENABLED flows that reference any of the removed names, with the names they reference. */
export function flowsUsingNodes(flows: readonly StoredFlow[], removed: { actions: readonly string[]; triggers: readonly string[] }): Array<{ key: string; nodes: string[] }> {
  const actions = new Set(removed.actions)
  const triggers = new Set(removed.triggers)
  if (actions.size === 0 && triggers.size === 0) return []
  const out: Array<{ key: string; nodes: string[] }> = []
  for (const f of flows) {
    if (!(f.data as { enabled?: boolean }).enabled) continue
    const names = nodeNamesOf(f.data)
    const hit = [...new Set([...names.actions.filter((a) => actions.has(a)), ...names.triggers.filter((t) => triggers.has(t))])]
    if (hit.length) out.push({ key: f.key, nodes: hit })
  }
  return out
}

/** Pauses every enabled flow that references a removed node, recording why; returns the keys it paused. */
export async function pauseFlowsForRemovedNodes(store: FlowStore, removed: { extensionId: string; actions: readonly string[]; triggers: readonly string[] }): Promise<string[]> {
  const flows = await store.list(FLOW_PREFIX)
  const hits = flowsUsingNodes(flows, removed)
  for (const hit of hits) {
    const row = flows.find((f) => f.key === hit.key)!
    await store.put(hit.key, { ...row.data, enabled: false, pausedReason: 'NODE_UNAVAILABLE', pausedNodes: hit.nodes, pausedBy: removed.extensionId, pausedAt: new Date().toISOString() })
  }
  return hits.map((h) => h.key)
}
