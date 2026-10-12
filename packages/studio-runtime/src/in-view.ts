/**
 * File Name: in-view.ts
 * Purpose: The enter-view shim - the only Interaction that costs a visitor
 *          any JavaScript.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: hover, focus and load are already pure CSS. Knowing an
 *          element scrolled into view is the one thing CSS cannot do
 *          everywhere, so it is the one thing allowed to ship a script.
 *
 *          The script's entire job is flipping one attribute. The compiler
 *          has already emitted the animation, paused, so this never learns
 *          what the animation is - which is what keeps it this small and
 *          keeps the motion inspectable in the stylesheet rather than buried
 *          in JavaScript.
 *
 *          Reduced motion needs no handling here either: the compiler's
 *          reduced branch already sets the element's end state, so the
 *          attribute arriving late or never changes nothing for that visitor.
 */

/** The attribute the emitted stylesheet is waiting on. */
export const IN_VIEW_ATTR = 'data-tg-inview'

/** The shape used from IntersectionObserver, kept minimal for testability. */
interface Observer {
  observe(el: unknown): void
  unobserve(el: unknown): void
  disconnect(): void
}

type ObserverFactory = (
  callback: (entries: Array<{ target: unknown; isIntersecting: boolean }>) => void,
  options?: unknown,
) => Observer

export interface ObserveOptions {
  /** Injectable so this is testable without a DOM. Null means unsupported. */
  observerFactory?: ObserverFactory | null
  /** How far ahead of the viewport to trigger. */
  rootMargin?: string
}

/** An element this shim can mark. */
interface Markable {
  setAttribute(name: string, value: string): void
}

const mark = (el: Markable): void => el.setAttribute(IN_VIEW_ATTR, '')

/**
 * Reveals elements as they scroll into view. Returns a teardown.
 *
 * A page with no scroll-triggered elements creates no observer at all, so the
 * common page pays nothing for a feature it does not use.
 */
export function observeInView(elements: Markable[], options: ObserveOptions = {}): () => void {
  const noop = () => {}
  if (!elements || elements.length === 0) return noop

  // The injection point is a plain function, which keeps it trivial to fake.
  // The real IntersectionObserver is a constructor, so it is wrapped here
  // rather than making every caller and test deal with `new`.
  const Native = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
  const factory: ObserverFactory | null | undefined = options.observerFactory === undefined
    ? (typeof Native === 'function'
        ? (cb, o) => new (Native as new (c: unknown, o?: unknown) => Observer)(cb, o)
        : undefined)
    : options.observerFactory

  // Without an observer the elements would stay paused at opacity 0 and the
  // content would simply never appear. Showing it unanimated is the only
  // acceptable failure.
  if (typeof factory !== 'function') {
    for (const el of elements) mark(el)
    return noop
  }

  let remaining = elements.length
  const observer = factory((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      mark(entry.target as Markable)
      // Once revealed, stop watching: a reveal that re-runs on every scroll
      // past is a distraction, and the observer costs work until it stops.
      observer.unobserve(entry.target)
      remaining -= 1
    }
    if (remaining <= 0) observer.disconnect()
  }, { rootMargin: options.rootMargin ?? '0px 0px -10% 0px' })

  for (const el of elements) observer.observe(el)
  return () => observer.disconnect()
}
