/**
 * File Name: composed-path.ts
 * Purpose: Reading the address Tangen composed. A read that asked for it
 *          (`.includePath()`) answers `_path`: the type's declared `path`
 *          with every relation and ancestor filled in and the locale prefix
 *          applied. `null` for a type that declares none.
 *
 *          One function rather than four inline casts, because the key is
 *          the platform's contract and this extension reads it in four
 *          places - the canonical, the sitemap, llms.txt and a redirect.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** The platform's key for a composed address on a read that asked for one. */
export const PATH_KEY = '_path'

/** The composed address on a row, or null - never a guess from the slug. */
export function composedPath(row: Record<string, unknown> | null | undefined): string | null {
  const value = row?.[PATH_KEY]
  return typeof value === 'string' && value ? value : null
}

/**
 * Whether a type declares an address at all. The gate that keeps a redirect
 * map cheap: a type with no `path` and no declared field has nothing on its
 * row worth reading, so the object is never fetched.
 */
export function typeDeclaresPath(
  ctx: { types?: () => Array<{ name: string; path?: unknown }> } | undefined,
  type: string,
): boolean {
  try {
    return !!ctx?.types?.().find((t) => t.name === type)?.path
  } catch { return false }
}
