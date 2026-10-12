/**
 * File Name: ops.ts
 * Purpose: Pure Studio tree operations that the admin's component-editor
 *   library does not already ship. Reorder, duplicate and remove are REUSED
 *   from '@/lib/component-editor' in the page (never forked here) - this
 *   module only adds the hide/show toggle.
 *
 * Author: Raghunath J
 * License: MIT
 */

export interface StudioBlock {
  _type: string
  _key: string
  _disabled?: boolean
  _label?: string
  [field: string]: unknown
}

/**
 * Toggle a block's hidden state. Hiding sets `_disabled: true`; showing
 * REMOVES the flag entirely (the platform treats an absent flag as visible,
 * and hidden blocks already skip publish). Returns a new array; out-of-range
 * indices are a no-op returning the input unchanged.
 */
export function toggleBlockHidden(blocks: StudioBlock[], index: number): StudioBlock[] {
  if (index < 0 || index >= blocks.length) return blocks
  const next = [...blocks]
  const block = { ...next[index] }
  if (block._disabled === true) delete block._disabled
  else block._disabled = true
  next[index] = block
  return next
}

/**
 * Locates one block in the tree: alternating array indices and child-array
 * prop names, e.g. `[2]` (third top-level block) or `[1, 'itemTemplate', 0]`
 * (first widget in the second block's loop template). BlockRow carries one.
 */
export type BlockPath = Array<number | string>

/** Reads the block at `path`, or null when the path does not resolve. */
export function blockAtPath(blocks: StudioBlock[], path: BlockPath): StudioBlock | null {
  let list: unknown = blocks
  let block: StudioBlock | null = null
  for (const [i, step] of path.entries()) {
    if (i % 2 === 0) {
      if (!Array.isArray(list) || typeof step !== 'number') return null
      const entry = list[step]
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      block = entry as StudioBlock
    } else {
      if (!block || typeof step !== 'string') return null
      list = (block as Record<string, unknown>)[step]
      block = null
    }
  }
  return block
}

/**
 * Immutably writes one prop on the block at `path`, copying only the spine
 * down to it - siblings keep their identity, so React re-renders the touched
 * branch alone. An unreachable path returns the input UNCHANGED (reference-
 * equal), matching toggleBlockHidden's no-op contract.
 */
export function setPropAtPath(
  blocks: StudioBlock[],
  path: BlockPath,
  name: string,
  value: unknown,
): StudioBlock[] {
  if (path.length === 0) return blocks

  const index = path[0]
  if (typeof index !== 'number' || index < 0 || index >= blocks.length) return blocks
  const block = blocks[index]
  if (!block || typeof block !== 'object') return blocks

  let updated: StudioBlock
  if (path.length === 1) {
    updated = { ...block, [name]: value }
  } else {
    const prop = path[1]
    if (typeof prop !== 'string') return blocks
    const children = (block as Record<string, unknown>)[prop]
    if (!Array.isArray(children)) return blocks
    const inner = setPropAtPath(children as StudioBlock[], path.slice(2), name, value)
    if (inner === children) return blocks          // nothing changed below
    updated = { ...block, [prop]: inner }
  }

  const next = [...blocks]
  next[index] = updated
  return next
}

/**
 * Applies a transform to the sibling ARRAY that contains `path`, rebuilding
 * only the spine down to it. Returns the input unchanged (reference-equal)
 * when the path does not resolve or the transform declines - which is how
 * every op below gets its no-op contract for free.
 */
function atContainer(
  blocks: StudioBlock[],
  path: BlockPath,
  transform: (list: StudioBlock[], index: number) => StudioBlock[] | null,
): StudioBlock[] {
  if (path.length === 0) return blocks
  const index = path[path.length - 1]
  if (typeof index !== 'number') return blocks

  if (path.length === 1) {
    if (index < 0 || index >= blocks.length) return blocks
    return transform(blocks, index) ?? blocks
  }

  const head = path[0]
  const prop = path[1]
  if (typeof head !== 'number' || typeof prop !== 'string') return blocks
  if (head < 0 || head >= blocks.length) return blocks
  const parent = blocks[head]
  if (!parent || typeof parent !== 'object') return blocks
  const children = (parent as Record<string, unknown>)[prop]
  if (!Array.isArray(children)) return blocks

  const inner = atContainer(children as StudioBlock[], path.slice(2), transform)
  if (inner === children) return blocks
  const next = [...blocks]
  next[head] = { ...parent, [prop]: inner }
  return next
}

/**
 * Moves a block among its own siblings by `delta`. Refuses to move past
 * either end rather than wrapping around - a Move up on the first block
 * should do nothing, not send it to the bottom.
 */
export function moveAtPath(blocks: StudioBlock[], path: BlockPath, delta: number): StudioBlock[] {
  return atContainer(blocks, path, (list, i) => {
    const to = i + delta
    if (to < 0 || to >= list.length) return null
    const next = [...list]
    const [moved] = next.splice(i, 1)
    next.splice(to, 0, moved)
    return next
  })
}

/** Deep-clones a block, minting a fresh key at every depth. */
function cloneFresh(value: unknown, mintKey: () => string): unknown {
  if (Array.isArray(value)) return value.map((v) => cloneFresh(v, mintKey))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k === '_key' ? mintKey() : cloneFresh(v, mintKey)
    }
    return out
  }
  return value
}

/**
 * Copies a block in beside itself. Keys are re-minted at EVERY depth -
 * sharing one would make the copies indistinguishable to selection, which
 * addresses blocks by key.
 */
export function duplicateAtPath(
  blocks: StudioBlock[],
  path: BlockPath,
  mintKey: () => string,
): StudioBlock[] {
  return atContainer(blocks, path, (list, i) => {
    const copy = cloneFresh(list[i], mintKey) as StudioBlock
    const next = [...list]
    next.splice(i + 1, 0, copy)
    return next
  })
}

/**
 * Swaps the block at `path` for a list of blocks in its place - none, one, or
 * many. The seam DETACH needs: a reference to an instance becomes the
 * instance's own blocks, right where the reference stood, owned by the page
 * from then on. An empty replacement is a removal, which is why `removeAtPath`
 * is not a special case of it - a caller that means "delete" should say so.
 */
export function replaceAtPath(
  blocks: StudioBlock[],
  path: BlockPath,
  replacement: StudioBlock[],
): StudioBlock[] {
  return atContainer(blocks, path, (list, i) => [...list.slice(0, i), ...replacement, ...list.slice(i + 1)])
}

/** Removes a block from its own siblings. */
export function removeAtPath(blocks: StudioBlock[], path: BlockPath): StudioBlock[] {
  return atContainer(blocks, path, (list, i) => list.filter((_, j) => j !== i))
}
