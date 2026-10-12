/**
 * File Name: template.ts
 * Purpose: The {{…}} variable resolver - dot-path lookups into the run
 *          scope (trigger payload + prior step outputs). Values only,
 *          never code: there is no expression language to inject through.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A missing path renders as '' (flows keep running);
 *          a template that is EXACTLY one token returns the raw value so
 *          numbers/arrays survive into action configs untouched.
 */
import type { FlowScope } from './types'

const TOKEN = /\{\{\s*([\w.[\]-]+)\s*\}\}/g

/**
 * Resolve a dot-path against the run scope. `steps.<id>.…` resolves against the
 * id-keyed step map (stable across edits) when the segment names a known step;
 * otherwise it falls through to the positional array (`steps.0.…` back-compat).
 * Node ids are never bare integers, so the two forms never collide.
 */
export function lookupPath(path: string, scope: FlowScope): unknown {
  const parts = path.split('.')
  if (
    parts[0] === 'steps' && parts.length >= 2 &&
    scope.stepsById && Object.prototype.hasOwnProperty.call(scope.stepsById, parts[1])
  ) {
    let cur: unknown = scope.stepsById[parts[1]]
    for (let i = 2; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[parts[i]]
    }
    return cur
  }
  let cur: unknown = scope
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

const lookup = lookupPath

/** Resolves {{path}} tokens in one string (single-token ⇒ raw value). */
export function resolveTemplate(input: string, scope: FlowScope): unknown {
  const exact = input.match(/^\{\{\s*([\w.[\]-]+)\s*\}\}$/)
  if (exact) return lookup(exact[1], scope)
  return input.replace(TOKEN, (_, path: string) => {
    const v = lookup(path, scope)
    if (v == null) return ''
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

/** Walks any config shape, resolving every string leaf. */
export function resolveDeep<T>(value: T, scope: FlowScope): T {
  if (typeof value === 'string') return resolveTemplate(value, scope) as T
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, scope)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveDeep(v, scope)]),
    ) as T
  }
  return value
}
