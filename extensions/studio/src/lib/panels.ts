/**
 * File Name: panels.ts
 * Purpose: The icon rail's panel model - which panels exist, what clicking
 *          the rail does, the bounds a resized rail is held to, and the
 *          arithmetic of dragging either rail's edge.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure data + pure functions, so the rail's behaviour is
 *          testable without React. Only panels that EXIST are listed -
 *          Theme, Assets and Localization arrive with their own arcs, and
 *          listing them early would put dead icons in front of a marketer.
 *          Icons are named, not imported, so this module stays free of the
 *          admin's icon bundle.
 */

export interface StudioPanel {
  id: string
  label: string
  /** Icon name resolved by the rail component. */
  icon: string
}

/** The rail, top to bottom. Blocks leads - it is what you came to edit. */
export const STUDIO_PANELS: StudioPanel[] = [
  { id: 'blocks', label: 'Navigator', icon: 'tree' },
  { id: 'elements', label: 'Elements', icon: 'plus' },
  { id: 'components', label: 'Components', icon: 'components' },
  // Instances sit beside Components because that is what they are to the
  // person placing one: something you pick and put on the page. What makes
  // it different - every placement is the same tree - is what the panel and
  // the tree row say, not where the icon lives.
  { id: 'instances', label: 'Instances', icon: 'instances' },
  { id: 'media', label: 'Media', icon: 'media' },
  { id: 'data', label: 'Data', icon: 'data' },
  { id: 'variables', label: 'Variables', icon: 'variables' },
  { id: 'pages', label: 'Pages', icon: 'pages' },
]

export interface PanelState {
  panel: string
  open: boolean
}

/** Panels that only exist for a member who may DESIGN (decision 3). */
const DESIGN_PANELS = new Set(['variables'])

/**
 * The rail this member actually gets.
 *
 * The Variables panel writes the workspace THEME - token values and fonts
 * that reach every page of every site in the workspace - so it belongs to
 * `studio:design`, not to `studio:edit`. Hidden rather than shown disabled:
 * a rail button that opens a panel where nothing can be saved is a control
 * that appears to work and does not.
 */
export function studioPanels(access: { canDesign: boolean }): StudioPanel[] {
  if (access.canDesign) return STUDIO_PANELS
  return STUDIO_PANELS.filter((p) => !DESIGN_PANELS.has(p.id))
}

/**
 * The panel state to actually render, given the one that was remembered.
 *
 * The remembered panel is a WISH, like the inspector's remembered tab: a
 * member whose rights changed (or who was shown a rail their role does not
 * have) must land on a panel that exists rather than on an empty rail.
 */
export function resolvePanel(panels: StudioPanel[], state: PanelState): PanelState {
  if (panels.some((p) => p.id === state.panel)) return state
  const first = panels[0]
  return first ? { panel: first.id, open: state.open } : state
}

/** Panel width bounds - narrow enough to read, never wide enough to eat the canvas. */
export const PANEL_MIN = 200
export const PANEL_MAX = 480
export const DEFAULT_PANEL_WIDTH = 256

/** Persisted per user; the canvas is the subject, so the layout should stay put. */
export const PANEL_WIDTH_KEY = 'tangen:studio:panel-width'

export function panelById(id: string): StudioPanel | null {
  return STUDIO_PANELS.find((p) => p.id === id) ?? null
}

/**
 * Clicking the rail: a different panel switches and opens; the ACTIVE panel
 * toggles closed, which is how the canvas gets the width back without
 * hunting for a close button. An unknown id is ignored rather than blanking
 * the rail (returns the same object, so React skips the render).
 */
export function togglePanel(state: PanelState, id: string): PanelState {
  if (!panelById(id)) return state
  if (state.panel === id) return { panel: id, open: !state.open }
  return { panel: id, open: true }
}

/** Holds a dragged width in bounds; junk falls back rather than collapsing. */
export function clampPanelWidth(px: number): number {
  if (typeof px !== 'number' || !Number.isFinite(px)) return DEFAULT_PANEL_WIDTH
  return Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, px)))
}

/** The inspector's bounds: the default is the width it always had (w-80). */
export const INSPECTOR_MIN = 280
export const INSPECTOR_MAX = 560
export const DEFAULT_INSPECTOR_WIDTH = 320
export const INSPECTOR_WIDTH_KEY = 'tangen:studio:inspector-width'

export function clampInspectorWidth(px: number): number {
  if (typeof px !== 'number' || !Number.isFinite(px)) return DEFAULT_INSPECTOR_WIDTH
  return Math.round(Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, px)))
}

/** Which rail a handle belongs to: the left panel or the right inspector. */
export type RailSide = 'left' | 'right'

function clampFor(side: RailSide, px: number): number {
  return side === 'left' ? clampPanelWidth(px) : clampInspectorWidth(px)
}

/**
 * The width a drag has reached. The left panel's handle sits on its RIGHT
 * edge, so moving right widens it; the inspector's sits on its LEFT edge, so
 * moving left widens it. Clamped to the rail's own bounds.
 */
export function dragWidth(d: { side: RailSide; startWidth: number; startX: number; x: number }): number {
  const delta = d.x - d.startX
  return clampFor(d.side, d.startWidth + (d.side === 'left' ? delta : -delta))
}

/** One keyboard step on a handle. */
export const RESIZE_STEP = 16

/**
 * The keyboard on a handle: the arrow that points AWAY from the rail widens
 * it (right for the left panel, left for the inspector). Any other key is
 * null - not handled, so it keeps whatever meaning it had.
 */
export function nudgeWidth(side: RailSide, width: number, key: string): number | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null
  const outward = side === 'left' ? key === 'ArrowRight' : key === 'ArrowLeft'
  return clampFor(side, width + (outward ? RESIZE_STEP : -RESIZE_STEP))
}
