/**
 * File Name: schemas.ts
 * Purpose: JSON-LD builders (plan-seo-next Phase 2). Pure functions that turn
 *          settings and content into schema.org nodes. This file starts with
 *          the SITE-level entity graph (Organization + WebSite) that every page
 *          carries - the same nodes that answer an AI engine's "who is this"
 *          (GEO). Per-content-type builders (Article, Product, FAQPage, ...)
 *          layer on top in a later slice. Structure only: an empty input never
 *          emits a node, and absent optionals are omitted rather than blanked.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { JsonLdNode } from '../contract'
import type { SeoSettings } from './settings'
import type { SchemaKind } from './schema-map'

const clean = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}

/** The Organization entity: null unless there is at least a name to assert. */
export function buildOrganization(input: { name?: string; url?: string; logoUrl?: string; sameAs?: string[] }): JsonLdNode | null {
  const name = clean(input.name)
  if (!name) return null
  const node: JsonLdNode = { '@type': 'Organization', name }
  const url = clean(input.url); if (url) node.url = url
  const logo = clean(input.logoUrl); if (logo) node.logo = logo
  const sameAs = (input.sameAs ?? []).map(clean).filter((s): s is string => !!s)
  if (sameAs.length) node.sameAs = sameAs
  return node
}

/** The WebSite entity: null without a url (the one thing it exists to state). */
export function buildWebSite(input: { name?: string; url?: string }): JsonLdNode | null {
  const url = clean(input.url)
  if (!url) return null
  const node: JsonLdNode = { '@type': 'WebSite', url }
  const name = clean(input.name); if (name) node.name = name
  // Put name before url to read naturally, matching the test's object shape.
  return name ? { '@type': 'WebSite', name, url } : node
}

/**
 * The site-level nodes derived from settings, carried on every page: the
 * organization identity and the website. `siteUrl` and `logoUrl` are resolved
 * by the caller (the app owns URLs); absent ones simply drop their node/field.
 */
export function buildSiteSchema(settings: SeoSettings, resolved: { siteUrl?: string; logoUrl?: string }): JsonLdNode[] {
  const out: JsonLdNode[] = []
  const org = buildOrganization({
    name: settings.organization.name,
    url: resolved.siteUrl,
    logoUrl: resolved.logoUrl,
    sameAs: settings.organization.sameAs,
  })
  if (org) out.push(org)
  const site = buildWebSite({ name: settings.general.siteName, url: resolved.siteUrl })
  if (site) out.push(site)
  return out
}

const HEADLINE_KINDS = new Set<SchemaKind>(['Article', 'BlogPosting'])

/**
 * One content object -> its per-type JSON-LD node, from a type's schema config.
 * The label (headline for Article/BlogPosting, name for the rest) falls back to
 * the resolved page title; description falls back to the resolved description;
 * everything else is read from the mapped content field. Null when the kind is
 * `none` or there is not even a label to assert. The app owns the page url.
 */
export function buildTypeSchema(
  config: { kind: SchemaKind | 'none'; fieldMap: Record<string, string> },
  ctx: { object: Record<string, unknown>; title?: string; description?: string; url?: string; organizationName?: string },
): JsonLdNode | null {
  if (config.kind === 'none') return null
  const get = (prop: string): string | undefined => {
    const field = config.fieldMap[prop]
    return field ? clean(ctx.object[field]) : undefined
  }
  const isHeadline = HEADLINE_KINDS.has(config.kind)
  const labelKey = isHeadline ? 'headline' : 'name'
  const label = get(labelKey) ?? clean(ctx.title)
  if (!label) return null

  const node: JsonLdNode = { '@type': config.kind }
  node[labelKey] = label
  const description = get('description') ?? clean(ctx.description); if (description) node.description = description
  const image = get('image'); if (image) node.image = image

  if (isHeadline) {
    const datePublished = get('datePublished'); if (datePublished) node.datePublished = datePublished
    const dateModified = get('dateModified'); if (dateModified) node.dateModified = dateModified
    const author = get('author'); if (author) node.author = { '@type': 'Person', name: author }
    const publisher = clean(ctx.organizationName); if (publisher) node.publisher = { '@type': 'Organization', name: publisher }
  }
  if (config.kind === 'Product') {
    const sku = get('sku'); if (sku) node.sku = sku
    const brand = get('brand'); if (brand) node.brand = { '@type': 'Brand', name: brand }
  }
  const url = clean(ctx.url); if (url) node.url = url
  return node
}

/** A FAQPage node from Q/A pairs, or null when there is no complete pair. */
export function buildFaqSchema(pairs: { question?: string; answer?: string }[]): JsonLdNode | null {
  const entities = (pairs ?? [])
    .map((p) => ({ q: clean(p.question), a: clean(p.answer) }))
    .filter((p) => p.q && p.a)
    .map((p) => ({ '@type': 'Question', name: p.q, acceptedAnswer: { '@type': 'Answer', text: p.a } }))
  return entities.length ? { '@type': 'FAQPage', mainEntity: entities } : null
}
