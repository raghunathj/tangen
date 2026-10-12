/**
 * File Name: tier2-loader.ts
 * Purpose: The one property read, the one dynamic import, and the fail-open
 *          catch that lets Tier 2 Interactions cost a Tier 1 page nothing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This file is on the ROOT export path and the
 *          interpreter is not. The import below is deliberately dynamic:
 *          `await import('./interactions-tier2')` is what makes every
 *          bundler emit the interpreter as its own chunk, so a page whose
 *          artifact declares no Tier 2 interaction downloads none of it,
 *          parses none of it and evaluates none of it. A static import here
 *          would silently move 1.8 KB onto every published page, and a
 *          boundary test plus a size test exist because that regression would
 *          be invisible in review.
 *
 *          Fail open, exactly like the enter-view shim. A broken animation
 *          must never hide content. Tier 2 can honour that more cheaply than
 *          Tier 1 because it emits NO CSS: the element is already in the
 *          state the page was authored in, which is the visible one, so a
 *          chunk that never arrives leaves a page that is merely unanimated
 *          and this function has nothing to undo.
 *
 *          Reduced motion is NOT short-circuited here, and that is a
 *          deliberate departure from the plan this was built to. Skipping the
 *          import would save a quiet visitor 1.8 KB and would also leave a
 *          count-up showing whatever number the page was authored with,
 *          because the end state for a rendered number is not the state the
 *          markup carries. The interpreter's reduced branch was proven in
 *          three engines: it writes every declaration's end state and
 *          constructs no animation, no observer and no rAF loop. Correctness
 *          beats 1.8 KB.
 */
import type { DeliveredTier2Declaration, Tier2Module, Tier2Scope } from './tier2-types'

/**
 * The module name a page's manifest uses to ask for the interpreter.
 *
 * Declared here rather than compared inline so the compiler's manifest, the
 * loader and the framework adapters cannot drift onto different strings.
 */
export const INTERACTIONS_TIER2_MODULE = 'interactions-tier2'

export interface Tier2LoadOptions {
  /**
   * Injected for testing, and so a host with its own module graph can supply
   * the chunk its own way. Absent means the real dynamic import.
   */
  load?: () => Promise<Tier2Module>
}

export interface Tier2ApplyOptions extends Tier2LoadOptions {
  /** Where to look for the declared targets. Defaults to the document. */
  root?: Tier2Scope
}

export interface Tier2Applied {
  /**
   * Whether the interpreter ran. False means the page is unanimated, never
   * that it is broken - which is why this is reported rather than thrown.
   */
  ok: boolean
  teardown: () => void
}

const noop = (): void => {}

/**
 * The interpreter, or null when it could not be had.
 *
 * Null rather than a throw: an animation chunk that fails to arrive is a
 * degraded page, not a failed one, and a caller that has to write a
 * try/catch around it will eventually write one that swallows too much.
 */
export async function loadInteractionsTier2(options: Tier2LoadOptions = {}): Promise<Tier2Module | null> {
  try {
    // Dynamic on purpose. See the note at the top of this file.
    const module = options.load ? await options.load() : await import('./interactions-tier2')
    return typeof (module as Tier2Module)?.apply === 'function' ? (module as Tier2Module) : null
  } catch {
    return null
  }
}

/**
 * Applies a page's Tier 2 declarations, and never makes a page worse.
 *
 * An empty list short-circuits BEFORE the import, which is the common case
 * and the reason the whole module is gated: it must cost one property read.
 */
export async function applyInteractionsTier2(
  declarations: DeliveredTier2Declaration[] | undefined,
  options: Tier2ApplyOptions = {},
): Promise<Tier2Applied> {
  if (!declarations || declarations.length === 0) return { ok: true, teardown: noop }

  const module = await loadInteractionsTier2(options)
  if (!module) return { ok: false, teardown: noop }

  try {
    return { ok: true, teardown: module.apply(declarations, options.root) ?? noop }
  } catch {
    // The chunk arriving is not the same as the chunk working. Whatever it
    // managed to start is left running rather than half-cancelled; the page
    // keeps its content either way.
    return { ok: false, teardown: noop }
  }
}
