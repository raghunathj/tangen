/**
 * File Name: path-pattern.ts
 * Purpose: The `path` pattern grammar and its composer - slice 1 of
 *          tasks/plan-content-paths.md. A content type declares the shape of
 *          its address; this turns that shape plus already-resolved segment
 *          values into one path. PURE: no database, no I/O, no clock, so the
 *          whole grammar is deterministic and testable without a tree.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Resolving the VALUES (a relation's slug, an ancestor
 *          chain) is the next slice and belongs to the API, where one
 *          recursive query serves a whole page of rows. This file never asks
 *          where a value came from.
 *
 *          The grammar is three tokens, and `*` carries the load:
 *            :field    exactly one segment, that relation's slug
 *            :field*   zero or more, that relation AND its ancestors, root first
 *            :field|x  the literal `x` when the relation is empty
 *          `*` reads as it does in a glob, so an empty chain is LEGAL and
 *          contributes nothing - which is what makes a page pattern of
 *          `:parent*` then `:slug` answer `/about` for a page with no parent.
 *          (That pattern is not written out here: it ends a block comment.)
 *          A bare `:field` is exactly one,
 *          so an empty one is a hole: refused unless a fallback fills it,
 *          because a short address is one the site's own router cannot match
 *          (a three-slot route does not match two segments) and the link would
 *          render, look right, and 404.
 */

/** The deepest address the platform will compose. Bounds the recursive walk. */
export const PATH_MAX_SEGMENTS = 6

/** One piece of a declared address. */
export type PathSegment =
  | { kind: 'literal'; value: string }
  /** The object's own slug. A column, not a relation, so it has its own kind. */
  | { kind: 'slug' }
  | { kind: 'field'; field: string; chain: boolean; fallback?: string }

/**
 * What a resolver hands the composer for ONE row: the object's slug, and each
 * named field's resolved value - a string for a one-hop relation, an array
 * root-first for a chain.
 */
export interface PathValues {
  slug: string | null
  fields: Record<string, string | string[] | null | undefined>
}

/**
 * Why there is no address, in a code the caller maps to its own message - the
 * shape `externalUrlIssue` and `pathLinkIssue` already use for links.
 */
export type PathResult =
  | { ok: true; path: string; template: string }
  /**
   * No slug, so no address - but the SHAPE is known, which is the whole point
   * for an editor: a new object has no slug yet and the path preview has to
   * draw `/blog/ux/` with the box at the end regardless.
   */
  | { ok: false; reason: 'no-slug'; template: string }
  /** A hole in the pattern: neither the address nor the shape is knowable. */
  | { ok: false; reason: 'empty-segment'; segment: string }
  | { ok: false; reason: 'too-deep'; depth: number }

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

function bad(pattern: string, detail: string): never {
  throw new Error(`path pattern "${pattern}": ${detail}`)
}

/** A value that is present but says nothing is as absent as one that is missing. */
const blank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === ''

/**
 * Parses a declared pattern into its segments. Throws on anything malformed,
 * naming the offending segment: a pattern is authored once and read months
 * later, and "invalid pattern" sends someone hunting through a line that may
 * hold five of them.
 */
export function parsePathPattern(pattern: string): PathSegment[] {
  if (typeof pattern !== 'string') bad(String(pattern), 'a pattern must be a string')
  const body = pattern.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  if (body === '') return []                       // '/' - the homepage

  const out: PathSegment[] = []
  for (const raw of body.split('/')) {
    if (raw === '') bad(pattern, 'empty segment - a path has no blank step in it')
    if (!raw.startsWith(':')) { out.push({ kind: 'literal', value: raw }); continue }

    let rest = raw.slice(1)
    let fallback: string | undefined
    const barAt = rest.indexOf('|')
    if (barAt !== -1) { fallback = rest.slice(barAt + 1); rest = rest.slice(0, barAt) }
    let chain = false
    if (rest.endsWith('*')) { chain = true; rest = rest.slice(0, -1) }

    if (rest === 'slug') {
      // The slug is the row's own column: there is no chain above it and no
      // row without it, so neither modifier means anything here.
      if (chain || fallback !== undefined) {
        bad(pattern, `segment "${raw}" - :slug takes neither * nor a fallback`)
      }
      out.push({ kind: 'slug' })
      continue
    }
    if (rest === '') bad(pattern, `segment "${raw}" names no field`)
    // "or nothing" is what * already says, so an empty fallback is either a
    // typo or a misunderstanding. Both are worth stopping.
    if (fallback !== undefined && fallback.trim() === '') {
      bad(pattern, `segment "${raw}" has an empty fallback - write * if the segment may be absent`)
    }
    if (!IDENTIFIER.test(rest)) {
      bad(pattern, `segment "${raw}" - "${rest}" is not a field name`)
    }
    out.push({ kind: 'field', field: rest, chain, ...(fallback !== undefined ? { fallback } : {}) })
  }

  if (out.length > PATH_MAX_SEGMENTS) {
    bad(pattern, `declares ${out.length} segments; an address may hold at most ${PATH_MAX_SEGMENTS}`)
  }
  return out
}

