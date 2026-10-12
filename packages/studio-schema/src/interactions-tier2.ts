/**
 * File Name: interactions-tier2.ts
 * Purpose: Tier 2 Interactions - the declarations that need a runtime, and
 *          the only ones that do.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Interactions, not Experiences and not Animation. The
 *          word is settled in studio-decisions.md and Tier 2 does not get to
 *          rename it.
 *
 *          Tier 1 is CSS and costs a visitor nothing. Tier 2 is scroll-linked
 *          and sequenced motion, which CSS cannot express everywhere, so it
 *          is the tier that loads a script - and therefore the tier that must
 *          justify itself. It stays a DECLARATION for the same reason Tier 1
 *          does: an interaction has to survive into a framework-neutral
 *          artifact and be read by a runtime that never saw the authoring
 *          session. Nothing here is executable and nothing here emits.
 *
 *          The KINDS are exactly the four the ported interpreter interprets.
 *          The seven capabilities proven in the browser pass are combinations
 *          of those four rather than seven separate kinds: parallax is a
 *          scrub on a view timeline, a progress bar is a scrub on scaleX, a
 *          stagger is a timeline step with a per-index delay, and a sequence
 *          is a timeline with several steps. Inventing a fifth kind would
 *          publish an artifact the interpreter cannot read.
 *
 *          Everything is clamped and allow-listed on the way IN, harder than
 *          Tier 1 rather than more loosely. A Tier 1 easing reaches a
 *          stylesheet; a Tier 2 keyframe reaches `element.animate()` and,
 *          under reduced motion, an inline style attribute - two more places
 *          a `url()` could hide. A formatter is data (`locale` plus
 *          `maximumFractionDigits`) and never a function, because a function
 *          cannot be published.
 */
import { EASINGS, MAX_DURATION_MS, DEFAULT_DURATION_MS, type Easing, type Interaction } from './interactions'

/** What the interpreter interprets. Four kinds, no more. */
export const TIER2_KINDS = ['scrub', 'timeline', 'reverse-on-leave', 'count-up'] as const
export type Tier2Kind = (typeof TIER2_KINDS)[number]

/**
 * Every capability the browser pass proved, and the kind that expresses it.
 *
 * Kept as data rather than prose so a capability cannot quietly acquire a
 * kind nothing interprets.
 */
export const TIER2_CAPABILITIES = {
  'scroll-scrub': 'scrub',
  parallax: 'scrub',
  progress: 'scrub',
  stagger: 'timeline',
  sequence: 'timeline',
  'reverse-on-leave': 'reverse-on-leave',
  'count-up': 'count-up',
} as const satisfies Record<string, Tier2Kind>

/**
 * Runtime modules a page can ask for BEYOND the Tier 1 shim.
 *
 * Tier 1's answer stays in the manifest's `enterView` flag. Re-stating it
 * here would move the content hash of every page ever published, for no
 * benefit to anybody.
 */
export const RUNTIME_MODULES = ['interactions-tier2'] as const
export type RuntimeModule = (typeof RUNTIME_MODULES)[number]

/** Where a view timeline may start and end. Closed, because it reaches WAAPI. */
export const VIEW_RANGES = [
  'entry 0%', 'entry 50%', 'entry 100%',
  'cover 0%', 'cover 40%', 'cover 50%', 'cover 100%',
  'contain 0%', 'contain 100%',
  'exit 0%', 'exit 50%', 'exit 100%',
] as const
export type ViewRange = (typeof VIEW_RANGES)[number]

/** A scroll axis. */
export const SCROLL_AXES = ['block', 'inline'] as const
export type ScrollAxis = (typeof SCROLL_AXES)[number]

/** Where a stagger counts from. */
export const STAGGER_ORIGINS = ['first', 'last', 'center'] as const
export type StaggerOrigin = (typeof STAGGER_ORIGINS)[number]

/** Ceilings. A designer types freely; a visitor should not pay for a typo. */
export const MAX_TIER2_STEPS = 12
export const MAX_TIER2_KEYFRAMES = 8
export const MAX_STAGGER_MS = 1000
export const MAX_TIMELINE_POSITION_MS = 10_000
export const MAX_COUNT_UP = 1e12
export const MAX_FRACTION_DIGITS = 4

