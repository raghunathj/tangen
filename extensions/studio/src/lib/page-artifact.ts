/**
 * File Name: page-artifact.ts
 * Purpose: Turning a published page into the inputs a delivery artifact needs
 *          - its route, and the interactions its styling declares.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure functions, so the rules that matter are testable
 *          without a store, a client or a request.
 *
 *          A slug becomes a STORAGE PATH and a public URL. It is therefore
 *          validated rather than sanitised: quietly rewriting a hostile slug
 *          into something valid hides the intent instead of reporting it, and
 *          the person who typed it never learns their page is being served
 *          from somewhere else.
 *
 *          One route is reserved. `/_styles` is where the workspace
 *          stylesheet publishes, so a page slugged `_styles` would move that
 *          pointer at its next publish and unstyle every page in the
 *          workspace.
 */
import { SURFACES_ROUTE } from './global-surfaces'

/**
 * The delivery route the workspace stylesheet publishes under.
 *
 * It lives here, beside the page-route rules, because those rules have to
 * refuse it - and a reserved name defined somewhere the check cannot see is a
 * reserved name that will eventually stop being reserved.
 */
export const STYLES_ROUTE = '/_styles'

/** Routes the delivery layer already owns, which a page may not claim. */
const RESERVED = new Set([STYLES_ROUTE, SURFACES_ROUTE].map((r) => r.replace(/^\/+/, '')))

/**
 * The delivery route a published page is served under, or null when the slug
 * cannot become one.
 *
 * The dot is excluded from the allowed set deliberately: that is what stops
 * `..` forming, so traversal is impossible rather than merely filtered.
 */
export function pageRoute(slug: unknown): string | null {
  if (typeof slug !== 'string') return null
  const clean = slug.trim().replace(/^\/+|\/+$/g, '')
  if (!clean) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(clean)) return null
  if (RESERVED.has(clean)) return null
  return `/${clean}`
}

/** Which page a publish request is about. */
export interface PagePublishTarget {
  type: string
  id: string
  /**
   * Which REGION holds the blocks. A type may declare several component
   * fields, so a caller acting on a specific one has to name it; omitted,
   * the first is used, which is what every single-region page wants.
   */
  region: string | null
}

/** Validate an incoming page-publish body. Throws on junk. */
export function readPagePublishBody(body: unknown): PagePublishTarget {
  const b = (body ?? {}) as Record<string, unknown>
  const type = typeof b.type === 'string' ? b.type.trim() : ''
  const id = typeof b.id === 'string' ? b.id.trim() : ''
  if (!type) throw new Error('A content type is required to publish a page artifact')
  if (!id) throw new Error('A page id is required to publish a page artifact')
  const region = typeof b.region === 'string' && b.region.trim() !== '' ? b.region.trim() : null
  return { type, id, region }
}

/** One class row, as the extension store hands it back. */
interface ClassRow {
  key: string
  data: Record<string, unknown>
}

/**
 * The interactions a workspace's classes declare.
 *
 * An interaction is attached to a CLASS, so the class name is what names it
 * in the artifact. A row with no usable name contributes nothing - there
 * would be no selector to attach the motion to, and the compiler would refuse
 * it a moment later anyway.
 *
 * The values are handed on RAW: the compiler normalises and allow-lists them
 * on the way into the artifact, and validating twice in two places is how the
 * two rule sets drift apart.
 */
export function interactionsFromClasses(rows: ClassRow[]): Array<{ className: string; interaction: unknown }> {
  const out: Array<{ className: string; interaction: unknown }> = []
  for (const { data } of rows ?? []) {
    const name = typeof data?.name === 'string' ? data.name : ''
    if (!name || data.interaction == null) continue
    out.push({ className: name, interaction: data.interaction })
  }
  return out
}
