/**
 * File Name: link.ts
 * Purpose: What a consuming application does with a link field it read
 *          (closure plan Phase 6B, Unit 18). Tangen resolves content
 *          identity; the application resolves site routing - so the SDK
 *          gives you the two guards and the target facts, and leaves the URL
 *          for an internal target to the router that actually owns it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The types come from @tangen/types, so the SDK and the
 *          server cannot disagree about the shape. There is deliberately no
 *          `hrefOf(link)` covering both branches: it would have to invent a
 *          path for internal content, which is the thing v1 does not do.
 */
import type { ResolvedLink, ResolvedInternalLink, ResolvedExternalLink } from '@tangen/types'

export type { ResolvedLink, ResolvedInternalLink, ResolvedExternalLink } from '@tangen/types'
export type { LinkValue, InternalLinkValue, ExternalLinkValue, LinkKind, LinkQuery } from '@tangen/types'

/** True when this link points at content in the workspace. */
export function isInternalLink(link: unknown): link is ResolvedInternalLink {
  return !!link && typeof link === 'object' && (link as ResolvedLink).type === 'internal'
}

/** True when this link points at a URL outside it. */
export function isExternalLink(link: unknown): link is ResolvedExternalLink {
  return !!link && typeof link === 'object' && (link as ResolvedLink).type === 'external'
}

/**
 * True when the link is usable as it stands: an external link always is, an
 * internal one only once its target resolved. A link whose target is missing,
 * deleted or unpublished is NOT resolved - render it as plain text rather
 * than as a link to nowhere.
 */
export function isLinkResolved(link: unknown): boolean {
  if (isExternalLink(link)) return typeof link.href === 'string' && link.href !== ''
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
