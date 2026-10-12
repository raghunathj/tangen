/**
 * File Name: class-name.ts
 * Purpose: What a style class may be CALLED - the one slugifier, and the
 *          length the selector stays usable at.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A class name is a SELECTOR. The Studio extension
 *          normalises a designer's typed name with this before storing it,
 *          and the platform's Porter provider re-checks an incoming row
 *          against it - `normalizeClassName(name) === name` is the whole
 *          test, so the two sides can never disagree about what is storable.
 *          `extensions/studio/src/lib/classes.ts` re-exports both names.
 */

/** Long enough to be descriptive, short enough to stay a usable selector. */
export const MAX_CLASS_NAME = 48

/**
 * Slugifies a typed name. Returns '' when nothing usable remains, so the
 * caller refuses rather than creating an unselectable class.
 */
export function normalizeClassName(raw: string): string {
  const slug = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_CLASS_NAME)
    .replace(/-+$/, '')
  // A leading digit is an invalid CSS selector; prefix rather than reject, so
  // "2xl heading" still produces something usable.
  return slug === '' ? '' : /^\d/.test(slug) ? `s-${slug}`.slice(0, MAX_CLASS_NAME) : slug
}
