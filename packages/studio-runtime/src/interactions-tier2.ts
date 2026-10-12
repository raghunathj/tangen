/**
 * File Name: interactions-tier2.ts
 * Purpose: The Tier 2 Interactions interpreter - scroll-scrub, parallax,
 *          stagger, sequences, reverse-on-leave, progress and count-up, from
 *          declarations alone.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reached ONLY through the `interactions-tier2` subpath,
 *          and only by a page whose artifact declares the module. The root
 *          export must never import this file: that is what keeps a Tier 1
 *          page's bundle at zero bytes of Tier 2, and a boundary test plus a
 *          size test hold the line.
 *
 *          No animation library. The Web Animations API plus native
 *          ScrollTimeline/ViewTimeline does every capability in the Tier 2
 *          brief, with one rAF fallback for engines that lack the timelines.
 *          On a browser that has them, ZERO script runs per frame - the
 *          browser drives the animation off the compositor. The measured
 *          alternative was 3.5 to 17 times this size, and the one library
 *          that could do scroll-scrub cheaply is licensed in terms that
 *          forbid a visual animation builder, which is exactly what Studio's
 *          Interactions panel is.
 *
 *          This is a PORT of the interpreter that was executed in three
 *          engines - Chromium 151, WebKit 26.5 and Firefox 153 - and passed
 *          42 of 42 assertions there. Six bugs were found by that run and
 *          none of them was visible from the API surface, so the fixes are
 *          marked FIX-A .. FIX-G and explained where they sit. Do not
 *          "simplify" a fix without re-running the browser harness.
 *
 *          The DOM is reached through structural types and `globalThis`
 *          rather than lib.dom, matching in-view.ts. Two reasons: the package
 *          compiles with `lib: ES2022`, and a structural shape can be faked,
 *          so every fix below is covered by a test that runs without a
 *          browser.
 *
 *          Reduced motion is handled ONCE, at `apply()`, for every kind, and
 *          it restores the END state rather than only cancelling. Suppressing
 *          an entrance without restoring it leaves the element invisible
 *          forever, which is the worst possible answer to asking for less
 *          motion - the same mistake the Tier 1 emitter refuses to make.
 */
import type {
  DeliveredTier2Declaration, Tier2Animation, Tier2Control, Tier2CountUpOptions,
  Tier2Element, Tier2Keyframe, Tier2ReverseOptions, Tier2Scope, Tier2ScrubOptions,
  Tier2StaggerOptions, Tier2StepDeclaration, Tier2TimelineOptions,
} from './tier2-types'

/** The ambient page, described only as far as this file reaches into it. */
interface Tier2Window {
  ScrollTimeline?: unknown
  ViewTimeline?: unknown
  IntersectionObserver?: unknown
  matchMedia?: (query: string) => { matches: boolean }
  innerHeight?: number
}

