/**
 * File Name: structured-data.ts
 * Purpose: JSON-LD as data (closure plan Phase 9A, Unit 9). Tangen validates
 *          STRUCTURE and bounds and nothing else - implementing Schema.org's
 *          vocabulary is not a CMS's job, and pretending to would be worse
 *          than saying so.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Nothing here executes or renders. The serializer escapes
 *          what would end a <script> element early, because the one place this
 *          data lands is inside one - that escaping is the whole security
 *          story and it lives with the serializer, not with each consumer.
 */
import { STRUCTURED_DATA_LIMITS, type JsonLdNode } from '../contract'

export type StructuredDataCheck =
  | { ok: true; nodes: JsonLdNode[] }
  | { ok: false; reason: 'NOT_AN_OBJECT' | 'MISSING_TYPE' | 'NOT_SERIALIZABLE' | 'TOO_MANY_NODES' | 'TOO_LARGE' | 'TOO_DEEP'; index?: number }

function depthOf(value: unknown, seen = new Set<unknown>()): number {
  if (typeof value !== 'object' || value === null) return 0
  if (seen.has(value)) return Number.POSITIVE_INFINITY
  seen.add(value)
  let max = 0
  for (const child of Object.values(value as Record<string, unknown>)) {
    max = Math.max(max, depthOf(child, seen))
    if (max === Number.POSITIVE_INFINITY) break
  }
  seen.delete(value)
  return max + 1
}

/**
 * Structural validation. What it checks: each node is an object, each has a
 * non-empty `@type`, the whole array serializes, and it stays inside the
 * declared bounds. What it does NOT check: whether `@type` names a real
 * Schema.org type, or whether the properties belong to it. That is the
 * author's responsibility and this function does not pretend otherwise.
 */
export function validateStructuredData(input: unknown): StructuredDataCheck {
  if (!Array.isArray(input)) return { ok: false, reason: 'NOT_AN_OBJECT' }
  if (input.length > STRUCTURED_DATA_LIMITS.maxNodes) return { ok: false, reason: 'TOO_MANY_NODES' }

  for (let i = 0; i < input.length; i++) {
    const node = input[i]
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return { ok: false, reason: 'NOT_AN_OBJECT', index: i }
    const type = (node as Record<string, unknown>)['@type']
    if (typeof type !== 'string' || type.trim() === '') return { ok: false, reason: 'MISSING_TYPE', index: i }
    if (depthOf(node) > STRUCTURED_DATA_LIMITS.maxDepth) return { ok: false, reason: 'TOO_DEEP', index: i }
  }

  let serialized: string
  try { serialized = JSON.stringify(input) } catch { return { ok: false, reason: 'NOT_SERIALIZABLE' } }
  if (serialized === undefined) return { ok: false, reason: 'NOT_SERIALIZABLE' }
  if (Buffer.byteLength(serialized, 'utf8') > STRUCTURED_DATA_LIMITS.maxBytes) return { ok: false, reason: 'TOO_LARGE' }

  return { ok: true, nodes: input as JsonLdNode[] }
}

/**
 * Site defaults first, the object's own nodes after, so a page's own claims
 * read last. A node the object declares with an `@id` the site also used
 * REPLACES it in place; anything else is appended. Two nodes of the same
 * `@type` with no `@id` are two nodes - neither is silently dropped, because
 * a page may legitimately carry several of a kind.
 */
export function mergeStructuredData(siteNodes: JsonLdNode[] = [], objectNodes: JsonLdNode[] = []): JsonLdNode[] {
  const out = [...siteNodes]
  for (const node of objectNodes) {
    const id = typeof node['@id'] === 'string' ? node['@id'] : undefined
    const at = id ? out.findIndex((n) => n['@id'] === id) : -1
    if (at >= 0) out[at] = node
    else out.push(node)
  }
  return out
}

/**
 * JSON for a <script type="application/ld+json"> element. `<`, `>` and `&`
 * become escapes so a value can never close the element early, and U+2028 /
 * U+2029 become escapes because they are line terminators to a JS parser but
 * not to JSON. The output still parses as the same JSON.
 */
export function serializeJsonLd(nodes: JsonLdNode[]): string {
  return JSON.stringify(nodes)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
