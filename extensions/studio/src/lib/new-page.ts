/**
 * File Name: new-page.ts
 * Purpose: The model behind creating a page from inside Studio - validating
 *          the choice and working out what blocks the new draft starts with.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Studio's empty state used to read "Create one from the
 *          content area, then open it here" - sending a marketer to a
 *          different tool to make the thing they came to make. This closes
 *          that without inventing a create path: the caller uses the SAME
 *          objects create endpoint the editor and the generate flow use,
 *          then writes blocks through the normal draft save.
 *
 *          A template's blocks are cloned with fresh keys. Reusing the
 *          stored ones would make two pages share block identity, and Studio
 *          selects by `_key`.
 */
import { cloneWithFreshKeys } from './presets'
import { slugify } from '@/lib/editor'

/** Longest page name we accept - beyond this it is a paste accident. */
export const TITLE_MAX = 200

export interface StudioTypeLike {
  type: string
  label: string
  blocksField: string
}

export interface NewPageInput {
  typeName: string
  title: string
  /** The page's URL. Derived from the title when left blank. */
  slug?: string
  /** A preset/template block to start from; blank when absent. */
  template?: Record<string, unknown>
}

export interface NewPagePlan {
  typeName: string
  blocksField: string
  title: string
  slug: string
  blocks: Array<Record<string, unknown>>
}

export type PlanResult =
  | { ok: true; plan: NewPagePlan }
  | { ok: false; error: string }

/**
 * Validates the choice and resolves the starting blocks. Errors are written
 * for the person making the page, not the developer reading the log.
 */
export function planNewPage(input: NewPageInput, opts: { types: StudioTypeLike[] }): PlanResult {
  const types = opts.types ?? []
  if (types.length === 0) {
    return { ok: false, error: 'No content type in this environment can hold a Studio page yet.' }
  }

  const typeName = (input.typeName ?? '').trim()
  if (!typeName) return { ok: false, error: 'Choose what kind of page to create.' }

  const match = types.find((t) => t.type === typeName)
  if (!match) return { ok: false, error: `Studio cannot open "${typeName}" pages.` }

  const title = (input.title ?? '').trim()
  if (!title) return { ok: false, error: 'Give the page a name.' }
  if (title.length > TITLE_MAX) {
    return { ok: false, error: `That name is too long (${TITLE_MAX} characters max).` }
  }

  // The slug is the page's URL, so what the user typed is NORMALISED rather
  // than rejected - someone typing "My Page" into a slug field means my-page.
  // But an input that normalises to nothing is refused instead of silently
  // creating a page at an empty path, which would 404 rather than fail
  // visibly.
  const wanted = (input.slug ?? '').trim()
  const slug = slugify(wanted !== '' ? wanted : title)
  if (slug === '') {
    return {
      ok: false,
      error: wanted !== ''
        ? 'That web address has no usable characters. Use letters, numbers and hyphens.'
        : 'This name cannot become a web address. Add letters or numbers, or set one yourself.',
    }
  }

  const blocks = input.template
    ? [cloneWithFreshKeys(input.template) as Record<string, unknown>]
    : []

  return { ok: true, plan: { typeName, blocksField: match.blocksField, title, slug, blocks } }
}
