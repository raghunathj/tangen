/**
 * File Name: skin.ts
 * Purpose: Puts the Studio skin on the document root while the builder is
 *          open, and takes it off cleanly when it closes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Scoping Studio's own subtree is NOT enough - dialogs
 *          and sheets portal to document.body (Radix), so the palette and
 *          generate dialogs would render in the admin's light theme on top
 *          of a dark builder. Studio is a full-viewport takeover, so while
 *          it is open the document IS Studio and the root is the honest
 *          place to scope.
 *
 *          Studio has its OWN dark palette, so this adds `studio` alone and
 *          never touches `dark`. A user who set the admin to dark mode is
 *          left exactly as found: Studio neither depends on that class nor
 *          disturbs it, and never inherits the admin's dark values.
 *          Disposers are single-use so a stale one from a previous mount
 *          cannot strip a live skin.
 */

/** The minimum of an element this needs - keeps it testable without a DOM. */
type ClassRoot = { classList: { add: (...c: string[]) => void; remove: (...c: string[]) => void } }

/**
 * Applies the skin and returns a disposer. Safe to call with a missing root
 * (no document); the disposer is then a no-op.
 */
export function applyStudioSkin(root: ClassRoot | null | undefined): () => void {
  if (!root?.classList) return () => {}
  root.classList.add('studio')

  let spent = false
  return () => {
    if (spent) return
    spent = true
    root.classList.remove('studio')
  }
}