/** A class name safe to drop into a selector. Same rule as the emitter's. */
const SAFE_CLASS = /^[A-Za-z_][A-Za-z0-9_-]*$/

/**
 * Keyframe properties a Tier 2 interaction may animate.
 *
 * Two, deliberately. Every capability the browser pass proved is expressed in
 * opacity or transform, both of which the compositor can animate without
 * laying the page out again. A wider list would be a wider attack surface AND
 * a slower page, for capabilities nobody has asked for.
 */
export const TIER2_PROPERTIES = ['opacity', 'transform'] as const

/** Transform functions a declaration may use. */
const TRANSFORM_FUNCTIONS = new Set([
  'translate', 'translateX', 'translateY', 'translate3d',
  'scale', 'scaleX', 'scaleY',
  'rotate', 'rotateX', 'rotateY', 'rotateZ',
  'skewX', 'skewY',
])

/** Numbers, units, separators. No parentheses, so no nested function can hide. */
const TRANSFORM_ARGS = /^[-+0-9.,%\sa-z]*$/i
const ONE_CALL = /^([A-Za-z0-9]+)\(([^()]*)\)$/

/** One transform value, or null when it is not one we are willing to emit. */
function safeTransform(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().replace(/\s+/g, ' ')
  if (value === '' || value.length > 200) return null
  if (value === 'none') return 'none'
  // Anything that could end a declaration, open a string or reach the network
  // is refused outright rather than escaped, because this value has more than
  // one destination and only one of them is a stylesheet.
  if (/[;{}<>\\"'@]/.test(value) || /url/i.test(value)) return null
  const calls = value.match(/[A-Za-z0-9]+\([^()]*\)/g)
  // Every character has to belong to a call, so nothing can sit between them.
  if (!calls || calls.join(' ') !== value) return null
  for (const call of calls) {
    const parts = ONE_CALL.exec(call)
    if (!parts || !TRANSFORM_FUNCTIONS.has(parts[1]!) || !TRANSFORM_ARGS.test(parts[2]!)) return null
  }
  return value
}

/** One keyframe, allow-listed. */
export interface Tier2Keyframe {
  opacity?: number
  transform?: string
}

/** A keyframe with only the properties we are willing to animate, or null. */
function keyframe(raw: unknown): Tier2Keyframe | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  const out: Tier2Keyframe = {}
  if (input.opacity !== undefined) {
    const n = Number(input.opacity)
    if (!Number.isFinite(n)) return null
    out.opacity = Math.min(1, Math.max(0, n))
  }
  if (input.transform !== undefined) {
    const t = safeTransform(input.transform)
    if (t === null) return null
    out.transform = t
  }
  // A frame of nothing but properties we refuse is not a frame we can play.
  return Object.keys(out).length > 0 ? out : null
}

/**
 * A whole keyframe list, or null.
 *
 * Refused rather than truncated. A designer whose fifth keyframe was silently
 * dropped gets motion that is subtly wrong, which is harder to notice and
 * harder to fix than motion that is visibly missing.
 */
function keyframes(raw: unknown): Tier2Keyframe[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_TIER2_KEYFRAMES) return null
  const out: Tier2Keyframe[] = []
  for (const frame of raw) {
    const settled = keyframe(frame)
    if (!settled) return null
    out.push(settled)
  }
  return out
}

/** Clamps to a whole, non-negative number of milliseconds. */
function ms(value: unknown, fallback: number, max = MAX_DURATION_MS): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(0, Math.round(value)))
}

/** A class name, or null when it cannot be a selector. */
function className(value: unknown): string | null {
  return typeof value === 'string' && SAFE_CLASS.test(value) ? value : null
}

/** An easing from the closed Tier 1 list. */
function easing(value: unknown, fallback: Easing): Easing {
  return EASINGS.find((e) => e === value) ?? fallback
}

/** Scroll-linked motion. Parallax and progress bars are this kind too. */
export interface Tier2Scrub {
  kind: 'scrub'
  className: string
  keyframes: Tier2Keyframe[]
  /** True drives it off the element's own passage through the viewport. */
  view: boolean
  axis: ScrollAxis
  rangeStart: ViewRange
  rangeEnd: ViewRange
  easing: Easing
  /** Whose passage drives it, when that is not the element itself. */
  subjectClassName?: string
}

