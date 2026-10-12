/**
 * File Name: component-editor.ts
 * Purpose: Pure functional helpers for managing ordered arrays of component blocks —
 *          add, remove, move, reorder, duplicate, filter, and preview generation.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on @tangen/types (ComponentDef). All functions return new arrays — no mutation.
 */
import type { ComponentDef } from '@tangen/types'
import { evalVisibility } from './editor'

export interface ComponentBlock {
  _type: string
  _key: string
  [field: string]: unknown
}

/**
 * Creates a new ComponentBlock for the given definition, initializing all fields to null and
 * generating a random key.
 * @param def - The component definition that describes the block's type and fields
 * @returns A new block with _type, _key, and null values for every field
 */
// TODO: replace Math.random() key generation with crypto.randomUUID() for stronger uniqueness guarantees
export function buildEmptyBlock(def: ComponentDef): ComponentBlock {
  const block: ComponentBlock = {
    _type: def.name,
    _key: Math.random().toString(36).slice(2, 14),
  }
  for (const field of def.fields) {
    block[field.name] = null
  }
  return block
}

/**
 * Appends a new empty block of the given component type to the end of the array.
 * @param blocks - Current block array
 * @param def - Component definition for the block to add
 * @returns A new array with the new block appended
 */
export function addBlock(blocks: ComponentBlock[], def: ComponentDef): ComponentBlock[] {
  return [...blocks, buildEmptyBlock(def)]
}

/**
 * Returns a new array with the block at the given index removed.
 * @param blocks - Current block array
 * @param index - Zero-based index of the block to remove
 * @returns A new array without the specified block
 */
export function removeBlock(blocks: ComponentBlock[], index: number): ComponentBlock[] {
  return blocks.filter((_, i) => i !== index)
}

/**
 * Swaps the block at the given index with the one immediately above it; no-op when index is 0.
 * @param blocks - Current block array
 * @param index - Zero-based index of the block to move up
 * @returns A new array with the block moved, or the original array unchanged
 */
export function moveBlockUp(blocks: ComponentBlock[], index: number): ComponentBlock[] {
  if (index <= 0) return blocks
  const next = [...blocks]
  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
  return next
}

/**
 * Swaps the block at the given index with the one immediately below it; no-op when index is the last.
 * @param blocks - Current block array
 * @param index - Zero-based index of the block to move down
 * @returns A new array with the block moved, or the original array unchanged
 */
export function moveBlockDown(blocks: ComponentBlock[], index: number): ComponentBlock[] {
  if (index >= blocks.length - 1) return blocks
  const next = [...blocks]
  ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
  return next
}

/**
 * Moves a block from one position to another using splice; no-op when indices are equal or out of bounds.
 * @param blocks - Current block array
 * @param fromIndex - Zero-based source index
 * @param toIndex - Zero-based destination index
 * @returns A new reordered array, or the original array when no move is needed
 */
export function reorderBlocks(
  blocks: ComponentBlock[],
  fromIndex: number,
  toIndex: number,
): ComponentBlock[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= blocks.length ||
    toIndex >= blocks.length
  ) {
    return blocks
  }
  const next = [...blocks]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

/**
 * Inserts a shallow copy of the block at index immediately after it, with a new random key and
 * a "(copy)" suffix appended to any existing _label.
 * @param blocks - Current block array
 * @param index - Zero-based index of the block to duplicate
 * @returns A new array with the duplicate inserted after the source block
 */
export function duplicateBlock(blocks: ComponentBlock[], index: number): ComponentBlock[] {
  if (index < 0 || index >= blocks.length) return blocks
  const original = blocks[index]
  const existingLabel = original._label as string | undefined
  const copy: ComponentBlock = {
    ...original,
    _key: Math.random().toString(36).slice(2, 14),
    ...(existingLabel ? { _label: `${existingLabel} (copy)` } : {}),
    _disabled: undefined,
  }
  const next = [...blocks]
  next.splice(index + 1, 0, copy)
  return next
}

/**
 * Returns component definitions whose name or label contains the query string (case-insensitive).
 * @param components - Full list of available component definitions
 * @param query - Search string; returns all components when empty or whitespace-only
 * @returns Filtered array of matching component definitions
 */
export function filterComponents(components: ComponentDef[], query: string): ComponentDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return components
  return components.filter(
    (c) => c.name.toLowerCase().includes(q) || c.label.toLowerCase().includes(q),
  )
}

/**
 * Clamps an index to the valid range [0, length-1]; returns 0 for an empty array.
 * @param index - Unclamped index value
 * @param length - Length of the target array
 * @returns A safe index within bounds
 */
export function clampIndex(index: number, length: number): number {
  if (length === 0) return 0
  return Math.max(0, Math.min(index, length - 1))
}

const PREVIEW_SKIP_TYPES = new Set(['component', 'richtext', 'media', 'relation', 'repeater'])
const PREVIEW_MAX_FIELDS = 3
const PREVIEW_MAX_VALUE_LEN = 60

/**
 * Generates a short comma-separated preview string from a block's primitive field values.
 * Complex field types (component, richtext, media, relation, repeater) are skipped.
 * The preview is capped at 3 fields and each value is truncated to 60 characters.
 * @param block - The component block instance to summarize
 * @param def - The component definition describing the block's fields
 * @returns A human-readable preview string, or an empty string when no previewable fields exist
 */
export function buildBlockPreview(block: ComponentBlock, def: ComponentDef): string {
  const parts: string[] = []
  for (const field of def.fields) {
    if (parts.length >= PREVIEW_MAX_FIELDS) break
    if (PREVIEW_SKIP_TYPES.has(field.fieldType)) continue
    const raw = block[field.name]
    if (raw == null || raw === '') continue
    let str: string
    if (typeof raw === 'boolean') {
      str = raw ? 'Yes' : 'No'
    } else {
      str = String(raw)
    }
    if (str.length > PREVIEW_MAX_VALUE_LEN) str = str.slice(0, PREVIEW_MAX_VALUE_LEN) + '…'
    parts.push(`${field.label}: ${str}`)
  }
  return parts.join(', ')
}

/**
 * Block-level conditional visibility: only defs whose conditionalVisibility passes
 * against the ENTRY's current values are offered/rendered. No rule = always visible.
 */
export function visibleComponentDefs<T extends { conditionalVisibility?: unknown }>(
  defs: T[],
  getValue: (field: string) => unknown,
): T[] {
  return defs.filter((d) => {
    const cv = d.conditionalVisibility as import('@tangen/types').ConditionalVisibility | undefined
    return !cv || evalVisibility(cv, getValue)
  })
}