/**
 * Composes one address from a parsed pattern and a row's resolved values, or
 * explains why there is none. A missing address is a legitimate answer: the
 * sitemap omits the object and the canonical stays unset, rather than either
 * inventing an address or failing the read.
 */
export interface PathOptions {
  /**
   * The slug whose object lives at `/`. A pattern cannot state this and
   * neither can a function: a function sees the object, so it can test the
   * slug, but never the ancestor chain, which takes a recursive query. The
   * home page needs both, so it is declared rather than computed - the same
   * thing WordPress calls "front page displays".
   */
  root?: string
}

export function resolvePathPattern(
  segments: readonly PathSegment[],
  values: PathValues,
  options: PathOptions = {},
): PathResult {
  // Before any walk: its address is `/` whatever the pattern says and whatever
  // tree it sits in, so there is no hole for the editor to draw a box in
  // either. The slug decides, not the parent.
  if (
    options.root !== undefined
    && !blank(values.slug)
    && (values.slug as string).trim() === options.root
  ) {
    return { ok: true, path: '/', template: '/' }
  }

  // Two strings from one walk: the address, and the same address with `:slug`
  // left where the slug goes. The second is what the editor draws around its
  // input, so it must be composable while the slug is still empty.
  const parts: string[] = []
  const shape: string[] = []
  let slugMissing = false

  /** A segment that reads the same in the address and in the shape. */
  const both = (value: string) => { parts.push(value); shape.push(value) }

  for (const seg of segments) {
    if (seg.kind === 'literal') { both(seg.value); continue }

    if (seg.kind === 'slug') {
      shape.push(':slug')
      if (blank(values.slug)) slugMissing = true
      else parts.push(encodeURIComponent((values.slug as string).trim()))
      continue
    }

    const value = values.fields[seg.field]

    if (seg.chain) {
      // A blank link is dropped rather than emitting a double slash: one bad
      // row in the middle of a tree should cost its own segment, not the
      // whole address.
      const links = Array.isArray(value) ? value.filter((v) => !blank(v)) : []
      if (links.length === 0) {
        if (seg.fallback !== undefined) both(encodeURIComponent(seg.fallback))
        continue                                   // * is zero or more: nothing is fine
      }
      for (const link of links) both(encodeURIComponent(link.trim()))
      continue
    }

    if (blank(value)) {
      if (seg.fallback === undefined) return { ok: false, reason: 'empty-segment', segment: seg.field }
      both(encodeURIComponent(seg.fallback))
      continue
    }
    both(encodeURIComponent((value as string).trim()))
  }

  // Measured on the SHAPE, which is the eventual address: the slug counts for
  // a segment whether it has been typed yet or not.
  if (shape.length > PATH_MAX_SEGMENTS) {
    // The pattern was inside the cap; a chain's LENGTH is data, so it can
    // still compose past it. This is the backstop - the save-time check is
    // what tells an editor before it happens.
    return { ok: false, reason: 'too-deep', depth: shape.length }
  }
  const template = `/${shape.join('/')}`
  if (slugMissing) return { ok: false, reason: 'no-slug', template }
  return { ok: true, path: `/${parts.join('/')}`, template }
}

/**
 * The address, or null. Sugar over `resolvePathPattern` for a caller that has
 * nothing to say about why. Takes a parsed pattern too, so one type is parsed
 * once and composed for every row.
 */
export function composePath(
  pattern: string | readonly PathSegment[],
  values: PathValues,
  options: PathOptions = {},
): string | null {
  const segments = typeof pattern === 'string' ? parsePathPattern(pattern) : pattern
  const result = resolvePathPattern(segments, values, options)
  return result.ok ? result.path : null
}

