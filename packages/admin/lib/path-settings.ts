/**
 * File Name: path-settings.ts
 * Purpose: The type settings sheet's address rule - slice 8 of
 *          tasks/plan-content-paths.md. The pattern form is STRUCTURE
 *          precisely so it can be edited in a sheet; this is what the sheet
 *          says back while the developer types.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure, and it owns no grammar. Validation is
 *          @tangen/schema's `validatePathPattern`, the same function the push
 *          refuses with, and the example comes from the same `composePath`
 *          the read composes with. A second implementation here would be a
 *          sheet that accepts what the push rejects.
 *
 *          A sheet that only refuses on push teaches nothing: the message
 *          arrives after a database round trip, naming a field the developer
 *          has already stopped looking at.
 */
import { parsePathPattern, validatePathPattern, composePath } from '@tangen/schema'
import { isPathFnMarker, isPathField, pathPatternOf } from '@tangen/types'

/** Which of the four states a type's declaration is in. */
export type PathKind = 'pattern' | 'field' | 'code' | 'none'

/** As much of a field as the address row needs. */
export interface PathFieldLike {
  name: string
  fieldType: string
  config?: unknown
}

/** What the row renders: an error OR an example, never both. */
export interface PathSetting {
  /** The reason the declaration cannot work, naming the offending token. */
  error?: string
  /** One address built from the pattern, so the shape is visible. */
  example?: string
  /** Where the declared root slug lives, when one is declared. */
  rootExample?: string
  /** A sentence for the forms that are not a pattern. */
  note?: string
  /** True when the sheet must not offer to edit this. */
  readOnly?: boolean
}

/**
 * Which editor the declaration gets. `code` is the one that matters: a
 * function cannot be edited in a sheet and must not read as "none", or the
 * sheet would offer to author a pattern the code already overrides.
 */
export function pathKindOf(config: unknown): PathKind {
  if (config == null) return 'none'
  if (isPathFnMarker(config)) return 'code'
  if (pathPatternOf(config)) return 'pattern'
  if (isPathField(config)) return 'field'
  return 'none'
}

/** The fields an authored address could plausibly be stored in. */
const AUTHORABLE = new Set(['text', 'slug', 'url', 'textarea'])

/**
 * The candidates for the `{ field }` form. A relation is excluded: it names
 * another object, which is what a PATTERN segment is for.
 */
export function pathFieldCandidates<T extends PathFieldLike>(fields: readonly T[]): T[] {
  return fields.filter((f) => AUTHORABLE.has(f.fieldType))
}

/** Stand-ins for the example, so a developer reads a shape and not `:slug`. */
const EXAMPLE_SLUG = 'my-'
const EXAMPLE_CHAIN = ['about', 'company']
const EXAMPLE_ONE = 'section'

/**
 * What the address row says for a declaration, as it is typed.
 *
 * An empty pattern is nothing declared rather than an error, because every
 * new type starts there and a red row on an untouched sheet is noise.
 */
export function describePathSetting(
  config: unknown,
  typeName: string,
  fields: readonly PathFieldLike[],
): PathSetting {
  if (isPathFnMarker(config)) {
    return {
      readOnly: true,
      note: 'This type builds its address in code. Edit the `path` function in the schema file.',
    }
  }

  if (isPathField(config)) {
    const found = fields.some((f) => f.name === config.field)
    return found
      ? { note: `The address is whatever the "${config.field}" field holds.` }
      : { error: `"${config.field}" is not a field of this type` }
  }

  const declared = pathPatternOf(config)
  if (!declared || declared.pattern.trim() === '') return {}

  try {
    validatePathPattern(typeName, declared, fields)
  } catch (e) {
    // The validator's message already names the type, the pattern and the
    // offending token. Repeating it is what keeps the sheet and the push
    // saying the same thing.
    return { error: (e as Error).message.replace(`type "${typeName}" path "${declared.pattern}": `, '') }
  }

  // One example, from the composer the read uses. The values are stand-ins,
  // not data: the point is the SHAPE, and a chain shows more than one segment
  // because root-first is the only surprising thing about `*`.
  const segments = parsePathPattern(declared.pattern)
  const values: Record<string, string | string[]> = {}
  for (const seg of segments) {
    if (seg.kind !== 'field') continue
    values[seg.field] = seg.chain ? EXAMPLE_CHAIN : EXAMPLE_ONE
  }
  const example = composePath(segments, { slug: `${EXAMPLE_SLUG}${typeName}`, fields: values }) ?? undefined

  const out: PathSetting = { ...(example ? { example } : {}) }
  if (declared.root !== undefined) {
    // The declared root page has no `:slug` hole: it lives at the site root,
    // which is the thing `root` exists to say.
    out.rootExample = composePath(segments, { slug: declared.root, fields: values }, { root: declared.root }) ?? '/'
  }
  return out
}