interface ScrollSource {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

const ambient = (): Tier2Window | undefined =>
  (globalThis as { window?: Tier2Window }).window

const ownerScope = (): Tier2Scope | null =>
  (globalThis as { document?: Tier2Scope }).document ?? null

const documentElement = (): ScrollSource | null =>
  (globalThis as { document?: { documentElement?: ScrollSource } }).document?.documentElement ?? null

const raf = (cb: (t: number) => void): number => {
  const fn = (globalThis as { requestAnimationFrame?: (c: (t: number) => void) => number }).requestAnimationFrame
  return typeof fn === 'function' ? fn(cb) : 0
}

const cancelRaf = (handle: number): void => {
  const fn = (globalThis as { cancelAnimationFrame?: (h: number) => void }).cancelAnimationFrame
  if (typeof fn === 'function') fn(handle)
}

const now = (): number => {
  const p = (globalThis as { performance?: { now(): number } }).performance
  return p ? p.now() : Date.now()
}

const supportsScrollTimeline = (): boolean => typeof ambient()?.ScrollTimeline === 'function'
const supportsViewTimeline = (): boolean => typeof ambient()?.ViewTimeline === 'function'

/** Whether this visitor has asked for less movement. */
const reduced = (): boolean => {
  const mm = ambient()?.matchMedia
  return typeof mm === 'function' ? !!mm('(prefers-reduced-motion: reduce)').matches : false
}

/** Resolve a stagger declaration into a per-index delay in ms. */
export function stagger(step: number, opts?: Tier2StaggerOptions): (index: number, total: number) => number {
  const o = opts || {}
  const from = o.from ?? 'first'
  const start = o.start ?? 0
  return (index: number, total: number) => {
    let i = index
    if (from === 'last') i = total - 1 - index
    else if (from === 'center') i = Math.abs(index - (total - 1) / 2)
    else if (typeof from === 'number') i = Math.abs(index - from)
    return start + i * step
  }
}

/**
 * FIX-C helper. Put an element in the state the interaction would have LEFT
 * it in, using inline style, with no animation object involved.
 *
 * A reduced-motion visitor asked for less movement, not for less content.
 */
function applyEndState(el: Tier2Element | null, keyframes: Tier2Keyframe[] | undefined): void {
  if (!el || !keyframes || !keyframes.length) return
  const last = keyframes[keyframes.length - 1]!
  for (const key of Object.keys(last)) {
    if (key === 'offset' || key === 'easing' || key === 'composite') continue
    const value = last[key]
    if (value == null) continue
    // Both camelCase and hyphenated property names reach here, because a
    // declaration is written by whoever authored it.
    if (key.includes('-')) el.style.setProperty(key, String(value))
    else (el.style as Record<string, unknown>)[key] = String(value)
  }
}

/** One step of a declared timeline, applied to one element. */
function stepEffect(el: Tier2Element, step: Tier2StepDeclaration): Tier2Animation {
  return el.animate(step.keyframes, {
    duration: step.duration ?? 400,
    delay: step.delay ?? 0,
    easing: step.easing || 'ease',
    fill: step.fill || 'both',
    iterations: step.iterations ?? 1,
    direction: step.direction || 'normal',
  })
}

/**
 * Sequence a declared timeline. Positions are absolute ms offsets computed
 * from the previous step, so the declaration stays data rather than code.
 */
export function timeline(
  steps: Tier2StepDeclaration[], root?: Tier2Scope | null, opts?: Tier2TimelineOptions,
): Tier2Control {
  const scope = root || ownerScope()
  const o = opts || {}
  const anims: Tier2Animation[] = []
  let cursor = 0
  let prevAt = 0
  // FIX-A: WAAPI composites `element.animate()` results in creation order and
  // `fill: both` makes an effect apply BEFORE its own delay. So the last step
  // of a same-element sequence back-fills its first keyframe over every step
  // ahead of it, and the element sits on that value for the whole run - a
  // three-step sequence played only its third step, in all three engines. The
  // first effect on an element still gets `both` (it has to hold the start
  // state), every later one gets `forwards` so it contributes nothing until
  // its own delay has elapsed.
  const seen = new Set<Tier2Element>()
  for (const step of steps) {
    const targets: Tier2Element[] = scope ? Array.from(scope.querySelectorAll(step.target)) : []
    const dur = step.duration ?? 400
    // FIX-D: '<' is the START of the previous step and '>' is its END, which
    // is what every timeline notation a designer has met means. Before this,
    // '<' was the end of the previous step (identical to the default) and '>'
    // was the end plus the CURRENT step's duration, which is not a position
    // any notation defines.
    const at = step.at === '<' ? prevAt : step.at === '>' ? cursor : (step.at ?? cursor)
    const stag = step.stagger ? stagger(step.stagger, step.staggerOptions) : null
    targets.forEach((el, i) => {
      const delay = at + (stag ? stag(i, targets.length) : 0)
      const fill = step.fill || (seen.has(el) ? 'forwards' : 'both')
      seen.add(el)
      anims.push(stepEffect(el, { ...step, delay, fill }))
    })
    prevAt = at
    cursor = at + dur
  }
  // FIX-G: a sequence that is going to be scrubbed must not also be playing.
  if (o.autoplay === false) anims.forEach((a) => a.pause())
  const control: Tier2Control = {
    duration: cursor,
    play: () => anims.forEach((a) => a.play()),
    pause: () => anims.forEach((a) => a.pause()),
    reverse: () => anims.forEach((a) => a.reverse()),
    cancel: () => anims.forEach((a) => a.cancel()),
    seek: (t: number) => anims.forEach((a) => { a.currentTime = t }),
    progress: (p: number) => control.seek(p * cursor),
    animations: anims,
  }
  return control
}

/**
 * Scroll-scrubbed progress. Parallax and progress bars are this too.
 *
 * Native first: when ScrollTimeline exists the browser drives the animation
 * off the compositor and no script runs per frame. The rAF path exists only
 * so older Safari and Firefox degrade to something rather than nothing - and
 * it was measured at zero tracking error at rest, costing exactly one
 * main-thread callback per frame.
 */
export function scrub(
  el: Tier2Element, keyframes: Tier2Keyframe[], opts?: Tier2ScrubOptions,
): () => void {
  const o = opts || {}
  const win = ambient()
  const options = {
    duration: 1,
    fill: 'both',
    easing: o.easing || 'linear',
  }
  const subject = (typeof o.subject === 'string' ? null : o.subject) || el

  if (o.view && supportsViewTimeline()) {
    const View = win!.ViewTimeline as new (init: Record<string, unknown>) => unknown
    const anim = el.animate(keyframes, {
      ...options,
      timeline: new View({ subject, axis: o.axis || 'block' }),
      rangeStart: o.rangeStart || 'entry 0%',
      rangeEnd: o.rangeEnd || 'cover 100%',
    })
    return () => anim.cancel()
  }
  if (!o.view && supportsScrollTimeline()) {
    const Scroll = win!.ScrollTimeline as new (init: Record<string, unknown>) => unknown
    const anim = el.animate(keyframes, {
      ...options,
      timeline: new Scroll({ source: o.source || documentElement(), axis: o.axis || 'block' }),
    })
    return () => anim.cancel()
  }

  // Fallback: one rAF loop driving a paused WAAPI animation.
  const anim = el.animate(keyframes, { duration: 1000, fill: 'both', easing: options.easing })
  anim.pause()
  let handle = 0
  let running = true
  const source = (o.source as ScrollSource | undefined) || documentElement()
  const tick = (): void => {
    if (!running) return
    let p = 0
    if (o.view) {
      const r = subject.getBoundingClientRect ? subject.getBoundingClientRect() : { top: 0, height: 0 }
      const vh = win?.innerHeight || 0
      p = (vh - r.top) / (vh + r.height)
    } else if (source) {
      const max = source.scrollHeight - source.clientHeight
      p = max > 0 ? source.scrollTop / max : 0
    }
    // Clamped, so a rubber-band overscroll past either end cannot drive the
    // animation outside its own range.
    anim.currentTime = Math.min(1, Math.max(0, p)) * 1000
    handle = raf(tick)
  }
  handle = raf(tick)
  return () => { running = false; cancelRaf(handle); anim.cancel() }
}

/** The shape used from IntersectionObserver, kept minimal for testability. */
interface Observer {
  observe(el: unknown): void
  disconnect(): void
}

/**
 * Reverse on leave. IntersectionObserver decides direction; WAAPI holds the
 * state, so a re-entry resumes instead of restarting from zero.
 */
export function reverseOnLeave(
  el: Tier2Element, keyframes: Tier2Keyframe[], opts?: Tier2ReverseOptions,
): () => void {
  const o = opts || {}
  const duration = o.duration ?? 400
  const anim = el.animate(keyframes, {
    duration,
    easing: o.easing || 'ease',
    fill: 'both',
  })
  anim.pause()
  const Native = ambient()?.IntersectionObserver
    ?? (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
  // No observer means no way to know the element left, so the motion simply
  // never runs and the element keeps the state the page was authored in -
  // which is the visible one.
  if (typeof Native !== 'function') return () => anim.cancel()

  const Ctor = Native as new (
    cb: (entries: Array<{ isIntersecting: boolean }>) => void, init?: unknown,
  ) => Observer
  const io = new Ctor(
    (entries) => {
      for (const e of entries) {
        // FIX-B: `play()` with a negative playback rate and a current time of
        // zero is specified to SEEK TO THE END first. An element below the
        // fold gets its first observer callback with isIntersecting false, so
        // the old code sent it straight to its end state and animated back
        // down - a visible flash of the fully revealed element on every page
        // load, in every engine, for every element that starts off screen.
        // Playing is only ever worth doing when there is somewhere to go.
        const t = Number(anim.currentTime) || 0
        if (e.isIntersecting) {
          if (t < duration) { anim.playbackRate = 1; anim.play() }
        } else if (t > 0) {
          anim.playbackRate = -1
          anim.play()
        }
      }
    },
    { threshold: o.threshold ?? 0.2, rootMargin: o.rootMargin || '0px' },
  )
  io.observe(el)
  return () => { io.disconnect(); anim.cancel() }
}

/**
 * FIX-F: a formatter has to be expressible as DATA.
 *
 * A declaration is compiled into an artifact and read by a runtime that never
 * saw the authoring session, so it cannot carry a function. `format` still
 * accepts one for direct callers, but a declaration says
 * `{ locale: 'en-US', numberFormat: { maximumFractionDigits: 0 } }` and gets
 * a thousands separator - which is the whole reason count-up needs a runtime
 * rather than a CSS counter.
 */
function formatter(o: Tier2CountUpOptions): (value: number) => string {
  if (typeof o.format === 'function') return o.format
  if (o.numberFormat || o.locale) {
    const nf = new Intl.NumberFormat(
      o.locale || undefined,
      (o.numberFormat as Intl.NumberFormatOptions | undefined) || { maximumFractionDigits: 0 },
    )
    return (v: number) => nf.format(v)
  }
  return (v: number) => String(Math.round(v))
}

/** Count-up. No CSS primitive exists for this, so it is rAF plus formatting. */
export function countUp(el: Tier2Element, to: number, opts?: Tier2CountUpOptions): () => void {
  const o = opts || {}
  const from = o.from ?? 0
  const duration = o.duration ?? 1200
  const format = formatter(o)
  if (reduced()) { el.textContent = format(to); return () => {} }
  let handle = 0
  const t0 = now()
  const ease = (t: number) => 1 - Math.pow(1 - t, 3)
  const tick = (at: number): void => {
    const t = Math.min(1, (at - t0) / duration)
    el.textContent = format(from + (to - from) * ease(t))
    if (t < 1) handle = raf(tick)
  }
  handle = raf(tick)
  return () => cancelRaf(handle)
}

/**
 * The one entry a manifest flag calls. Declarations in, teardown out.
 *
 * Nothing here evaluates anything from the artifact. A declaration is data
 * that this file INTERPRETS, which is what lets a published page carry motion
 * without carrying code.
 */
export function apply(declarations: DeliveredTier2Declaration[], root?: Tier2Scope): () => void {
  const teardowns: Array<() => void> = []
  const scope = root || ownerScope()
  if (!scope || !Array.isArray(declarations)) return () => {}
  const quiet = reduced()

  for (const d of declarations) {
    // FIX-E: a timeline declaration addresses its targets through its own
    // steps and has no reason to carry a top-level `target`. The old guard
    // resolved `d.target` first and dropped the whole declaration when it was
    // absent, so every timeline written the obvious way silently did nothing.
    const el = d.kind === 'timeline' ? null : scope.querySelector(d.target)
    if (d.kind !== 'timeline' && !el) continue

    // FIX-C: reduced motion is handled at the entry, once, for every kind.
    // Before this only count-up honoured it, so a scrub declaration built a
    // paused animation holding its FIRST keyframe and the element stayed at
    // opacity 0 until the visitor scrolled - motion suppressed by hiding the
    // content, which is the one outcome the Tier 1 emitter is written to
    // avoid. On an engine without ScrollTimeline it also left an rAF loop
    // running, per frame, for a visitor who asked for less motion.
    if (quiet) {
      if (d.kind === 'timeline') {
        for (const step of d.steps || []) {
          for (const t of Array.from(scope.querySelectorAll(step.target))) applyEndState(t, step.keyframes)
        }
      } else if (d.kind === 'count-up') {
        el!.textContent = formatter(d.options || {})(d.to)
      } else {
        applyEndState(el, d.keyframes)
      }
      continue
    }

    if (d.kind === 'timeline') teardowns.push(timeline(d.steps, scope, d.options).cancel)
    else if (d.kind === 'scrub') teardowns.push(scrub(el!, d.keyframes, resolveSubject(d.options, scope)))
    else if (d.kind === 'reverse-on-leave') teardowns.push(reverseOnLeave(el!, d.keyframes, d.options))
    else if (d.kind === 'count-up') teardowns.push(countUp(el!, d.to, d.options))
  }
  return () => teardowns.forEach((fn) => fn())
}

/**
 * A published parallax names its subject with a SELECTOR, because an element
 * cannot survive into JSON. Resolving it here rather than inside `scrub`
 * keeps that function exactly as it was proven in the browser, and leaves a
 * direct caller free to pass the element itself.
 */
function resolveSubject(options: Tier2ScrubOptions | undefined, scope: Tier2Scope): Tier2ScrubOptions | undefined {
  if (!options || typeof options.subject !== 'string') return options
  const subject = scope.querySelector(options.subject)
  return { ...options, subject: subject ?? undefined }
}
