/**
 * File Name: porter-blocks.ts
 * Purpose: The promote-time check Porter was missing - whether the TARGET
 *          environment can actually render the blocks a page is made of.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Porter validates TYPES and FIELDS, but never looked
 *          inside a component field's VALUES. So a page using a block the
 *          target has never heard of passed validation cleanly and arrived
 *          on the live site as nothing - the failure appeared at render
 *          time, to a visitor, with no signal at promote time.
 *
 *          The two causes need different messages because they need
 *          different fixes: a missing SITE component means the schema has
 *          not been deployed there yet, while a missing `kit.*` block means
 *          that environment is running an older Studio than the one the
 *          page was built with.
 */

/** A block type the target cannot render, and why. */
export interface BlockTypeBlocker {
  blockType: string
  /** 'schema' = deploy the site; 'runtime' = upgrade Studio there. */
  cause: 'schema' | 'runtime'
  reason: string
}

const isBlock = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && typeof (v as { _type?: unknown })._type === 'string'

/**
 * Every distinct block `_type` anywhere inside a value - through section
 * children, row columns, loop templates, repeater rows and plain nesting
 * alike, since a page can put a block almost anywhere.
 */
export function collectBlockTypes(value: unknown): string[] {
  const found = new Set<string>()
  const seen = new Set<unknown>()   // a cyclic value must not spin forever

  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return
    if (seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) { for (const item of v) walk(item); return }
    if (isBlock(v)) found.add(v._type as string)
    for (const inner of Object.values(v as Record<string, unknown>)) walk(inner)
  }

  walk(value)
  return [...found]
}

/**
 * Which of those the target cannot render. `available` is the union of every
 * component name the target's schema allows plus whatever its Studio runtime
 * ships.
 */
export function classifyMissingBlockTypes(
  used: string[],
  available: string[],
): BlockTypeBlocker[] {
  const have = new Set(available)
  const out: BlockTypeBlocker[] = []
  for (const blockType of used) {
    if (have.has(blockType)) continue
    const isKit = blockType.startsWith('kit.')
    out.push({
      blockType,
      cause: isKit ? 'runtime' : 'schema',
      reason: isKit
        ? `"${blockType}" is a Studio block this environment does not know. Update @tangen/ext-studio there, then promote again.`
        : `"${blockType}" is not in this environment's component vocabulary. Deploy the site's schema here first, then promote again.`,
    })
  }
  return out
}
