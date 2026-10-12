/**
 * File Name: robots.ts
 * Purpose: Two things that share a name (closure plan Phase 9A, Units 5 and
 *          6): the directives ONE page gives a crawler, and the robots.txt a
 *          SITE gives every crawler. Both pure and both deterministic.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Typed directives rather than a free-text field, so
 *          "noindex, index" cannot be written and serialization has exactly
 *          one output per input. Only index and follow: the other directives
 *          (max-snippet, max-image-preview, ...) have no v1 consumer, and
 *          Phase 9A forbids fields that exist only because a tool exposes one.
 */
import type { DeploymentRoleLike } from './deployment-role'
import type { RobotsTxtDocument, SeoRobots, SeoHelpers } from '../contract'

/** Both tokens, always, in this order. */
export function robotsContent(robots: SeoRobots): string {
  return `${robots.index ? 'index' : 'noindex'}, ${robots.follow ? 'follow' : 'nofollow'}`
}

/**
 * What a page actually tells a crawler.
 *
 * Publication is authoritative: content that is not published is `noindex,
 * nofollow` whatever the editor set, so a draft can never be made indexable
 * by a metadata edit alone.
 */
export function effectiveRobots(stored: SeoRobots | null | undefined, ctx: { published: boolean }): SeoRobots & { content: string } {
  const robots: SeoRobots = ctx.published
    ? { index: stored?.index ?? true, follow: stored?.follow ?? true }
    : { index: false, follow: false }
  return { ...robots, content: robotsContent(robots) }
}

/** The document a site gets when it has not earned the right to be crawled. */
export const DISALLOW_ALL: RobotsTxtDocument = { groups: [{ userAgents: ['*'], disallow: ['/'] }] }

/** What production gets when the site declared nothing. */
const ALLOW_ALL: RobotsTxtDocument = { groups: [{ userAgents: ['*'], allow: ['/'] }] }

/**
 * The robots.txt for an environment, chosen by its ROLE.
 *
 * Phase 5A settled that production is a role, never a label or a slug. An
 * environment whose role is unknown - unadopted, or a database from before
 * the role column - is treated as NON-production here. That is the opposite
 * of Phase 1's destructive-operation default and deliberately so: there the
 * cautious answer is "assume production and refuse", here it is "assume this
 * is not the live site and keep it out of the index".
 */
export function robotsTxtFor(role: DeploymentRoleLike, helpers: Pick<SeoHelpers, 'robotsTxt' | 'nonProductionRobotsTxt'>): RobotsTxtDocument {
  if (role === 'production') return helpers.robotsTxt ?? ALLOW_ALL
  return helpers.nonProductionRobotsTxt ?? DISALLOW_ALL
}

/** One line's worth of text, with anything that could forge a directive removed. */
const line = (v: unknown): string => String(v ?? '').replace(/[\r\n]+/g, ' ').trim()

/** robots.txt is a line format, so this is a line writer - nothing more. */
export function serializeRobotsTxt(doc: RobotsTxtDocument): string {
  const out: string[] = []
  for (const group of doc.groups ?? []) {
    const agents = (group.userAgents ?? []).map(line).filter(Boolean)
    if (agents.length === 0) continue
    for (const agent of agents) out.push(`User-agent: ${agent}`)
    for (const path of group.allow ?? []) { const p = line(path); if (p) out.push(`Allow: ${p}`) }
    for (const path of group.disallow ?? []) { const p = line(path); if (p) out.push(`Disallow: ${p}`) }
    out.push('')
  }
  for (const sitemap of doc.sitemaps ?? []) { const s = line(sitemap); if (s) out.push(`Sitemap: ${s}`) }
  for (const extra of doc.custom ?? []) { const c = line(extra); if (c) out.push(c) }
  return out.length ? `${out.join('\n')}\n` : ''
}
