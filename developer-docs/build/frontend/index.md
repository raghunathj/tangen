---
title: Frontend integration
description: Connecting a frontend to Tangen - fetching, routing, rendering, caching and errors.
audience: site-developer
type: guide
status: stable
package: "@tangen/sdk"
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-f/northwind#frontend
---

# Frontend integration

Tangen is headless and framework-neutral. It serves content over HTTP; your
application owns everything about how that content becomes pages.

## The division

| Tangen owns | your application owns |
|---|---|
| the content model and its data | routes and URL shapes |
| publication state | which URL a piece of content lives at |
| media storage and delivery | rendering, layout, components |
| link **identity** | resolving a link to an href |
| localized **content** | locale routing (`/fr/…`, a subdomain, a header) |
| SEO **data** | emitting `<meta>` and `<link>` tags |

If you find yourself asking "what URL does Tangen give this page?", the answer
is that it does not. You do.

## Fetch on the server

```ts app/lib/tangen.ts
import { createClient } from '@tangen/sdk'

export const tangen = createClient({
  apiUrl: process.env.TANGEN_API_URL!,
  apiKey: process.env.TANGEN_API_KEY!,
})
```

The API key must stay server-side. Fetch in a server component, a loader, or a
route handler, and pass data to the browser.

Client-side fetching is possible but needs a key the browser can hold - which
means a key scoped to published reads only, and even then you are publishing a
credential. Prefer the server.

## Routing

Look content up by the thing that is in the URL:

```ts
const article = await tangen.objects('article').findBySlug(slug)
if (!article) return notFound()
```

For a static build, list the slugs first:

```ts
const { data } = await tangen.objects('article').props(['slug']).total(false).limit(500).get()
const paths = data.map((a) => ({ slug: a.slug }))
```

## Rendering links

Never store or render a URL Tangen gave you for internal content - it does not
give you one. Resolve identity with your own router:

```ts
import { isInternalLink, isExternalLink, isLinkResolved, linkSuffix } from '@tangen/sdk'
```

See [Links and navigation](/build/content-modeling/links).

## Caching

Tangen caches server-side; your frontend caches too, and the two are
independent.

- **Published content** is safe to cache. Choose a TTL, or revalidate on a
  webhook.
- **Preview** is `no-store`. Never cache it.
- **Globals** are read on nearly every render - cache them for at least the
  life of a request.
- **Localized content** varies by locale: the locale must be in your cache key.

## Errors and not-found

```ts
import { TangenError } from '@tangen/sdk'

try {
  const article = await tangen.objects('article').findBySlug(slug)
  if (!article) return notFound()
  return render(article)
} catch (e) {
  if (e instanceof TangenError && e.code === 'NOT_FOUND') return notFound()
  throw e   // a real failure should be a 500, not a blank page
}
```

Distinguish "no such content" from "the CMS is unreachable". The first is a
404; the second is your problem and should page someone.

## Metadata

Read your SEO fields and emit the tags yourself. Tangen holds the data; the
`<head>` is your framework's.

## A framework example

The following is **an example, not a contract** - Tangen does not require
Next.js, and every other framework does the equivalent.

```tsx app/[slug]/page.tsx
import { tangen } from '@/lib/tangen'
import { notFound } from 'next/navigation'

export async function generateStaticParams() {
  const { data } = await tangen.objects('page').props(['slug']).total(false).limit(500).get()
  return data.map((p) => ({ slug: p.slug! }))
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const page = await tangen.objects('page').findBySlug(params.slug)
  return page ? { title: page.title, description: page.seo?.metaDescription } : {}
}

export default async function Page({ params }: { params: { slug: string } }) {
  const page = await tangen.objects('page').findBySlug(params.slug)
  if (!page) notFound()
  return <article>{/* … */}</article>
}
```

`@tangen/nextjs` and `@tangen/astro` exist as opt-in helpers. Both are
**experimental** - see [Public contract](/reference/public-contract).

## What has actually been proven

Being framework-neutral is a claim about the API, not evidence about a
framework. This is what has been built and run end to end, and what has not:

| integration | status |
|---|---|
| a plain HTTP server (`Bun.serve`) reading through `@tangen/sdk` | **PROVEN** - the whole [Enterprise Website](/learn/enterprise-website), 13 routes, three locales, media, forms |
| any framework that can call `fetch` on a server | **GENERICALLY COMPATIBLE** - the SDK is ordinary async code with no runtime assumptions beyond `fetch` |
| `@tangen/nextjs`, `@tangen/astro` | **UNPROVEN** - experimental helpers, not yet built end to end from their own documentation |
| client-side-only rendering | **NOT APPLICABLE** - the API key is a server credential |

The distinction that matters: the **Tangen contract** is the SDK call and the
shape it returns. The **framework integration** is where you put that call.
Everything in the Enterprise Website moves to another framework by changing the
second and none of the first.

## Related

- [Using the SDK](/build/querying/sdk) · [Preview](/build/content/preview) ·
  [Media](/build/media) · [Localization](/build/localization) ·
  [Performance](/build/performance)
