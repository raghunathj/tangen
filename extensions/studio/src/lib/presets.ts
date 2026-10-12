/**
 * File Name: presets.ts
 * Purpose: Pure preset helpers - serialize a block subtree for storage and
 *   clone a stored preset back into a page with FRESH `_key`s at every
 *   depth (repeater rows, nested blocks), content untouched. Presets are
 *   templates WITH content.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** Same key alphabet the admin's component editor mints. */
export function mintBlockKey(): string {
  return Math.random().toString(36).slice(2, 14)
}

/**
 * Deep-clone a block subtree, re-minting `_key` on EVERY object that carries
 * one (the block itself, repeater rows, nested blocks). Content and shape are
 * otherwise identical; the source is never mutated.
 */
export function cloneWithFreshKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => cloneWithFreshKeys(v)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k === '_key' && typeof v === 'string' ? mintBlockKey() : cloneWithFreshKeys(v)
    }
    return out as unknown as T
  }
  return value
}

/** Every `_key` in a subtree (testing/diagnostics). */
export function collectKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, acc)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '_key' && typeof v === 'string') acc.push(v)
      else collectKeys(v, acc)
    }
  }
  return acc
}

/** A stored preset row (extension store, `preset:<id>` keys). */
export interface StudioPreset {
  id: string
  name: string
  block: Record<string, unknown>
  createdBy?: string
  createdAt?: string
  updatedAt?: string
}
