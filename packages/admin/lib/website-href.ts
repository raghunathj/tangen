/**
 * File Name: website-href.ts
 * Purpose: An `href` the Admin renders from EXTENSION-DECLARED metadata, with
 *          its scheme checked.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Security audit finding 23 (S6). An extension manifest's
 *          `homepage` was rendered straight into `href` in two places on the
 *          extensions settings page. A manifest is the extension author's
 *          input, not the operator's, so `javascript:alert(...)` there was a
 *          click away from running in the Admin origin - as the operator who
 *          installed it, with their session.
 *
 *          NOT `externalHref` from @tangen/types, which already exists and
 *          does a different job: that one DERIVES an href from a stored link
 *          value that the link validator already vetted. This one is given a
 *          bare string nobody vetted. The scheme PARSER is shared (`urlScheme`)
 *          so there is one answer to "what scheme is this", and the policy is
 *          narrower than a link field's: a website is http or https, where a
 *          document legitimately links to `mailto` and `tel`.
 *
 *          Nothing is rewritten. An unusable href renders as TEXT, so the
 *          operator still sees what the manifest declared and can judge it;
 *          silently turning it into `https://` would be guessing at the
 *          author's intent, and silently dropping the row would hide a
 *          manifest worth looking at.
 */
import { urlScheme } from '@tangen/types'

/** The only schemes a declared website may carry. */
export const WEBSITE_HREF_SCHEMES: readonly string[] = ['http', 'https']

/**
 * The href if it is safe to put in an anchor, else undefined.
 *
 * A scheme-relative (`//host`) or relative value is refused too: on this page
 * the value is a WEBSITE, and a relative one would navigate inside the Admin,
 * which is not what "Website" means and is its own small surprise.
 */
export function websiteHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const href = value.trim()
  if (href === '') return undefined
  const scheme = urlScheme(href)
  if (!scheme) return undefined
  return WEBSITE_HREF_SCHEMES.includes(scheme.toLowerCase()) ? href : undefined
}
