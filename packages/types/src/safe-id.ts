/**
 * File Name: safe-id.ts
 * Purpose: One identifier contract for the names Tangen turns into database
 *          identifiers (closure plan Phase 6B, Unit 7): a content type, a
 *          field, a custom table, a custom column. The same regex was
 *          copied into eight modules with no length rule, which mattered:
 *          PostgreSQL truncates an identifier at 63 bytes, so two names
 *          that differ only past that point become ONE column, silently.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Two levels on purpose. `isSafeIdent` is the QUOTING
 *          guard every SQL path already uses - its rule is unchanged, so no
 *          identifier that exists today stops being readable. `idIssue` /
 *          `assertCreatableId` is the CREATION rule, which adds the length
 *          bound and the reserved namespaces; it governs new names only, so
 *          a project that already has a long or oddly-named column keeps
 *          working and is asked to rename it only if it renames it anyway.
 *          Nothing here transliterates: a name Tangen cannot use is
 *          refused with the reason, never quietly rewritten into something
 *          the developer did not write.
 */

/** PostgreSQL's identifier limit (NAMEDATALEN - 1). Longer names are TRUNCATED by the server. */
export const SAFE_ID_MAX_BYTES = 63

/** Letters, digits and underscore, not starting with a digit - what a bare SQL identifier may be. */
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Namespaces Tangen owns. A developer's own type, field or table may not
 * start with one, so a name can never collide with a platform artifact.
 */
export const RESERVED_ID_PREFIXES = [
  '_dropped__',   // guarded drops (Phase 1): a column kept aside after a destructive push
  '__',           // localized side columns (`__title`) and other internal markers
  'pg_',          // PostgreSQL's own namespace
] as const

/** True when `name` is a plain SQL identifier - the quoting guard, unchanged from before. */
export function isSafeIdent(name: unknown): name is string {
  return typeof name === 'string' && IDENT_RE.test(name)
}

/** Returns `name` when it is a safe identifier, throws otherwise - the DDL guard. */
export function safeIdent(name: string): string {
  if (!isSafeIdent(name)) throw new Error(`Invalid SQL identifier: "${name}"`)
  return name
}

/** True when the name is inside a namespace the platform reserves. */
export function isReservedId(name: string): boolean {
  return RESERVED_ID_PREFIXES.some((p) => name.startsWith(p))
}

/**
 * Why this name cannot be CREATED, or null when it can. The message names
 * the rule it broke, so a developer does not have to guess.
 */
export function idIssue(name: unknown, kind = 'name'): string | null {
  if (typeof name !== 'string' || name.length === 0) return `a ${kind} is required`
  if (/\s/.test(name)) return `a ${kind} cannot contain whitespace: "${name}"`
  if (!IDENT_RE.test(name)) {
    return /^[0-9]/.test(name)
      ? `a ${kind} cannot start with a digit: "${name}"`
      : `a ${kind} may use letters, digits and underscore only, and cannot start with a digit: "${name}"`
  }
  const bytes = Buffer.byteLength(name, 'utf8')
  if (bytes > SAFE_ID_MAX_BYTES) {
    return `a ${kind} is at most ${SAFE_ID_MAX_BYTES} bytes and "${name}" is ${bytes}: PostgreSQL would truncate it, and two names that differ only past that point would become one column`
  }
  if (isReservedId(name)) {
    return `"${name}" is in a namespace Tangen reserves (${RESERVED_ID_PREFIXES.join(', ')}): choose a ${kind} outside it`
  }
  return null
}

/** True when this name may be created. */
export function isCreatableId(name: unknown, kind = 'name'): boolean {
  return idIssue(name, kind) === null
}

/** Returns the name when it may be created, throws the reason otherwise. */
export function assertCreatableId(name: string, kind = 'name'): string {
  const issue = idIssue(name, kind)
  if (issue) throw new Error(issue)
  return name
}

/**
 * The first name in `names` that another one collides with, or null. Two
 * names collide when they are equal, or when they would become equal after
 * PostgreSQL truncated them - the case a length rule alone cannot catch on
 * data that already exists.
 */
export function findIdCollision(names: readonly string[]): { a: string; b: string } | null {
  const seen = new Map<string, string>()
  for (const name of names) {
    const key = Buffer.from(name, 'utf8').subarray(0, SAFE_ID_MAX_BYTES).toString('utf8')
    const previous = seen.get(key)
    if (previous !== undefined && previous !== name) return { a: previous, b: name }
    if (previous === undefined) seen.set(key, name)
  }
  return null
}
