/**
 * File Name: types.ts
 * Purpose: The shape of one style-conformance fixture and the assertions it
 *          carries, shared by the demo page and the Playwright harness.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The page and the browser matrix MUST read one source of
 *          truth. A fixture that the page renders one way and the harness
 *          another proves nothing, and the whole point of this suite is that
 *          the browser-computed result is the verdict.
 *
 *          Assertions are DATA, not code, for the same reason: the harness
 *          evaluates them inside three engines, so they cannot be closures.
 *          Selectors carry `$name` placeholders that expand to the fixture's
 *          namespaced class names - every fixture lives on one shared page,
 *          so two fixtures naming a class `hero` must never collide.
 */

/** A class rule exactly as Studio stores it: property id -> stored value. */
export interface FixtureClass {
  name: string
  /** A plain string is `base`/`normal`; an object carries breakpoints and states. */
  props: Record<string, unknown>
  custom?: string
  /** Present only on protection fixtures, compiled through compileStyles. */
  target?: { blockType: string; kind: 'root' | 'part' | 'internal'; part?: string }
}

/** A tag default, as the stylesheet input takes it. */
export interface FixtureTag {
  tag: string
  props: Record<string, unknown>
}

/** One block, as the platform stores it. Classes and raw CSS ride under `_studio`. */
export type FixtureBlock = Record<string, unknown> & { _type: string; _key?: string }

export type CheckKind =
  | 'computed' | 'rect' | 'rel' | 'rects' | 'count' | 'scroll' | 'order'
  | 'css' | 'elementAt' | 'text' | 'inset'

/** One assertion, evaluated in the browser (or against the compiled CSS). */
export interface Check {
  kind: CheckKind
  /** Selector with `$name` (class) and `$name~c` (its content element). */
  sel?: string
  sel2?: string
  sels?: string[]
  /** getComputedStyle property, for kind `computed`. */
  prop?: string
  /** Bounding-box field, for kind `rect`. */
  box?: 'width' | 'height' | 'top' | 'left' | 'right' | 'bottom'
  /** Relation, for kind `rel`. */
  rel?: 'sameTop' | 'sameLeft' | 'rightOf' | 'leftOf' | 'below' | 'above'
      | 'gapX' | 'gapY' | 'sameWidth' | 'sameHeight' | 'wider' | 'taller' | 'sameRect'
      | 'ratioW' | 'ratioH' | 'ratioCW' | 'sameCenterX' | 'sameCenterY'
  /** Which content-box edge of `sel2` a kind `inset` measures from. */
  side?: 'left' | 'right' | 'top' | 'bottom'
  /** Scroll metric, for kind `scroll`. */
  metric?: 'scrollHeight' | 'clientHeight' | 'scrollWidth' | 'clientWidth' | 'scrollTop'
  /** Comparison for numeric kinds, and the mode for kind `css`. */
  op?: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'ne'
      | 'contains' | 'notContains' | 'noCombinator'
  /** Scroll an element before measuring, for sticky and overflow fixtures. */
  preScroll?: { sel: string; top: number }
  /** Axis for kind `order`. */
  axis?: 'x' | 'y'
  expect?: string | number | string[]
  /** Numeric tolerance in px. Sub-pixel layout differs between engines. */
  tol?: number
  /** Hover or focus this selector (or `sel`) before reading. */
  state?: 'hover' | 'focus'
  stateSel?: string
  /** Viewport width for this one check, so a breakpoint matrix is one fixture. */
  viewport?: { width: number; height: number }
  note?: string
}

export type FixtureGroup =
  | 'regression' | 'display' | 'context' | 'flex' | 'grid' | 'sizing'
  | 'boxmodel' | 'tokens' | 'position' | 'overflow' | 'typography'
  | 'paint' | 'states' | 'breakpoints' | 'cascade' | 'nested'
  | 'protection' | 'publish' | 'custom'

export interface Fixture {
  id: string
  group: FixtureGroup
  label: string
  /** Plain-language expected result, printed on the page beside the render. */
  expectation: string
  blocks: FixtureBlock[]
  classes: FixtureClass[]
  tags?: FixtureTag[]
  /** Named fonts the stylesheet exposes as --tg-font-<name>, for font tokens. */
  fonts?: Array<{ name: string; stack?: string; google?: string }>
  /** Static kit.loop results, keyed by loop `_key`. The documented API. */
  loopData?: Record<string, { data: Array<Record<string, unknown>>; error?: boolean }>
  /** Protection declarations, compiled through compileStyles. */
  protections?: Record<string, unknown>
  /** The page's own raw CSS (X-T2), scoped to the fixture's top-level blocks. */
  pageCss?: string
  /**
   * A STALE published stylesheet, present only for the regression fixtures.
   * `mode` picks whether the draft replaces it (the shipped fix) or layers
   * over it (what the canvas did before).
   */
  published?: { classes: FixtureClass[]; mode: 'replace' | 'layer' }
  checks: Check[]
  /** Registry property ids this fixture exercises, for the coverage report. */
  covers?: string[]
  /** Rendered on the page but not asserted there - the harness owns it. */
  harnessOnly?: boolean
}
