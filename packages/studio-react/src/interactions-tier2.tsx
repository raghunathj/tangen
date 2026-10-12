'use client'
/**
 * File Name: interactions-tier2.tsx
 * Purpose: The Tier 2 Interactions island - mounted only when a published
 *          artifact's manifest names the module.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: An island because it needs an effect and the DOM;
 *          everything else in this package stays server-renderable. It
 *          receives DECLARATIONS - plain JSON - so the RSC boundary stays
 *          legal and nothing executable crosses it.
 *
 *          The interpreter is fetched, not bundled. A page that declares no
 *          Tier 2 interaction never renders this component, so the dynamic
 *          import inside the runtime is never reached and the chunk is never
 *          requested - which was confirmed at the network layer in three
 *          engines.
 *
 *          The effect body is a plain exported FUNCTION rather than inline in
 *          the hook. renderToStaticMarkup runs no effects and this repo has
 *          no DOM in its tests, so an inline effect would be untestable - and
 *          the property that most needs a test is the one where the chunk
 *          fails to arrive. Fail open is not a claim worth making untested.
 *
 *          The marker attribute exists so a site, and a test, can see whether
 *          the island was mounted at all.
 */
import { useEffect } from 'react'
import { applyInteractionsTier2 } from '@tangen/studio-runtime'
import type { DeliveredTier2Declaration, Tier2ApplyOptions } from '@tangen/studio-runtime'

/**
 * Starts the interpreter and returns a teardown, synchronously.
 *
 * Synchronous return matters: React wants a cleanup function now, and the
 * chunk arrives later. An unmount that happens first must still tear down
 * whatever the chunk starts, or a SPA route change leaks an observer and an
 * rAF loop for a page nobody is looking at.
 *
 * Nothing here catches, because nothing here can throw:
 * `applyInteractionsTier2` reports failure rather than raising it, precisely
 * so that a caller cannot write a catch that swallows too much.
 */
export function mountInteractionsTier2(
  declarations: DeliveredTier2Declaration[],
  options: Tier2ApplyOptions = {},
): () => void {
  let teardown: (() => void) | null = null
  let mounted = true
  void applyInteractionsTier2(declarations, options).then((applied) => {
    if (!mounted) { applied.teardown(); return }
    teardown = applied.teardown
  })
  return () => {
    mounted = false
    teardown?.()
  }
}

export function InteractionsTier2Runtime({ declarations }: { declarations: DeliveredTier2Declaration[] }) {
  // Serialized rather than passed as an array: a fresh array literal on every
  // render would re-run the effect forever, tearing the interpreter down and
  // re-fetching it each time - the opposite of a lazy module.
  const key = JSON.stringify(declarations)

  useEffect(() => mountInteractionsTier2(JSON.parse(key) as DeliveredTier2Declaration[]), [key])

  return <span data-tg-t2-runtime={String(declarations.length)} hidden />
}
