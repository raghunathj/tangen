---
title: SEO
description: One resolveUrl function drives canonical URLs, OpenGraph, a sitemap with hreflang, and a robots policy that differs by deployment role.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch14
---

# 14. SEO

**Goal** a sitemap with language alternates, canonical URLs in the page head,
and a robots policy that cannot get staging indexed.

**Prerequisites** [chapter 13](/learn/enterprise-website/production).

## The boundary

**SEO owns the metadata. Your application owns routing.** Tangen knows a
product's identity; only your site knows that a product lives at
`/products/<slug>`. So you supply exactly one function, and everything else is
derived from it: canonical URLs, OpenGraph, the sitemap, hreflang alternates.

Never store a canonical URL on the object. It goes stale the moment a slug
changes.

## Install and configure

```bash
bun x tangen extension install seo
```

Configuration is the extension's **options**, in
`app/config/extensions.ts`:

```ts app/config/extensions.ts
export default defineExtensions([
  {
    resolve: '@tangen/ext-seo',
    options: {
      siteUrl: process.env.SITE_URL ?? 'http://localhost:4321',
      locales: ['en', 'fr', 'de'],
      sitemapTypes: ['product', 'solution', 'article', 'caseStudy'],
      resolveUrl: ({ type, slug, locale }: { type: string; slug?: string | null; locale?: string | null }) => {
        if (!slug) return null
        const base = process.env.SITE_URL ?? 'http://localhost:4321'
        const prefix = locale && locale !== 'en' ? `/${locale}` : ''
        const path = {
          product: `/products/${slug}`,
          solution: `/solutions/${slug}`,
          article: `/resources/articles/${slug}`,
          caseStudy: `/resources/case-studies/${slug}`,
        }[type]
        return path ? `${base}${prefix}${path}` : null
      },
      // `userAgents` is a LIST. A group written with singular `userAgent` is
      // dropped silently, and you get a robots.txt with no rules in it.
      robotsTxt: {
        groups: [{ userAgents: ['*'], allow: ['/'], disallow: ['/api/'] }],
        sitemaps: [`${process.env.SITE_URL ?? 'http://localhost:4321'}/sitemap.xml`],
      },
    },
  },
  { resolve: '@tangen/ext-flows' },
])
```

### Why `page` is not in `sitemapTypes`

`resolveUrl` receives `{ type, id, slug, locale }`. It does not receive the
object's fields. Northwind's `page` type routes by an authored `path`, not by
its slug, so this function cannot resolve one. The four slug-routed types go in
the sitemap here, and pages are served by the site's own sitemap route.

Worth knowing when you design your model: a type whose routing is derivable from
its slug is a type SEO can resolve on its own.

## The page head

The metadata route is public and gives you resolved values:

```ts web/server.ts
async function seoMeta(type: string, id: string, locale: string) {
  const base = process.env.TANGEN_API_URL ?? 'http://localhost:3000'
  try {
    const r = await fetch(`${base}/api/v1/ext/seo/meta?type=${type}&id=${id}&locale=${locale}`)
    if (!r.ok) return null
    return ((await r.json()) as any).data ?? null
  } catch { return null }
}
```

Render what it returns rather than composing tags yourself, so one routing
change moves the canonical URL, the OpenGraph URL and the sitemap together:

```html
<link rel="canonical" href="http://localhost:4321/fr/products/gridlock">
<meta name="robots" content="index, follow">
<meta property="og:title" content="Gridlock">
<meta property="og:url" content="http://localhost:4321/fr/products/gridlock">
```

## The sitemap

```bash
curl 'http://localhost:3000/api/v1/ext/seo/sitemap.xml'
```

```xml
<url>
  <loc>http://localhost:4321/products/gridlock</loc>
  <lastmod>2026-09-02T06:15:36.337Z</lastmod>
  <xhtml:link rel="alternate" hreflang="en" href="http://localhost:4321/products/gridlock"/>
  <xhtml:link rel="alternate" hreflang="fr" href="http://localhost:4321/fr/products/gridlock"/>
  <xhtml:link rel="alternate" hreflang="de" href="http://localhost:4321/de/products/gridlock"/>
</url>
```

The alternates come from the same `resolveUrl`, called once per locale. You did
not write hreflang logic.

Tangen supplies the contents; **your framework serves `/sitemap.xml`**. Proxy the
route above from your site.

## robots.txt differs by deployment role

This is the safety feature, and it works because deployments have roles:

```text
development                     production
User-agent: *                   User-agent: *
Disallow: /                     Allow: /
                                Disallow: /api/
                                Sitemap: …/sitemap.xml
```

Non-production disallows everything by default, so a staging site is never
indexed by accident. You do not opt in to that protection; you opt out by
giving production a real policy.

## Verification

- the sitemap lists your slug-routed content with three hreflang alternates each
- a product page carries a canonical matching its locale
- `robots.txt` is `Disallow: /` in development and your policy in production

## Common mistake

**Writing `userAgent` instead of `userAgents`.** The group is dropped without an
error and you ship a robots.txt with no rules.

## Relevant canonical docs

- [SEO](/extensions/seo) - the full extension, redirects, structured data
- [Deployments](/build/deployments) - what a role changes
- [Localization](/build/localization) - where the alternates come from
