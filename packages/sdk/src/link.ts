/**
 * File Name: link.ts
 * Purpose: What a consuming application does with a link field it read
 *          (closure plan Phase 6B, Unit 18). The guards, the target facts,
 *          and one href for whichever branch the link turned out to be.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The types come from @tangen/types, so the SDK and the
 *          server cannot disagree about the shape.
 *
 *          `linkHref` once answered null for internal content, because
 *          Tangen owned no route model and any href would have been invented.
 *          A type that declares `path` now says where its objects live, so the
 *          server composes the address and the href is read rather than
 *          guessed (slice 5 of tasks/plan-content-paths.md). A type that
 *          declares no path still has no address, and there `linkHref` answers
 *          null exactly as before and the routing stays the site's.
 *
 *          A PATH link (2026-10-14) needs no router either way: it already IS
 *          a route on your site, so its `href` is the whole answer.
 */
import type { ResolvedLink, ResolvedInternalLink, ResolvedExternalLink, ResolvedPathLink } from '@tangen/types'

export type { ResolvedLink, ResolvedInternalLink, ResolvedExternalLink, ResolvedPathLink } from '@tangen/types'
export type { LinkValue, InternalLinkValue, ExternalLinkValue, PathLinkValue, LinkKind, LinkQuery } from '@tangen/types'

/** True when this link points at content in the workspace. */
export function isInternalLink(link: unknown): link is ResolvedInternalLink {
  return !!link && typeof link === 'object' && (link as ResolvedLink).type === 'internal'
}

/** True when this link points at a URL outside it. */
export function isExternalLink(link: unknown): link is ResolvedExternalLink {
  return !!link && typeof link === 'object' && (link as ResolvedLink).type === 'external'
}

/** True when this link points at a route on your own site, like `/pricing`. */
export function isPathLink(link: unknown): link is ResolvedPathLink {
  return !!link && typeof link === 'object' && (link as ResolvedLink).type === 'path'
}

/**
 * Where this link goes, with the query and anchor merged in: the authored URL
 * for an external link, the authored route for a path link, and the composed
 * address for an internal link whose target type declares a `path`.
 *
 * null only where there genuinely is no address: an unresolved link of any
 * kind, or an internal link into a type that declares no path. Reach for this
 * first - one call renders every branch, and the null case is the one place a
 * site still has to decide its own route.
 */
export function linkHref(link: unknown): string | null {
  if (!isExternalLink(link) && !isPathLink(link) && !isInternalLink(link)) return null
  return typeof link.href === 'string' && link.href !== '' ? link.href : null
}

/**
 * True when the link is usable as it stands: an external or path link always
 * is, an internal one only once its target resolved. A link whose target is
 * missing, deleted or unpublished is NOT resolved - render it as plain text
 * rather than as a link to nowhere.
 */
export function isLinkResolved(link: unknown): boolean {
  if (isExternalLink(link) || isPathLink(link)) return typeof link.href === 'string' && link.href !== ''
  return isInternalLink(link) && link.target !== null
}

/**
 * The query string and fragment an internal link asked for, ready to append
 * to whatever path your router builds for the target: `?source=footer#team`,
 * or '' when the link asked for neither.
 */
export function linkSuffix(link: ResolvedInternalLink): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(link.query ?? {})) params.set(k, v)
  const q = params.toString()
  return `${q ? `?${q}` : ''}${link.anchor ? `#${encodeURIComponent(link.anchor)}` : ''}`
}
