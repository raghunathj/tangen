/**
 * File Name: conditions.ts
 * Purpose: Condition evaluation - the IF between trigger and actions.
 *          AND semantics (every row must hold), numeric coercion so
 *          values typed into the builder ('500') compare correctly.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { FlowCondition, FlowScope } from './types'
import { lookupPath as lookup } from './template'

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return null
}

function holds(cond: FlowCondition, scope: FlowScope): boolean {
  const actual = lookup(cond.path, scope)
  switch (cond.op) {
    case 'exists':
      return actual != null
    case 'eq': {
      const an = asNumber(actual), bn = asNumber(cond.value)
      if (an != null && bn != null) return an === bn
      return String(actual) === String(cond.value)
    }
    case 'neq': {
      const an = asNumber(actual), bn = asNumber(cond.value)
      if (an != null && bn != null) return an !== bn
      return String(actual) !== String(cond.value)
    }
    case 'gt': {
      const an = asNumber(actual), bn = asNumber(cond.value)
      return an != null && bn != null && an > bn
    }
    case 'lt': {
      const an = asNumber(actual), bn = asNumber(cond.value)
      return an != null && bn != null && an < bn
    }
    case 'contains': {
      if (Array.isArray(actual)) return actual.map(String).includes(String(cond.value))
      return typeof actual === 'string' && actual.includes(String(cond.value))
    }
    case 'not_contains': {
      if (Array.isArray(actual)) return !actual.map(String).includes(String(cond.value))
      // A missing/undefined value trivially doesn't contain → true (run-once works
      // even when trigger.labels is absent).
      return !(typeof actual === 'string' && actual.includes(String(cond.value)))
    }
    default:
      return false
  }
}

/** True when EVERY condition holds (empty list ⇒ always run). */
export function evaluateConditions(conditions: FlowCondition[], scope: FlowScope): boolean {
  return conditions.every((c) => holds(c, scope))
}