/** One step of a sequence. */
export interface Tier2Step {
  className: string
  keyframes: Tier2Keyframe[]
  duration: number
  easing: Easing
  /** '<' is the START of the previous step, '>' is its END. */
  at?: number | '<' | '>'
  stagger?: number
  staggerFrom?: StaggerOrigin
}

/** A sequence. One step with a stagger is the "staggered entrance" case. */
export interface Tier2Timeline {
  kind: 'timeline'
  className: string
  steps: Tier2Step[]
}

/** Motion that runs backwards when the element leaves the viewport. */
export interface Tier2ReverseOnLeave {
  kind: 'reverse-on-leave'
  className: string
  keyframes: Tier2Keyframe[]
  duration: number
  easing: Easing
  threshold: number
}

/** A rendered number. The one Tier 2 kind that is not a CSS property. */
export interface Tier2CountUp {
  kind: 'count-up'
  className: string
  to: number
  from: number
  duration: number
  /** Formatting as DATA - a function cannot survive into an artifact. */
  locale?: string
  maximumFractionDigits?: number
}

export type Tier2Interaction = Tier2Scrub | Tier2Timeline | Tier2ReverseOnLeave | Tier2CountUp

/** BCP 47 shaped, and short enough that Intl will not be handed an essay. */
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/** One step, or null when it cannot be played. */
function step(raw: unknown, fallbackClass: string): Tier2Step | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  const frames = keyframes(input.keyframes)
  if (!frames) return null
  const target = input.className === undefined ? fallbackClass : className(input.className)
  if (!target) return null

  const out: Tier2Step = {
    className: target,
    keyframes: frames,
    duration: ms(input.duration, DEFAULT_DURATION_MS) || DEFAULT_DURATION_MS,
    easing: easing(input.easing, 'ease-out'),
  }
  if (input.at === '<' || input.at === '>') out.at = input.at
  else if (typeof input.at === 'number' && Number.isFinite(input.at)) {
    out.at = ms(input.at, 0, MAX_TIMELINE_POSITION_MS)
  }
  if (typeof input.stagger === 'number' && Number.isFinite(input.stagger)) {
    out.stagger = ms(input.stagger, 0, MAX_STAGGER_MS)
    out.staggerFrom = STAGGER_ORIGINS.find((o) => o === input.staggerFrom) ?? 'first'
  }
  return out
}

/**
 * A usable Tier 2 interaction, or null when the input cannot be made into one.
 *
 * Null rather than a repaired guess, for the same reason Tier 1 refuses: an
 * interaction that silently does nothing is worse for a designer than one
 * that is visibly not there.
 */
export function normalizeTier2Interaction(raw: unknown): Tier2Interaction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  const kind = TIER2_KINDS.find((k) => k === input.kind)
  const owner = className(input.className)
  if (!kind || !owner) return null

  if (kind === 'scrub') {
    const frames = keyframes(input.keyframes)
    if (!frames) return null
    const view = input.view === true
    const out: Tier2Scrub = {
      kind, className: owner, keyframes: frames, view,
      axis: SCROLL_AXES.find((a) => a === input.axis) ?? 'block',
      rangeStart: VIEW_RANGES.find((r) => r === input.rangeStart) ?? 'entry 0%',
      rangeEnd: VIEW_RANGES.find((r) => r === input.rangeEnd) ?? 'cover 100%',
      // linear, because a scrub is driven by scroll position: any other
      // easing makes the element lag the finger that is moving it.
      easing: easing(input.easing, 'linear'),
    }
    const subject = input.subjectClassName === undefined ? null : className(input.subjectClassName)
    if (subject) out.subjectClassName = subject
    return out
  }

  if (kind === 'timeline') {
    if (!Array.isArray(input.steps) || input.steps.length === 0) return null
    if (input.steps.length > MAX_TIER2_STEPS) return null
    const steps: Tier2Step[] = []
    for (const s of input.steps) {
      const settled = step(s, owner)
      if (!settled) return null
      steps.push(settled)
    }
    return { kind, className: owner, steps }
  }

  if (kind === 'reverse-on-leave') {
    const frames = keyframes(input.keyframes)
    if (!frames) return null
    const threshold = typeof input.threshold === 'number' && Number.isFinite(input.threshold)
      ? Math.min(1, Math.max(0, input.threshold))
      : 0.2
    return {
      kind, className: owner, keyframes: frames,
      duration: ms(input.duration, DEFAULT_DURATION_MS) || DEFAULT_DURATION_MS,
      easing: easing(input.easing, 'ease-out'),
      threshold,
    }
  }

  const to = typeof input.to === 'number' && Number.isFinite(input.to) ? input.to : null
  if (to === null) return null
  const from = typeof input.from === 'number' && Number.isFinite(input.from) ? input.from : 0
  const out: Tier2CountUp = {
    kind: 'count-up', className: owner,
    to: Math.max(-MAX_COUNT_UP, Math.min(MAX_COUNT_UP, to)),
    from: Math.max(-MAX_COUNT_UP, Math.min(MAX_COUNT_UP, from)),
    duration: ms(input.duration, 1200) || 1200,
  }
  if (typeof input.locale === 'string' && LOCALE.test(input.locale)) out.locale = input.locale
  if (typeof input.maximumFractionDigits === 'number' && Number.isFinite(input.maximumFractionDigits)) {
    out.maximumFractionDigits = Math.min(MAX_FRACTION_DIGITS, Math.max(0, Math.round(input.maximumFractionDigits)))
  }
  return out
}

