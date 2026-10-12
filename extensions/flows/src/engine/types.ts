/**
 * File Name: types.ts
 * Purpose: The Flow model - one trigger, AND-ed conditions, a linear list
 *          of action steps. Deliberately Shopify-Flow-shaped: simple
 *          enough for a marketing team, no branching, no DAGs.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** Operators a condition row supports (typed pickers in the builder). */
export type ConditionOp = 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'not_contains' | 'exists'

export interface FlowCondition {
  /** Dot-path into the scope, e.g. 'trigger.data.price'. */
  path: string
  op: ConditionOp
  value?: unknown
}

export interface FlowStep {
  /** Stable id within the flow (step_1…); referenced in run logs. */
  id: string
  /** Action name from the registry: 'http' | 'content' | 'log' | 'wait'. */
  action: string
  /** Action-specific config; string values support {{…}} templates. */
  config: Record<string, unknown>
}

export interface FlowDef {
  version: 1
  name: string
  description?: string
  enabled: boolean
  trigger: {
    /** Platform event type, e.g. 'object.published', 'form.submitted'. */
    type: string
    /** Restrict object events to one content type (optional). */
    typeName?: string
  }
  conditions: FlowCondition[]
  steps: FlowStep[]
  updatedBy?: string | null
  updatedAt?: string
  /**
   * The member this flow runs AS by default (kernel K6): their CURRENT
   * authority, re-resolved on every execution and never snapshotted. Set to
   * the creator; a flow saved before K6 falls back to `updatedBy`.
   */
  owner?: string | null
  /** `'owner'` (default), `'initiator'` (the member or key whose event triggered the run) or `'identity'` (a service or agent identity, K8). */
  runAs?: 'owner' | 'initiator' | 'identity'
  /** The service or agent identity the flow runs as when `runAs` is `'identity'`: a flow that outlives its people. */
  identity?: string | null
}

/** What templates and conditions resolve against during a run. */
export interface FlowScope {
  trigger: Record<string, unknown>
  /** Prior step outputs, in step order - the positional `{{steps.N.…}}` shim. */
  steps: Array<Record<string, unknown>>
  /**
   * Step outputs keyed by node id → `{{steps.<id>.output.…}}`. The id-keyed
   * form is stable across edits/reordering (unlike positional indices) and is
   * what the builder's token picker emits. Wrapped in `{ output }` to leave
   * room for future per-step metadata (ok/error/…).
   */
  stepsById?: Record<string, { output: unknown }>
  /** Inside a loop body: the current item and its index. */
  item?: unknown
  itemIndex?: number
}

/** One line of a run's step log (stored in the run's meta). */
export interface StepLogEntry {
  step: string
  action: string
  ok: boolean
  ms: number
  output?: unknown
  /** Human-readable, kept for the existing Admin views. */
  error?: string
  /** Which attempt produced this line. 1 for the first (Phase 9B). */
  attempt?: number
  /** The typed, redacted failure. `error` is its message (Phase 9B). */
  failure?: import('./failure').FlowFailure
}

// ── FlowDefV2 - the graph model (canvas, branching) ──────────────────────────

/** Node kinds the compiler and executor understand. */
export type FlowNodeKind =
  | 'trigger' | 'condition' | 'switch' | 'transform' | 'wait' | 'loop' | 'action'

export interface FlowNodeV2 {
  id: string
  kind: FlowNodeKind
  /** Canvas position - persisted so rearranging sticks. */
  position: { x: number; y: number }
  /**
   * Kind-specific payload:
   *  trigger   { type, typeName? }
   *  condition { conditions: FlowCondition[] }         outlets yes / no
   *  switch    { path, cases: string[] }               outlets case:<v> / default
   *  transform { output: Record<string, unknown> }     templated object
   *  wait      { minutes?, hours?, days? }
   *  loop      { path, limit? }                        outlets body / done
   *  action    { action, config }
   */
  data: Record<string, unknown>
}

export interface FlowEdgeV2 {
  id: string
  from: string
  to: string
  /** Which outlet of `from` this leaves: 'yes'|'no'|'case:<v>'|'default'|'body'|'done'; absent = the single default outlet. */
  outlet?: string
}

export interface FlowDefV2 {
  version: 2
  name: string
  description?: string
  enabled: boolean
  nodes: FlowNodeV2[]
  edges: FlowEdgeV2[]
  updatedBy?: string | null
  updatedAt?: string
  /**
   * The member this flow runs AS by default (kernel K6): their CURRENT
   * authority, re-resolved on every execution and never snapshotted. Set to
   * the creator; a flow saved before K6 falls back to `updatedBy`.
   */
  owner?: string | null
  /** `'owner'` (default), `'initiator'` (the member or key whose event triggered the run) or `'identity'` (a service or agent identity, K8). */
  runAs?: 'owner' | 'initiator' | 'identity'
  /** The service or agent identity the flow runs as when `runAs` is `'identity'`: a flow that outlives its people. */
  identity?: string | null
}

/** Either model - the engine migrates v1 on the way in. */
export type AnyFlowDef = FlowDef | FlowDefV2
