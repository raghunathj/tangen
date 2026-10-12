/**
 * File Name: model.ts
 * Purpose: Pure view-model helpers for Studio — which types are Studio-
 *   eligible (a component/blocks field), which field holds the blocks, and
 *   the left-rail tree rows derived from a draft's block array.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure functions only (unit-tested without React). The
 *   preview half of eligibility (livePreview configured for the type) is a
 *   runtime check — the pages ask getPreviewConfig per candidate type.
 */
import type { ComponentDef, FieldDefinition } from '@tangen/types'
import type { BlockPath } from './ops'
import { blockLabel } from './block-label'
import { blockIconName } from './block-icon'
import { isInstanceType } from './instances'

/** The minimal slice of GET /types rows the discovery reads. */
export interface StudioTypeCandidate {
  name: string
  label?: string
  disabled?: boolean
  /** `admin.studio.role` says whether this type holds pages or instances. */
  admin?: { studio?: { role?: unknown } } | null
  fields?: Array<{ name: string; fieldType: string; config?: Record<string, unknown> }>
}

/** A Studio-eligible type: has a blocks field (preview checked at runtime). */
export interface StudioType {
  type: string
  label: string
  blocksField: string
}

/** One left-rail tree row. */
export interface BlockRow {
  key: string
  type: string
  label: string
  hidden: boolean
  /** Index within the row's OWN array (top-level list, or a loop template). */
  index: number
  /** 0 for a top-level block, 1 for a loop item-template widget. */
  depth: number
  /** Locator for setPropAtPath, e.g. [1, 'itemTemplate', 0]. */
  path: BlockPath
  /** Icon NAME for the navigator - resolved to a component by the renderer. */
  icon: string
}

/** The FIRST component field of a type — Studio's blocks field. */
export function findBlocksField(
  fields: FieldDefinition[] | Array<{ name: string; fieldType: string }> | undefined,
  /**
   * Which component field to return. A type may declare several - each is an
   * editable REGION (see lib/regions.ts) - so a caller acting on a specific
   * one must name it. Omitted, the first is returned, which is what every
   * single-region page wants.
   */
  name?: string | null,
): FieldDefinition | null {
  for (const f of fields ?? []) {
    if (f.fieldType !== 'component') continue
    if (!name || f.name === name) return f as FieldDefinition
  }
  return null
}

/**
 * Enabled types that carry a component field, mapped to Studio entries.
 *
 * An INSTANCE type carries one too, and is edited on the same canvas, but it
 * is not a page: it is listed in the Instances panel and referenced from
 * pages, never created as "a new page" or offered in the page switcher. The
 * marker is declared (`admin.studio.role`), because from the outside the two
 * look identical.
 */
export function discoverStudioTypes(types: StudioTypeCandidate[]): StudioType[] {
  const out: StudioType[] = []
  for (const t of types ?? []) {
    if (t.disabled) continue
    if (isInstanceType(t)) continue
    const blocks = findBlocksField(t.fields)
    if (!blocks) continue
    out.push({ type: t.name, label: t.label || t.name, blocksField: blocks.name })
  }
  return out
}

/** Resolve a component def by block `_type`. */
export function defFor(defs: ComponentDef[], type: string): ComponentDef | null {
  return defs.find((d) => d.name === type) ?? null
}

/**
 * Tree rows for the left rail. Labels come from `blockLabel` (an explicit
 * rename, then the block's own content, then the component label). Junk-
 * tolerant: a
 * non-array value yields no rows, non-object entries are dropped, and an
 * entry without a `_key` keys off its index so a half-written draft still
 * renders.
 *
 * The tree descends into the child arrays that are PAGE STRUCTURE: a
 * section's children, a row's columns, and a loop's item template. It must -
 * auto-wrapping puts what you insert inside a section, so without this the
 * block you just added would be invisible and unselectable.
 *
 * The loop's `emptyState`/`errorState` are deliberately NOT structure: they
 * are alternate renderings of the same slot, and listing them inline would
 * imply they appear on the page beside the items.
 */
export function blockRows(blocks: unknown, defs: ComponentDef[]): BlockRow[] {
  if (!Array.isArray(blocks)) return []
  const rows: BlockRow[] = []

  const rowFor = (b: Record<string, unknown>, i: number, depth: number, path: BlockPath): BlockRow => {
    const type = typeof b._type === 'string' ? b._type : ''
    const def = type ? defFor(defs, type) : null
    // Named by CONTENT where it has any - a tree of "Section / Section /
    // Section" tells you nothing about the page.
    const label = blockLabel(b, def)
    return {
      key: typeof b._key === 'string' && b._key ? b._key : `#${i}`,
      type,
      label,
      hidden: b._disabled === true,
      index: i,
      depth,
      path,
      icon: blockIconName(type, def as never),
    }
  }

  /** Child arrays that ARE page structure, in the order they render. */
  const structuralSlots = (b: Record<string, unknown>): string[] => {
    if (b._type === 'kit.section' || b._type === 'kit.container' || b._type === 'kit.div' || b._type === 'kit.grid') return ['children']
    if (b._type === 'kit.row') return ['col1', 'col2', 'col3']
    if (b._type === 'kit.loop') return ['itemTemplate']
    return []
  }

  const walk = (list: unknown[], depth: number, path: BlockPath): void => {
    for (const [i, raw] of list.entries()) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const b = raw as Record<string, unknown>
      rows.push(rowFor(b, i, depth, [...path, i]))
      for (const slot of structuralSlots(b)) {
        const children = b[slot]
        if (Array.isArray(children)) walk(children, depth + 1, [...path, i, slot])
      }
    }
  }

  walk(blocks, 0, [])
  return rows
}
