---
title: SEO
description: "Sitemaps, canonical URLs, OpenGraph metadata and a robots policy per deployment role: what Tangen holds for SEO, what your application owns, and how the bundled SEO extension is installed and configured."
audience: site-developer
type: concept
status: experimental
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch14
---

# SEO

> SEO is an extension. Before the steps below work it must be **declared,
> installed and enabled** on the deployment you are working on - three separate
> actions. See [Extensions](/extensions).


> **Availability.** Tangen's SEO capability ships as a first-party extension
> that is **not currently published as an npm package**, so an external project
> has no supported way to install it. This page documents the model and the
> boundary; it does not tell you to install something you cannot. See
> [what is not installable](#what-is-not-available-yet).

## The division

**Tangen owns SEO data and artifacts. Your application owns routing.**

| Tangen | your application |
|---|---|
| the metadata an editor writes per object | which URL that object lives at |
| defaults, and how a page inherits them | emitting `<title>`, `<meta>`, `<link rel="canonical">` |
| the sitemap's contents | serving `/sitemap.xml` |
| robots policy per deployment role | serving `/robots.txt` |
| the redirect table | performing the redirect |

Tangen never learns your routes. It asks **you** for them, once, through a URL
resolver you supply - and if your resolver returns nothing for an object, that
object is **omitted** from the sitemap and left without a canonical, rather
than given a guessed address.

## What you can do today without the extension

Everything here is core, works in any project, and is what most sites need:

**Model your own SEO fields.**

```ts app/content-objects/article/schema.ts
seo: field.group({
  label: 'SEO',
  fields: {
    metaTitle: field.text({ label: 'Meta title', localized: true }),
    metaDescription: field.textarea({ label: 'Meta description', localized: true }),
    socialImage: field.media({ label: 'Social image' }),
    noindex: field.boolean({ label: 'Hide from search engines' }),
  },
}),
```
**Hold defaults in a global.**

```ts app/globals/index.ts
{
  name: 'seo_defaults',
  label: 'SEO defaults',
  fields: {
    titleTemplate: field.text({ label: 'Title template', localized: true }),
    description: field.textarea({ label: 'Default description', localized: true }),
    socialImage: field.media({ label: 'Default social image' }),
  },
}
```
**Emit the tags yourself**, falling back to the defaults:

```ts
const [page, defaults] = await Promise.all([
  tangen.objects('page').findBySlug(slug),
  tangen.globals('seo_defaults').get(),
])

const title = page?.seo?.metaTitle ?? page?.title
const description = page?.seo?.metaDescription ?? defaults.description
```
**Build a sitemap** from a query:

```ts
const { data } = await tangen.objects('page')
  .props(['slug', 'updatedAt'])
  .total(false)
  .limit(1000)
  .get()
// map to your own URLs, and serve as XML from your framework
```
**Model redirects as content** if you need editor-managed ones: a small type
with `from`, `to` and `permanent`, read by your middleware.

This is more work than the extension, and it is entirely supported.

## The SEO extension

SEO ships with the platform. A scaffolded project already declares it in
`app/config/extensions.ts`:

```ts
import { defineExtensions } from '@tangen/cms'

export default defineExtensions([
  { resolve: '@tangen/ext-seo' },
])
```
You never install it yourself. There is no `add` command for it, and there is
not meant to be one - it arrives with the platform or not at all.

Declaring it makes it available. Turning it on is per deployment and lives in
its database, like every other extension:

```sh
tangen extension install seo
tangen extension list
```
Once enabled it adds resolved metadata, canonical URLs, a robots policy that
differs by deployment role, a generated sitemap and sitemap index, a redirect
manager in the Admin, and structured data - all driven by the one `resolveUrl`
function you supply. Its public routes mount under `/api/v1/ext/seo/`,
including `robots.txt` and `sitemap.xml`.

## Supplying `resolveUrl`

It goes in the extension's **options**, in `app/config/extensions.ts`. That is
also where every other SEO helper lives:

```ts app/config/extensions.ts
export default defineExtensions([
  {
    resolve: '@tangen/ext-seo',
    options: {
      siteUrl: 'https://example.com',
      locales: ['en', 'fr', 'de'],
      sitemapTypes: ['product', 'article'],
      resolveUrl: ({ type, slug, locale }) => {
        if (!slug) return null
        const prefix = locale && locale !== 'en' ? `/${locale}` : ''
        const path = { product: `/products/${slug}`, article: `/blog/${slug}` }[type]
        return path ? `https://example.com${prefix}${path}` : null
      },
      robotsTxt: {
        groups: [{ userAgents: ['*'], allow: ['/'] }],
        sitemaps: ['https://example.com/sitemap.xml'],
      },
    },
  },
])
```

| option | is |
|---|---|
| `siteUrl` | the site's origin |
| `resolveUrl` | how this application builds a URL for one object |
| `resolveMediaUrl` | how it builds an absolute media URL |
| `locales` | locales offered as sitemap alternates |
| `sitemapTypes` | content types eligible for the sitemap; absent means all |
| `fallback` | last-resort title and description |
| `structuredData` | site-wide JSON-LD |
| `robotsTxt` | the policy on a **production** deployment |
| `nonProductionRobotsTxt` | everywhere else; absent means disallow everything |

`robotsTxt` groups take **`userAgents`, a list**. A group written with the
singular `userAgent` is dropped without an error, and you ship a robots.txt with
no rules in it.

### What `resolveUrl` receives

`{ workspaceId, type, id, slug, locale }` - **not the object's fields**.
A content type routed by anything other than its slug cannot be resolved here,
so either derive that type's route from its slug or leave it out of
`sitemapTypes` and serve it from your own sitemap route.
## Common mistakes

- **Storing a canonical URL on the object.** It goes stale the moment a slug
  changes. Derive it from the route.
- **Expecting Tangen to serve `/sitemap.xml`.** Your framework serves it;
  Tangen supplies the contents.
- **Letting staging get indexed.** Your robots policy must differ by
  deployment role, whichever way you produce it.

## Related

- [Globals](/build/globals) · [Frontend integration](/build/frontend) ·
  [Links and navigation](/build/content-modeling/links) ·
  [Public contract](/reference/public-contract)
