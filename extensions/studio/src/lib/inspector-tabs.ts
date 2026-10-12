/**
 * File Name: inspector-tabs.ts
 * Purpose: Divides everything the inspector can show for one block into
 *          Content / Style / Advanced, decides which of those tabs are worth
 *          rendering, and keeps a tab selected when the block changes under
 *          it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The split itself is NOT decided here - `fieldGroup`
 *          owns that, so a prop files the same way wherever it appears and
 *          the rule stays one rule. This module only arranges the result.
 *
 *          Panels (the query builder, the class panel) are controls too: a
 *          tab holding only a panel is not empty, and suppressing it would
 *          hide the query builder outright.
 */
import type { SubField } from '@tangen/types'
import { fieldGroup, type FieldGroup } from './field-group'
import { MIGRATED_SLOTS } from './token-migration'

/** A non-field control the inspector hosts. */
export type InspectorPanel = 'query' | 'style'

export interface InspectorItem {
  /** `wrapper` items read and write Studio's reserved `_studio` key. */
  source: 'field' | 'wrapper'
  field: SubField
}

export interface InspectorTab {
  id: FieldGroup
  label: string
  items: InspectorItem[]
  panels: InspectorPanel[]
  /** Controls on the tab - fields and panels alike. */
  count: number
}

export interface InspectorTabsInput {
  /** The block's own declared props. */
  fields: SubField[]
  /** Studio's chrome, supplied for every block (see wrapper.ts). */
  wrapperFields: SubField[]
  /** Props a panel already owns, so they are not ALSO drawn as raw controls. */
  ownedProps?: Set<string>
  panels?: InspectorPanel[]
  /**
   * May this member DESIGN (`studio:design`)? The class panel is the design
   * surface - classes, tokens, tag defaults, interactions - so it is offered
   * only to someone who may change them. Default true: the gate is opt-in,
   * so a caller that has no opinion never accidentally hides styling.
   *
   * The block's OWN style-grouped props are untouched by it: a prop the
   * developer declared is data on the block, saved with the page, and hiding
   * it would take away editing the developer meant everyone to have.
   */
  canDesign?: boolean
}

const ORDER: FieldGroup[] = ['content', 'style', 'advanced']
const LABELS: Record<FieldGroup, string> = {
  content: 'Content',
  style: 'Style',
  advanced: 'Advanced',
}

/** Which tab a panel lives on. */
const PANEL_TAB: Record<InspectorPanel, FieldGroup> = {
  query: 'content',    // a query IS the content - it says what renders
  // The class panel, and since W-3 retired Creative Mode the ONLY styling
  // surface. Always present, which is what keeps the Style tab from
  // vanishing now that the token slots no longer supply it any items.
  style: 'style',
}

/**
 * Groups one block's controls into tabs, dropping any tab that would render
 * empty. Returns tabs in a fixed Content/Style/Advanced order so the rail
 * does not reshuffle as the selection moves.
 */
export function inspectorTabs(input: InspectorTabsInput): InspectorTab[] {
  const owned = input.ownedProps ?? new Set<string>()
  const buckets: Record<FieldGroup, InspectorItem[]> = { content: [], style: [], advanced: [] }

  // The block's own props first, then Studio's added chrome: what the
  // developer declared outranks what Studio supplies for every block.
  for (const field of input.fields) {
    if (owned.has(field.name)) continue
    const group = fieldGroup(field)
    // A token slot the class panel now owns is not rendered again here. Only
    // in the STYLE bucket: a same-named content field is untouched.
    if (group === 'style' && MIGRATED_SLOTS.has(field.name)) continue
    buckets[group].push({ source: 'field', field })
  }
  for (const field of input.wrapperFields) {
    const group = fieldGroup(field)
    // Same guard as above. wrapperFieldsFor no longer returns the box, but a
    // caller passing it directly must not reintroduce the duplicate either.
    if (group === 'style' && MIGRATED_SLOTS.has(field.name)) continue
    buckets[group].push({ source: 'wrapper', field })
  }

  // A panel id with no home is dropped rather than trusted: `creative` was a
  // real id until W-3 retired it, and a stale caller must not be able to
  // resurrect a second styling panel simply by still asking for one.
  const allPanels: InspectorPanel[] = (input.panels ?? []).filter((p) => PANEL_TAB[p])
  // The class panel is on offer for every block rather than only those with a
  // style field of their own - unless this member may not design, in which
  // case there is no styling surface to offer and the Style tab exists only
  // when the block declares style props of its own.
  const canDesign = input.canDesign !== false
  if (canDesign && !allPanels.includes('style')) allPanels.push('style')
  if (!canDesign) {
    for (let i = allPanels.length - 1; i >= 0; i -= 1) {
      if (allPanels[i] === 'style') allPanels.splice(i, 1)
    }
  }

  const tabs: InspectorTab[] = []
  for (const id of ORDER) {
    const panels = allPanels.filter((p) => PANEL_TAB[p] === id)
    const items = buckets[id]
    if (items.length === 0 && panels.length === 0) continue
    tabs.push({ id, label: LABELS[id], items, panels, count: items.length + panels.length })
  }
  return tabs
}

/**
 * The tab to show given the one the user last picked. Selection moves between
 * blocks with different tab sets, so the remembered choice regularly names a
 * tab this block does not have - falling back beats rendering nothing.
 */
export function resolveActiveTab(tabs: InspectorTab[], wanted: FieldGroup | null): FieldGroup | null {
  if (tabs.length === 0) return null
  return tabs.some((t) => t.id === wanted) ? wanted : tabs[0].id
}
