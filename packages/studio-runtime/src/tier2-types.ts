/**
 * File Name: tier2-types.ts
 * Purpose: The Tier 2 Interactions contract - what a published artifact
 *          declares, and the minimum DOM the interpreter touches.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Types only, so this file compiles to nothing. That is
 *          what lets the ROOT export describe Tier 2 without reaching the
 *          Tier 2 code: a site that never declares a Tier 2 interaction can
 *          still type against these, and its bundle grows by zero bytes.
 *
 *          The DOM is described STRUCTURALLY rather than imported from
 *          lib.dom, for two reasons. The package compiles with `lib: ES2022`
 *          and no DOM, like every other file here. And a structural shape is
 *          fakeable, so the interpreter's fixes can be tested with no
 *          browser - which matters because five of the six bugs the browser
 *          pass found were invisible from the API surface and only a test
 *          that drives the real code path keeps them fixed.
 */

/** One keyframe. Values reach `element.animate()` and inline style. */
export interface Tier2Keyframe {
  [property: string]: string | number | undefined
}

/** The part of a WAAPI Animation this interpreter uses. */
export interface Tier2Animation {
  currentTime: number | null
  playbackRate: number
  play(): void
  pause(): void
  reverse(): void
  cancel(): void
}

/** An element's style, reached both by property name and by setProperty. */
export interface Tier2Style {
  setProperty(name: string, value: string): void
  [property: string]: unknown
}

/** The part of an Element this interpreter uses. */
export interface Tier2Element {
  style: Tier2Style
  animate(keyframes: Tier2Keyframe[], options: Record<string, unknown>): Tier2Animation
  getBoundingClientRect?(): { top: number; height: number }
  textContent?: string | null
}

/** Anything the interpreter can query declarations against. */
export interface Tier2Scope {
  querySelector(selector: string): Tier2Element | null
  querySelectorAll(selector: string): ArrayLike<Tier2Element>
}

/** Where a stagger counts from. */
export type Tier2StaggerFrom = 'first' | 'last' | 'center' | number

export interface Tier2StaggerOptions {
  from?: Tier2StaggerFrom
  start?: number
}

/** One step of a declared sequence. */
export interface Tier2StepDeclaration {
  target: string
  keyframes: Tier2Keyframe[]
  duration?: number
  delay?: number
  easing?: string
  fill?: string
  iterations?: number
  direction?: string
  /** '<' is the START of the previous step, '>' is its END. */
  at?: number | '<' | '>'
  stagger?: number
  staggerOptions?: Tier2StaggerOptions
}

export interface Tier2ScrubOptions {
  /** True drives the motion off the element's passage through the viewport. */
  view?: boolean
  axis?: string
  source?: unknown
  /**
   * Whose passage drives it. A published artifact carries a SELECTOR, because
   * an element cannot survive into JSON; a direct caller may pass the element.
   */
  subject?: string | Tier2Element
  rangeStart?: string
  rangeEnd?: string
  easing?: string
}

export interface Tier2ReverseOptions {
  duration?: number
  easing?: string
  threshold?: number
  rootMargin?: string
}

export interface Tier2CountUpOptions {
  from?: number
  duration?: number
  /**
   * A direct caller may pass a function. A DECLARATION cannot: it is
   * published as JSON and read by a runtime that never saw the authoring
   * session, so it says `locale` and `numberFormat` instead.
   */
  format?: (value: number) => string
  locale?: string
  numberFormat?: Record<string, unknown>
}

export interface Tier2TimelineOptions {
  /** False builds the sequence paused, so it can be scrubbed rather than played. */
  autoplay?: boolean
}

export interface Tier2ScrubDeclaration {
  kind: 'scrub'
  target: string
  keyframes: Tier2Keyframe[]
  options?: Tier2ScrubOptions
}

export interface Tier2TimelineDeclaration {
  kind: 'timeline'
  steps: Tier2StepDeclaration[]
  options?: Tier2TimelineOptions
}

export interface Tier2ReverseDeclaration {
  kind: 'reverse-on-leave'
  target: string
  keyframes: Tier2Keyframe[]
  options?: Tier2ReverseOptions
}

export interface Tier2CountUpDeclaration {
  kind: 'count-up'
  target: string
  to: number
  options?: Tier2CountUpOptions
}

/** One Tier 2 interaction, exactly as a published artifact carries it. */
export type DeliveredTier2Declaration =
  | Tier2ScrubDeclaration
  | Tier2TimelineDeclaration
  | Tier2ReverseDeclaration
  | Tier2CountUpDeclaration

/** A running sequence, seekable so a preview can scrub it. */
export interface Tier2Control {
  duration: number
  play(): void
  pause(): void
  reverse(): void
  cancel(): void
  seek(time: number): void
  progress(fraction: number): void
  animations: Tier2Animation[]
}

/** What the interpreter module exports. The loader depends on this shape. */
export interface Tier2Module {
  apply(declarations: DeliveredTier2Declaration[], root?: Tier2Scope): () => void
}
