---
title: Build dynamic frontend routes
description: Thirteen routes driven by CMS slugs, a block renderer, and media on the page.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch8
---

# 8. Build dynamic frontend routes

**Goal** the site rendering: every route from CMS data, blocks rendered,
images and files served.

**Prerequisites** [chapter 7](/learn/enterprise-website/querying).

## What we are building

```text
/                                     the home page, from blocks
/products  /products/<slug>
/solutions /solutions/<slug>
/resources /resources/articles /resources/articles/<slug>
           /resources/case-studies /resources/case-studies/<slug>
           /resources/downloads
/company/<slug>  /legal/<slug>        pages, matched by their authored path
```

## Framework

This tutorial uses a plain `Bun.serve` HTTP server. That is deliberate: it keeps
the Tangen part visible instead of buried in a framework's conventions.
Everything here is ordinary `fetch` and string templates, and the data layer
moves to Next, Astro or anything else unchanged.

The one line worth copying exactly:

```ts web/server.ts
const server = Bun.serve({
  // WEB_PORT, not PORT: Bun auto-loads the project's .env, where PORT is the
  // TANGEN API's port. A frontend reading PORT here binds 3000 and collides
  // with the API it is trying to read from.
  port: Number(process.env.WEB_PORT ?? 4321),
  async fetch(req) { /* … */ },
})
```

## Rendering blocks

One function, switching on `_type`. An unknown block renders nothing rather
than crashing, so adding a component in the admin never takes the site down
before the frontend knows about it:

```ts web/server.ts
function block(b: any): string {
  switch (b?._type) {
    case 'hero':
      return `<section class="hero"><h1>${esc(b.heading)}</h1>${b.subheading ? `<p class="lede">${esc(b.subheading)}</p>` : ''}
        ${img(b.image, 1200, 'hero-image')}
    case 'richText':
      return `<section class="prose">${b.body ?? ''}</section>`
    // …
    default:
      return ''
  }
}
```

## Rendering media

`transformUrl` is a method on the client's `media` accessor. It only builds a
URL, and transforms serve **without a key**, which is why a browser can load one
directly:

```ts web/server.ts
function img(asset: any, w: number, cls = ''): string {
  // A media field on a CONTENT OBJECT expands to the asset under depth(1). The
  // same field on a GLOBAL comes back as the bare id string. Accept both.
  const id = typeof asset === 'string' ? asset : asset?.id
  if (!id) return ''
  const meta = typeof asset === 'string' ? {} : asset
  const src = tangen.media.transformUrl(id, { width: w, format: 'webp' })
  return `<img${cls ? ` class="${cls}"` : ''} src="${esc(src)}" alt="${esc(meta.altText ?? '')}"${
    meta.width ? ` width="${meta.width}" height="${meta.height}"` : ''} loading="lazy">`
}
```

The alt text is `altText`, not `alt`. For a PDF use `tangen.media.fileUrl(id)`:
a transform of a PDF is a mistake.

## Rendering navigation

The menu is a Global, so the header is data:

```ts
const nav = await global('navigation')
const menu = (nav.primary ?? []).map((i: any) =>
  `<li><a href="${href(i.href)}">${esc(i.label)}</a>${
    i.children?.length
      ? `<ul>${i.children.map((c: any) => `<li><a href="${href(c.href)}">${esc(c.label)}</a></li>`).join('')}</ul>`
      : ''}</li>`).join('')
```

`href()` turns a stored link into a URL. Because a link stores identity rather
than a path, this is where routing lives, in one function.

## Run it

```bash
TANGEN_API_URL=http://localhost:3000 TANGEN_API_KEY=$TANGEN_API_KEY \
  bun web/server.ts
```

## Expected result

```text
northwind web on http://localhost:4321
```

`http://localhost:4321/` shows the hero with its image, the stats band, the CTA,
a two-level menu from the Global, and the footer. `/nope` returns 404.

## Verification

- thirteen routes answer `200`, and an unknown path answers `404`
- the home page carries two images: the logo from Site settings and the hero
- `/resources/downloads` links to a PDF that downloads

## Common mistake

**Reading `PORT` in the frontend.** The project's `.env` sets it for the API.
Your site will try to bind the port the API is already on.

## Relevant canonical docs

- [Frontend integration](/build/frontend) - the patterns, framework by framework
- [Media](/build/media) - transforms, variants, rendering
- [Links and navigation](/build/content-modeling/links)
- [Structuring content](/build/content-modeling/structuring-content)
