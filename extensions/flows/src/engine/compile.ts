/**
 * File Name: compile.ts
 * Purpose: Validation & compilation - the stage between the builder and
 *          the executor. Produces the adjacency plan the executor walks
 *          and every error a human can fix: missing/extra triggers,
 *          required outlets, cycles, unknown actions, unreachable nodes.
 *          The server refuses to ENABLE a flow with errors (drafts save
 *          freely); the editor shows them inline.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { FlowDefV2, FlowNodeV2 } from './types'
import { knownActions } from './actions'

export interface CompiledFlow {
  /** nodeId → outlet → target nodeId ('' = the single default outlet). */
  out: Record<string, Record<string, string>>
  triggerId: string
}

export interface CompileResult {
  plan?: CompiledFlow
  errors: string[]
  warnings: string[]
  /**
   * The same findings as `errors` and `warnings`, structured (Phase 9B, Unit
   * 3): a code a caller can branch on and the node it belongs to. The string
   * arrays stay for every existing consumer - this is the ONE validator, and
   * it now says WHAT is wrong as well as that something is.
   */
  issues: FlowIssue[]
}

/** One structured finding. `dependency` names the thing that is missing. */
export interface FlowIssue {
  code: FlowIssueCode
  message: string
  nodeId?: string
  dependency?: string
  level: 'error' | 'warning'
}

export type FlowIssueCode =
  | 'TRIGGER_COUNT'
  | 'EDGE_MISSING_NODE'
  | 'OUTLET_CONFLICT'
  | 'OUTLET_MISSING'
  | 'ACTION_UNAVAILABLE'
  | 'STEP_REF_INVALID'
  | 'GRAPH_CYCLE'
  | 'NODE_UNREACHABLE'
  | 'TRIGGER_UNAVAILABLE'
  | 'RETRY_POLICY_INVALID'

export interface CompileOpts {
  /** Extra action names beyond the built-ins (contributed catalog). */
  extraActions?: string[]
}