/** Either tier, settled. */
export type AnyInteraction = Interaction | Tier2Interaction

/**
 * Which tier an interaction belongs to, and therefore what it costs.
 *
 * Tier 1 is CSS and may cost the enter-view shim. Tier 2 always costs the
 * interpreter module, so this is what the compiler asks before it writes
 * `runtime.modules`.
 */
export function interactionTier(interaction: AnyInteraction): 1 | 2 {
  return 'kind' in interaction ? 2 : 1
}

/** The artifact form of one declaration: JSON the interpreter can read. */
export type Tier2Declaration = Record<string, unknown> & { kind: Tier2Kind }

/**
 * A settled interaction as the artifact carries it.
 *
 * Class names become SELECTORS here rather than in the runtime, because the
 * artifact is the contract: an adapter in any framework should be able to
 * hand these declarations straight to the interpreter without knowing that
 * Tangen names things by class.
 */
export function tier2Declaration(interaction: Tier2Interaction): Tier2Declaration {
  const sel = (name: string) => `.${name}`

  if (interaction.kind === 'scrub') {
    const options: Record<string, unknown> = {
      view: interaction.view,
      axis: interaction.axis,
      easing: interaction.easing,
    }
    if (interaction.view) {
      options.rangeStart = interaction.rangeStart
      options.rangeEnd = interaction.rangeEnd
      if (interaction.subjectClassName) options.subject = sel(interaction.subjectClassName)
    }
    return { kind: 'scrub', target: sel(interaction.className), keyframes: interaction.keyframes, options }
  }

  if (interaction.kind === 'timeline') {
    return {
      kind: 'timeline',
      steps: interaction.steps.map((s) => {
        const out: Record<string, unknown> = {
          target: sel(s.className),
          keyframes: s.keyframes,
          duration: s.duration,
          easing: s.easing,
        }
        if (s.at !== undefined) out.at = s.at
        if (s.stagger !== undefined) {
          out.stagger = s.stagger
          out.staggerOptions = { from: s.staggerFrom ?? 'first' }
        }
        return out
      }),
    }
  }

  if (interaction.kind === 'reverse-on-leave') {
    return {
      kind: 'reverse-on-leave',
      target: sel(interaction.className),
      keyframes: interaction.keyframes,
      options: {
        duration: interaction.duration,
        easing: interaction.easing,
        threshold: interaction.threshold,
      },
    }
  }

  const options: Record<string, unknown> = {
    from: interaction.from,
    duration: interaction.duration,
  }
  if (interaction.locale) options.locale = interaction.locale
  if (interaction.maximumFractionDigits !== undefined) {
    options.numberFormat = { maximumFractionDigits: interaction.maximumFractionDigits }
  }
  return { kind: 'count-up', target: sel(interaction.className), to: interaction.to, options }
}
