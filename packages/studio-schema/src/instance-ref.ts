/**
 * File Name: instance-ref.ts
 * Purpose: The INSTANCE REFERENCE on the wire, and the composition that turns
 *   one into the tree it names.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: An instance is one authored tree used by many pages. A
 *   page stores a REFERENCE to it, never a copy, so that editing the instance
 *   reaches every page without republishing one. Something therefore has to
 *   put the tree where the reference sits, and it has to happen in three
 *   places: the site's renderer, the Studio canvas, and any adapter a site
 *   writes for itself.
 *
 *   That is why this lives in the contract package rather than in the
 *   renderer. Three implementations of "what does a reference mean" is three
 *   chances for the canvas to show something the visitor will not get, which
 *   is the one thing a visual editor may never do.
 *
 *   An unresolvable reference is LEFT IN PLACE rather than dropped. The
 *   renderer knows no `kit.instance` widget, so the block falls through to
 *   the unknown-block policy already in place: nothing rendered by default,
 *   reported where a site asked for placeholders. Dropping it here would
 *   make an instance that failed to publish indistinguishable from one that
 *   was never placed - a silent hole in a page, which is the failure mode a
 *   designer cannot diagnose.
 *
 *   Composition does NOT re-key the borrowed blocks. Their keys are the
 *   instance's own, which is what keeps a block's raw CSS class (derived from
 *   its key) matching the stylesheet the instance published with. The cost is
 *   that placing ONE instance twice on ONE page repeats those keys; the
 *   benefit is that a shared tree's styling means the same thing everywhere,
 *   which is the whole promise of the concept.
 */

/**
 * The wire name of the reference block.
 *
 * Presented as "Instance" everywhere in the UI; the `kit.` name is what keeps
 * it inside the existing block vocabulary and therefore inside the
 * unknown-block degrade policy.
 */
export const INSTANCE_BLOCK_TYPE = 'kit.instance'

/** Block trees by instance id, as the shared artifact carries them. */
export type InstanceTrees = Record<string, unknown>

/** The instance id this block references, or null when it is not a reference. */
export function instanceIdOf(block: unknown): string | null {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null
  const b = block as Record<string, unknown>
  if (b._type !== INSTANCE_BLOCK_TYPE) return null
  const id = typeof b.instanceId === 'string' ? b.instanceId.trim() : ''
  return id === '' ? null : id
}

/**
 * How deep instance-inside-instance nesting may go.
 *
 * A cycle is refused in the editor before it is written, and the chain below
 * refuses one again at compose time. This is the third net, for the case
 * neither can see: data that arrived some other way. A bound is what keeps a
 * bad row from being a hung request.
 */
export const MAX_INSTANCE_DEPTH = 8

/** A shared tree, junk-tolerant: anything that is not a block list is none. */
function treeOf(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

/**
 * The tree a page actually renders: every reference replaced by the instance
 * it names, at any depth, in place.
 *
 * The chain carried down is what stops A -> B -> A rendering forever. A
 * reference whose instance is already being expanded on this branch is left
 * unresolved, exactly like one whose instance does not exist: the page loses
 * that block and reports it, rather than the request never finishing.
 *
 * Identity is preserved where nothing changed, so a page with no references
 * is not copied and its render is byte-identical to what it was before
 * instances existed.
 */
export function composeInstances<T>(blocks: T, instances: InstanceTrees | null | undefined): T {
  if (!instances || Object.keys(instances).length === 0) return blocks
  return composeList(blocks, instances, []) as T
}

/** One list of blocks, with references spliced out for their trees. */
function composeList(value: unknown, instances: InstanceTrees, chain: string[]): unknown {
  if (!Array.isArray(value)) return value
  let changed = false
  const out: unknown[] = []
  for (const entry of value) {
    const id = instanceIdOf(entry)
    if (id !== null) {
      const tree = chain.includes(id) || chain.length >= MAX_INSTANCE_DEPTH ? null : treeOf(instances[id])
      if (tree) {
        changed = true
        // The borrowed tree may itself hold references, so it is composed
        // with this instance on the chain.
        const inner = composeList(tree, instances, [...chain, id]) as unknown[]
        out.push(...inner)
        continue
      }
      // Unresolvable, cyclic or too deep: kept, so the unknown-block policy
      // reports it rather than the page quietly losing a section.
      out.push(entry)
      continue
    }
    const composed = composeBlock(entry, instances, chain)
    if (composed !== entry) changed = true
    out.push(composed)
  }
  return changed ? out : value
}

/** One block, with every nested block list composed. */
function composeBlock(value: unknown, instances: InstanceTrees, chain: string[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const block = value as Record<string, unknown>
  let out: Record<string, unknown> | null = null
  for (const [key, child] of Object.entries(block)) {
    if (!child || typeof child !== 'object') continue
    // Every slot is walked rather than a named list of them: a site's own
    // component may nest blocks under any prop it likes, and a reference
    // that renders on the kit's slots but not on a developer's would be a
    // rule nobody could have read anywhere.
    const composed = Array.isArray(child)
      ? composeList(child, instances, chain)
      : composeBlock(child, instances, chain)
    if (composed === child) continue
    out ??= { ...block }
    out[key] = composed
  }
  return out ?? block
}

/**
 * Every instance id a tree references, deduplicated, at any depth. What a
 * publish needs in order to know which instances a page depends on, and what
 * a usage scan counts.
 */
export function referencedInstances(blocks: unknown): string[] {
  const found = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const entry of value) walk(entry); return }
    if (!value || typeof value !== 'object') return
    const block = value as Record<string, unknown>
    const id = instanceIdOf(block)
    if (id !== null) found.add(id)
    for (const child of Object.values(block)) {
      if (child && typeof child === 'object') walk(child)
    }
  }
  walk(blocks)
  return [...found]
}