export function compileFlow(def: FlowDefV2, opts: CompileOpts = {}): CompileResult {
  const errors: string[] = []
  const warnings: string[] = []
  const issues: FlowIssue[] = []
  /** Records a finding in both forms - the strings stay, the structure is new. */
  const fail = (code: FlowIssueCode, message: string, at?: { nodeId?: string; dependency?: string }) => {
    errors.push(message)
    issues.push({ code, message, level: 'error', ...at })
  }
  const warn = (code: FlowIssueCode, message: string, at?: { nodeId?: string }) => {
    warnings.push(message)
    issues.push({ code, message, level: 'warning', ...at })
  }
  const byId = new Map(def.nodes.map((n) => [n.id, n]))

  const triggers = def.nodes.filter((n) => n.kind === 'trigger')
  if (triggers.length !== 1) fail('TRIGGER_COUNT', `A flow needs exactly one trigger node (found ${triggers.length}).`)

  // Adjacency (outlet '' = default single outlet)
  const out: Record<string, Record<string, string>> = {}
  for (const e of def.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) { fail('EDGE_MISSING_NODE', `Edge ${e.id} references a missing node.`); continue }
    const outlet = e.outlet ?? ''
    out[e.from] ??= {}
    if (out[e.from][outlet]) fail('OUTLET_CONFLICT', `Node ${e.from} has two edges on the same outlet '${outlet || 'next'}'.`, { nodeId: e.from })
    out[e.from][outlet] = e.to
  }

  const actionNames = new Set([...knownActions(), 'code', ...(opts.extraActions ?? [])])
  for (const n of def.nodes) {
    const o = out[n.id] ?? {}
    switch (n.kind) {
      case 'condition':
        if (!o['yes']) fail('OUTLET_MISSING', `Condition node ${n.id} needs its 'yes' outlet connected.`, { nodeId: n.id })
        break
      case 'switch':
        if (Object.keys(o).length === 0) fail('OUTLET_MISSING', `Switch node ${n.id} has no outgoing edges.`, { nodeId: n.id })
        break
      case 'loop':
        if (!o['body']) fail('OUTLET_MISSING', `Loop node ${n.id} needs its 'body' outlet connected.`, { nodeId: n.id })
        break
      case 'action':
        if (!actionNames.has(String(n.data.action))) {
          // Deliberately does not claim to know WHY it is absent - a typo, a
          // disabled extension and an uninstalled one look identical from
          // here, and guessing between them would be worse than saying so.
          fail('ACTION_UNAVAILABLE',
            `The action '${String(n.data.action)}' on node ${n.id} is not available in this environment. It may be misspelt, or the extension that provides it may be disabled or uninstalled here.`,
            { nodeId: n.id, dependency: String(n.data.action) })
        }
        break
    }
  }

  // Step refs ({{steps.<id>.…}} templates + raw condition/switch/loop paths)
  // must point to a step that runs BEFORE this node. Positional refs
  // ({{steps.0.…}}) aren't id-validated. Catches typos, renames, and deletes.
  const preds: Record<string, string[]> = {}
  for (const e of def.edges) if (byId.has(e.from) && byId.has(e.to)) (preds[e.to] ??= []).push(e.from)
  const ancestorsOf = (id: string): Set<string> => {
    const seen = new Set<string>()
    const stack = [...(preds[id] ?? [])]
    while (stack.length) {
      const p = stack.pop()!
      if (seen.has(p)) continue
      seen.add(p)
      stack.push(...(preds[p] ?? []))
    }
    return seen
  }
  const STEP_REF = /steps\.([\w-]+)/g
  const collectRefs = (v: unknown, acc: Set<string>): void => {
    if (typeof v === 'string') { for (const m of v.matchAll(STEP_REF)) if (!/^\d+$/.test(m[1])) acc.add(m[1]) }
    else if (Array.isArray(v)) for (const x of v) collectRefs(x, acc)
    else if (v && typeof v === 'object') for (const x of Object.values(v)) collectRefs(x, acc)
  }
  for (const n of def.nodes) {
    const refs = new Set<string>()
    collectRefs(n.data, refs)
    if (!refs.size) continue
    const anc = ancestorsOf(n.id)
    for (const id of refs) {
      if (id === n.id) fail('STEP_REF_INVALID', `Node ${n.id} references its own output ({{steps.${id}}}).`, { nodeId: n.id })
      else if (!byId.has(id)) fail('STEP_REF_INVALID', `Node ${n.id} references {{steps.${id}}}, which is not a step in this flow.`, { nodeId: n.id, dependency: id })
      else if (!anc.has(id)) fail('STEP_REF_INVALID', `Node ${n.id} references {{steps.${id}}}, which does not run before it.`, { nodeId: n.id, dependency: id })
    }
  }

  // Cycle detection (loop body/done outlets are forward edges here too -
  // iteration is executor-internal, the GRAPH itself must stay acyclic)
  const color = new Map<string, 0 | 1 | 2>()
  const dfs = (id: string): boolean => {
    color.set(id, 1)
    for (const next of Object.values(out[id] ?? {})) {
      const c = color.get(next) ?? 0
      if (c === 1) return true
      if (c === 0 && dfs(next)) return true
    }
    color.set(id, 2)
    return false
  }
  for (const n of def.nodes) {
    if ((color.get(n.id) ?? 0) === 0 && dfs(n.id)) {
      fail('GRAPH_CYCLE', `The graph contains a cycle through node ${n.id} - flows must run forward only.`, { nodeId: n.id })
      break
    }
  }

  // Reachability from the trigger
  if (triggers.length === 1) {
    const seen = new Set<string>([triggers[0].id])
    const stack = [triggers[0].id]
    while (stack.length) {
      for (const next of Object.values(out[stack.pop()!] ?? {})) {
        if (!seen.has(next)) { seen.add(next); stack.push(next) }
      }
    }
    for (const n of def.nodes) {
      if (!seen.has(n.id)) warn('NODE_UNREACHABLE', `Node ${n.id} is unreachable from the trigger.`, { nodeId: n.id })
    }
  }

  return errors.length
    ? { errors, warnings, issues }
    : { plan: { out, triggerId: triggers[0].id }, errors, warnings, issues }
}

/** Node lookup helper the executor shares. */
export function nodeById(def: FlowDefV2, id: string): FlowNodeV2 | undefined {
  return def.nodes.find((n) => n.id === id)
}
