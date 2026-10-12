/**
 * File Name: runnable.ts
 * Purpose: Whether a flow can run RIGHT NOW, and if not, exactly why (closure
 *          plan Phase 9B, Units 3, 4 and 5).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: DERIVED on every ask, never stored. A persisted boolean
 *          would go on saying "runnable" about a flow whose extension was
 *          uninstalled an hour ago, and the drift would be invisible.
 *
 *          It is also separate from `enabled`. Enabled is what the OPERATOR
 *          asked for; runnable is what the environment can currently deliver.
 *          Collapsing them would mean a broken flow silently disabling itself,
 *          and the operator's intent being lost when the dependency came back.
 */
import { compileFlow, type FlowIssue } from './compile'
import { migrateFlow } from './migrate'
import { parseRetryPolicy } from './retry'
import type { AnyFlowDef } from './types'

export interface RunnableState {
  runnable: boolean
  issues: FlowIssue[]
}

export interface RunnableInput {
  /** Every action name available in THIS workspace x environment right now. */
  actionNames: string[]
  /**
   * Every trigger type currently offered. An EMPTY list means "the caller did
   * not ask", not "nothing exists" - a runtime without a catalogue must not
   * condemn every flow it holds.
   */
  triggerTypes: string[]
}

/**
 * Compiles the flow against what is available here and returns the structured
 * verdict. The compiler is the one validator (Unit 3); this adds the two
 * checks it cannot make on its own - the trigger's availability and whether a
 * retry policy can be honoured - and never duplicates the rest.
 */
export function runnableState(anyDef: AnyFlowDef, input: RunnableInput): RunnableState {
  const def = migrateFlow(anyDef)
  const compiled = compileFlow(def, { extraActions: input.actionNames })
  const issues: FlowIssue[] = [...compiled.issues]

  if (input.triggerTypes.length) {
    for (const node of def.nodes) {
      if (node.kind !== 'trigger') continue
      const type = String(node.data.type ?? '')
      if (type && !input.triggerTypes.includes(type)) {
        issues.push({
          code: 'TRIGGER_UNAVAILABLE',
          level: 'error',
          nodeId: node.id,
          dependency: type,
          message: `The trigger '${type}' is not available in this environment. The extension that provides it may be disabled or uninstalled here.`,
        })
      }
    }
  }

  for (const node of def.nodes) {
    if (node.kind !== 'action') continue
    const { issues: policyIssues } = parseRetryPolicy(node.data.retry ?? node.data)
    for (const message of policyIssues) {
      issues.push({ code: 'RETRY_POLICY_INVALID', level: 'error', nodeId: node.id, message: `Retry policy on node ${node.id}: ${message}.` })
    }
  }

  return { runnable: !issues.some((i) => i.level === 'error'), issues }
}
