/**
 * File Name: palette.ts
 * Purpose: Pure palette model for Studio's "Add section" panel - resolve the
 *   blocks field's allowed components (inline defs + reusable names against
 *   the workspace registry), group them for display, letter-tile fallback
 *   when a def has no thumbnail, and positional insertion.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: New blocks are built by the page with the admin's own
 *   buildEmptyBlock ('@/lib/component-editor') - the mint stays unforked.
 */
import type { ComponentDef } from '@tangen/types'

/** The slice of the reusable-component registry rows the resolver reads. */
export interface RegistryComponent {
  name: string
  label?: string
  description?: string
  group?: string
  thumbnail?: string
  fields?: unknown[]
  /** The registry def's protection declaration, carried through as data. */
  protection?: unknown
}

/**
 * The palette's vocabulary: a blocks field's `config.components` entries.
 * Inline defs pass through; string entries are reusable-component NAMES and
 * resolve against the workspace registry (GET /admin/schema/components).
 * Names the registry cannot resolve are dropped - nothing to render or
 * insert for them.
 */
export function resolvePaletteComponents(
  entries: Array<string | ComponentDef> | undefined,
  registry: RegistryComponent[] | undefined,
): ComponentDef[] {
  const out: ComponentDef[] = []
  for (const entry of entries ?? []) {
    if (typeof entry !== 'string') { out.push(entry); continue }
    const hit = (registry ?? []).find((r) => r.name === entry)
    if (!hit) continue
    out.push({
      name: hit.name,
      label: hit.label || hit.name,
      description: hit.description,
      group: hit.group,
      thumbnail: hit.thumbnail,
      fields: (hit.fields ?? []) as ComponentDef['fields'],
      // A registry Block's protection must reach the panel like an inline
      // one's: dropping it here would make every reusable Block Open.
      ...(hit.protection !== undefined ? { protection: hit.protection as ComponentDef['protection'] } : {}),
    })
  }
  return out
}

export interface PaletteGroup {
  name: string
  defs: ComponentDef[]
}

/** Group defs by their `group` name; ungrouped defs lead under "Components". */
export function paletteGroups(defs: ComponentDef[]): PaletteGroup[] {
  const groups: PaletteGroup[] = []
  for (const def of defs) {
    const name = def.group || 'Components'
    let g = groups.find((x) => x.name === name)
    if (!g) { g = { name, defs: [] }; groups.push(g) }
    g.defs.push(def)
  }
  return groups
}

/** The auto letter-tile fallback when a def ships no thumbnail. */
export function letterTile(label: string): string {
  const c = label.trim().charAt(0)
  return c ? c.toUpperCase() : '?'
}

/**
 * Insert a block at a position (clamped to [0, length]). Returns a new
 * array - the input is never mutated.
 */
export function insertBlockAt<T>(blocks: T[], block: T, index: number): T[] {
  const at = Math.max(0, Math.min(index, blocks.length))
  const next = [...blocks]
  next.splice(at, 0, block)
  return next
}

/** Studio's own primitives are namespaced; everything else is the site's. */
const KIT_PREFIX = 'kit.'

/**
 * Blocks that are valid CONTENT but are not offered as palette tiles.
 *
 * A `kit.instance` is a reference, and a reference with no instance chosen
 * points at nothing: a tile that mints one would be a control that appears to
 * work. It is placed from the Instances panel, where you pick WHICH instance,
 * and it stays in the components list so drops, child restrictions and the
 * unknown-block policy all keep treating it as a real block.
 */
const NOT_IN_PALETTE = new Set(['kit.instance'])

/**
 * Splits the palette by ORIGIN. One combined list made a marketer scroll past
 * kit.divider to reach the section their developer built, which are different
 * things: Elements are Studio's primitives, Components are what this site
 * declared. Matching is on the `kit.` PREFIX, so a component named
 * "kitchen_sink" stays where it belongs.
 */
export function splitPalette(defs: ComponentDef[]): {
  elements: ComponentDef[]
  components: ComponentDef[]
} {
  const elements: ComponentDef[] = []
  const components: ComponentDef[] = []
  for (const def of defs ?? []) {
    if (!def || typeof def !== 'object' || typeof def.name !== 'string') continue
    if (NOT_IN_PALETTE.has(def.name)) continue
    ;(def.name.startsWith(KIT_PREFIX) ? elements : components).push(def)
  }
  return { elements, components }
}
