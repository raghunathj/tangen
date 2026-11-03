/**
 * File Name: content-path.ts
 * Purpose: What a content type declares as its ADDRESS - slice 2 of
 *          tasks/plan-content-paths.md. The platform composes an address from
 *          data it already holds; turning an address back into content stays
 *          the site's, because its router already declares those routes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure types. The grammar, the composer and the
 *          validators live in `@tangen/schema`; the per-row resolution lives
 *          in the API, where one recursive query serves a whole page of rows.
 */

/**
 * How a site puts a locale in front of an address, for the locales that do
 * not carry one in their own host (`LocaleDef.url`).
 *
 * `as-needed` is the default and matches what Next's own i18n routing does:
 * the default locale is bare and every other is prefixed. `never` is for a
 * site whose middleware does this itself and wants the platform to add
 * nothing.
 */
export type PathPrefixMode = 'as-needed' | 'always' | 'never'

/**
 * A code-side address builder. It is BEHAVIOUR, not structure, so it cannot
 * cross the push boundary into Postgres: it registers in the behaviour overlay
 * beside `validate`, `dynamicOptions` and the content hooks, exactly as those
 * already do. Returning null means "this object has no page", which every
 * artifact that needs an address already treats as a legitimate answer.
 */
export type ContentPathFn = (object: Record<string, unknown>) => string | null

/**
 * The three ways a type says where its content lives.
 *
 * - a PATTERN is structure: it pushes to the database, so the Admin can draw
 *   an editor's live URL and the GUI builder can edit it
 * - `{ field }` reads an authored column, which is what honours a migration's
 *   existing addresses. It supersedes the SEO extension's `urlField`.
 * - a FUNCTION is the escape hatch, for the rules a pattern cannot state (a
 *   homepage whose slug is `home` but whose address is `/`)
 */
export type ContentPathConfig = ContentPathPattern | { field: string } | ContentPathFn

/**
 * The pattern form. A bare string is sugar for `{ pattern }`; the object form
 * exists so `root` can travel with it, since a root slug is meaningless on its
 * own and belongs to the pattern it modifies.
 */
export type ContentPathPattern = string | { pattern: string; root?: string }

/** True when the declaration is the pushable, Admin-readable kind. */
export function isPathPattern(config: unknown): config is ContentPathPattern {
  if (typeof config === 'string') return true
  return !!config && typeof config === 'object' && typeof (config as { pattern?: unknown }).pattern === 'string'
}

/**
 * The pattern form in its one shape, or null when the declaration is one of
 * the other two. Callers read this instead of discriminating on the union,
 * so the sugar is unwrapped in exactly one place.
 */
export function pathPatternOf(config: unknown): { pattern: string; root?: string } | null {
  if (typeof config === 'string') return { pattern: config }
  if (!config || typeof config !== 'object') return null
  const c = config as { pattern?: unknown; root?: unknown }
  if (typeof c.pattern !== 'string') return null
  return typeof c.root === 'string' ? { pattern: c.pattern, root: c.root } : { pattern: c.pattern }
}

/** True when the declaration reads an authored column. */
export function isPathField(config: unknown): config is { field: string } {
  if (!config || typeof config !== 'object') return false
  const c = config as { field?: unknown; pattern?: unknown }
  // Both forms are objects, so the discriminator is which key is present.
  return typeof c.field === 'string' && typeof c.pattern !== 'string'
}

/** True when the declaration is code-side and belongs to the behaviour overlay. */
export function isPathFn(config: unknown): config is ContentPathFn {
  return typeof config === 'function'
}

/**
 * What stands in for a path FUNCTION once the declaration has crossed a
 * serialisation boundary.
 *
 * Both boundaries are JSON: the CLI loads a project's schema with
 * `JSON.stringify(mod.default)` in a subprocess, and the API rebuilds its
 * request schema from Postgres. A function value survives neither, so without
 * this a function-addressed type is indistinguishable from one with no address
 * - and the Admin would offer to author a pattern the code already overrides.
 */
export const PATH_FN_MARKER = { fn: true } as const

/** The marker's type. Stored in `object_types.path`, never written by hand. */
export type ContentPathFnMarker = typeof PATH_FN_MARKER

/**
 * The three storable shapes. A function is not among them, which is the
 * point: this is the union that can be written to Postgres and read back.
 */
export type StoredContentPath = { pattern: string; root?: string } | { field: string } | ContentPathFnMarker

/** True when a declaration says "the address is built in code". */
export function isPathFnMarker(config: unknown): config is ContentPathFnMarker {
  if (!config || typeof config !== 'object') return false
  return (config as { fn?: unknown }).fn === true
}

/**
 * A declaration in the one shape that can be stored, or null when the type
 * declares no address.
 *
 * The pattern sugar is unwrapped here so the database holds one shape, and a
 * function becomes the marker. Every other value is rejected as no address
 * rather than stored as something a reader would have to guess at.
 */
export function storedPathOf(config: unknown): StoredContentPath | null {
  if (isPathFn(config)) return PATH_FN_MARKER
  const pattern = pathPatternOf(config)
  if (pattern) return pattern
  if (isPathField(config)) return { field: config.field }
  if (isPathFnMarker(config)) return PATH_FN_MARKER
  return null
}
