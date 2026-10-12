'use client'
/**
 * File Name: enter-view.tsx
 * Purpose: The one client island a published Studio page may need - the
 *          enter-view shim, mounted only when the artifact's manifest asks
 *          for it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: An island because it needs an effect and the DOM;
 *          everything else in this package stays server-renderable. It
 *          receives only class NAMES - serializable strings - so the RSC
 *          boundary stays legal.
 *
 *          It never learns what the animation is. The compiler already
 *          emitted it, paused, into the stylesheet, and this only flips one
 *          attribute. That is what keeps the script tiny and keeps the motion
 *          inspectable in CSS rather than buried in JavaScript.
 *
 *          The marker attribute exists so a site (and a test) can see whether
 *          the shim was mounted at all. "The runtime activates only what a
 *          page needs" is decoration unless its absence is observable.
 */
import { useEffect } from 'react'
import { observeInView } from '@tangen/studio-runtime'

/** A class name that can safely go into a selector. */
const SAFE_CLASS = /^[A-Za-z_][A-Za-z0-9_-]*$/

export function EnterViewRuntime({ classNames }: { classNames: string[] }) {
  // Joined rather than passed as an array: a fresh array literal on every
  // render would re-run the effect forever and tear the observer down each
  // time, which is the opposite of watching for a scroll.
  const key = classNames.join(',')

  useEffect(() => {
    const names = key ? key.split(',').filter((n) => SAFE_CLASS.test(n)) : []
    if (names.length === 0) return
    const found = document.querySelectorAll(names.map((n) => `.${n}`).join(','))
    // Teardown disconnects, so a SPA route change leaks no observer.
    return observeInView(Array.from(found) as unknown as Array<{ setAttribute(n: string, v: string): void }>)
  }, [key])

  return <span data-tg-inview-runtime={key} hidden />
}
