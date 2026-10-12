/**
 * File Name: migrate.ts
 * Purpose: v1 (linear steps) → v2 (graph) migration - a v1 flow is a
 *          straight chain: trigger → [condition] → steps. Positions are
 *          generated as a vertical line so the canvas opens tidy.
 *          Idempotent: v2 input returns unchanged.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { AnyFlowDef, FlowDef, FlowDefV2, FlowNodeV2, FlowEdgeV2 } from './types'

const GAP = 120

export function migrateFlow(def: AnyFlowDef): FlowDefV2 {
  if ((def as FlowDefV2).version === 2) return def as FlowDefV2
  const v1 = def as FlowDef

  const nodes: FlowNodeV2[] = []
  const edges: FlowEdgeV2[] = []
  let y = 0
  let prev = 'trigger'

  nodes.push({
    id: 'trigger', kind: 'trigger', position: { x: 0, y },
    data: { type: v1.trigger?.type, typeName: v1.trigger?.typeName },
  })

  if (v1.conditions?.length) {
    y += GAP
    nodes.push({ id: 'gate', kind: 'condition', position: { x: 0, y }, data: { conditions: v1.conditions } })
    edges.push({ id: 'e_trigger_gate', from: prev, to: 'gate' })
    prev = 'gate'
  }

  let first = true
  for (const step of v1.steps ?? []) {
    y += GAP
    nodes.push({
      id: step.id,
      kind: step.action === 'wait' ? 'wait' : 'action',
      position: { x: 0, y },
      data: step.action === 'wait' ? { ...step.config } : { action: step.action, config: step.config },
    })
    edges.push({
      id: `e_${prev}_${step.id}`, from: prev, to: step.id,
      // Leaving the migrated gate rides its yes outlet (v1 skip semantics)
      ...(first && prev === 'gate' ? { outlet: 'yes' } : {}),
    })
    prev = step.id
    first = false
  }

  return {
    version: 2, name: v1.name, description: v1.description, enabled: v1.enabled,
    nodes, edges, updatedBy: v1.updatedBy, updatedAt: v1.updatedAt,
  }
}