// ── What a type may declare ──────────────────────────────────────────────────

/** The shape of a field, as much of it as validation needs. */
interface FieldLike {
  name: string
  fieldType: string
  config?: unknown
}

/**
 * Refuses a pattern that names something this type cannot supply, at LOAD -
 * so a wrong declaration is a sentence naming the type and the field, rather
 * than an empty address discovered on a page months later.
 *
 * Checks what is knowable from one type. Whether a chain's TARGET is
 * hierarchical is cross-type and belongs with the schema-wide validators.
 */
export function validatePathPattern(
  typeName: string,
  declaration: string | { pattern: string; root?: string },
  fields: readonly FieldLike[],
): void {
  const pattern = typeof declaration === 'string' ? declaration : declaration.pattern
  const root = typeof declaration === 'string' ? undefined : declaration.root
  const segments = parsePathPattern(pattern)          // throws on the grammar first
  const byName = new Map(fields.map((f) => [f.name, f]))

  // A root slug with no `:slug` to match against can never fire, so it is a
  // typo rather than a configuration - and a silent one: every object would
  // compose normally and nobody would notice the home page was missing.
  if (root !== undefined && !segments.some((seg) => seg.kind === 'slug')) {
    throw new Error(
      `type "${typeName}" path "${pattern}": root "${root}" needs a :slug in the pattern to match against`,
    )
  }

  for (const seg of segments) {
    if (seg.kind !== 'field') continue
    const field = byName.get(seg.field)
    if (!field) {
      throw new Error(
        `type "${typeName}" path "${pattern}": "${seg.field}" is not a field of this type`,
      )
    }
    if (field.fieldType !== 'relation') {
      throw new Error(
        `type "${typeName}" path "${pattern}": "${seg.field}" is a ${field.fieldType}, and a `
        + `path segment is another object - only a relation can fill one`,
      )
    }
    // A segment holds one value, so "which of the tags?" has no answer and
    // taking the first would be a silent choice nobody declared.
    if ((field.config as { many?: boolean } | undefined)?.many === true) {
      throw new Error(
        `type "${typeName}" path "${pattern}": "${seg.field}" holds many, and a path segment `
        + `holds one value`,
      )
    }
  }
}

// ── The locale in front ──────────────────────────────────────────────────────

/** As much of the localisation config as the prefix depends on. */
interface LocalizationLike {
  enabled: boolean
  defaultLocale: string
  locales: readonly { code: string; label?: string; url?: string }[]
  pathPrefix?: 'as-needed' | 'always' | 'never'
}

/**
 * The locale's prefix for a composed address: `''` or `/de`.
 *
 * A locale that declares its own `url` carries the locale in the HOST, so it
 * is never also prefixed - which is what makes `de.example.com/de/blog`
 * inexpressible rather than something to remember to avoid. A locale this site
 * does not declare adds nothing, because inventing `/xx` would be worse than
 * leaving the address alone.
 */
export function localePathPrefix(
  locale: string | null | undefined,
  localization: LocalizationLike | undefined,
): string {
  if (!localization?.enabled) return ''
  if (typeof locale !== 'string' || locale.trim() === '') return ''
  const code = locale.trim()

  const declared = localization.locales.find((l) => l.code === code)
  // The default locale counts as declared whether or not the list repeats it:
  // "the default is included automatically".
  const isDefault = code === localization.defaultLocale
  if (!declared && !isDefault) return ''
  if (declared?.url) return ''

  switch (localization.pathPrefix ?? 'as-needed') {
    case 'never': return ''
    case 'always': return `/${code}`
    default: return isDefault ? '' : `/${code}`
  }
}

/**
 * A composed path with its locale in front. Works on a template too, so the
 * editor's URL preview is prefixed by the same rule as the live address.
 *
 * The homepage becomes `/de`, never `/de/`: a trailing slash there would be a
 * second address for one page, which is the duplicate-content bug this whole
 * feature exists to avoid.
 */
export function applyLocalePrefix(
  path: string | null,
  locale: string | null | undefined,
  localization: LocalizationLike | undefined,
): string | null {
  if (path === null) return null
  const prefix = localePathPrefix(locale, localization)
  if (prefix === '') return path
  return path === '/' ? prefix : `${prefix}${path}`
}
