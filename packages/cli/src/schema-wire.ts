/**
 * File Name: schema-wire.ts
 * Purpose: What a project's schema looks like once it has crossed the push
 *          boundary. Loaded by the isolated subprocess that imports the
 *          schema barrel, so it must stay dependency-free: anything it imports
 *          is imported into that subprocess too.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: NONE, deliberately. `schema-loader.ts` reaches drizzle
 *          and `@tangen/db`, which is why this is its own module rather than a
 *          function over there.
 *
 *          Behaviour does not survive the boundary and is not meant to: hooks,
 *          validate and dynamicOptions belong to the runtime overlay. A type's
 *          `path` is the one exception that needed naming, because a FUNCTION
 *          there is not behaviour the Admin can ignore - it is the answer to
 *          "where does this content live", and a type whose address is built
 *          in code must not read to the Admin as a type with no address at
 *          all. So a function becomes a marker instead of vanishing.
 */

/** The marker a path function serialises to. Mirrors `PATH_FN_MARKER` in
 *  `@tangen/types`, by value, because this module imports nothing. */
export const WIRE_PATH_FN = { fn: true }

/**
 * A `JSON.stringify` replacer for a schema barrel's default export.
 *
 * Only a FUNCTION-valued `path` is rewritten. A pattern string, the `{ field }`
 * form and every other key pass through untouched, so the serialised structure
 * is otherwise exactly what `JSON.stringify` alone produced before.
 */
export function schemaJsonReplacer(key: string, value: unknown): unknown {
  if (key === 'path' && typeof value === 'function') return WIRE_PATH_FN
  return value
}
