---
title: Media
description: Uploading, reading and rendering media, and what transforms are available.
audience: site-developer
type: guide
status: stable
package: "@tangen/sdk"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch5+ch8
---

# Media

Media is a library of assets. A `media` field on a content type points at one.

```ts
heroImage: field.media({
  label: 'Hero image',
  config: { mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
}),
```

## Reading

Media is **always resolved**. It expands at every depth, including `depth(0)`,
so an article's `heroImage` is an object with a URL without you asking:

```ts
const article = await tangen.objects('article').findBySlug(slug)
// article.heroImage → { id, url, alt, width, height, mimeType, … }
```

`props` is the opt-out: a projection that omits the field returns no media.

```ts
const assets = await tangen.media.list({ limit: 20 })
```

`tangen.media` is **read-only by design**: list, read, and build asset URLs.

## Uploading

Uploading is a REST call, not an SDK method. It needs `media: write`:

```ts
const body = new FormData()
body.append('file', file)

await fetch(`${process.env.TANGEN_API_URL}/api/v1/media/upload`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.TANGEN_API_KEY}` },
  body,
})
```

Most media arrives through the Admin. Upload from code when your application
ingests files - a user avatar, an import.

## Transforms

```http
GET /api/v1/media/transform?id=<id>&w=800&format=webp&quality=70
```

| parameter | does |
|---|---|
| `w`, `h` | target width and height |
| `fit`, `position` | how the image fills the box |
| `format` | `webp`, `avif`, and the rest |
| `quality` | encoder quality |
| `blur` | blur radius |
| `variant` | a named variant declared on the field or workspace |

Transforms serve **without a key** so a browser can load them directly, and
they are cached immutably.

Named variants are usually better than ad-hoc parameters: declare them once on
the field and every consumer gets the same rendition.

```ts
heroImage: field.media({
  label: 'Hero image',
  config: {
    variants: [
      { name: 'hero', width: 1600, format: 'avif', quality: 60 },
      { name: 'card', width: 640, format: 'webp', quality: 70 },
    ],
  },
}),
```

**Transforms are images.** A PDF or a video is served as it was uploaded.

## Rendering

`transformUrl` is a method on the client's `media` accessor, not a free
import - alongside `list`, `get` and `fileUrl`. It builds a URL and issues no
request. Its options are `width`, `height`, `format`, `quality` and `fit`,
which it serializes to the `w` and `h` the route reads:

```tsx
<img
  src={tangen.media.transformUrl(article.heroImage.id, { width: 1200, format: 'webp' })}
  alt={article.heroImage.altText ?? ''}
  width={article.heroImage.width}
  height={article.heroImage.height}
/>
```

The alt text is **`altText`** on the asset, not `alt`. Always render it, and
always render intrinsic `width` and `height` - they are on the asset too, and
omitting them causes layout shift.

Use `tangen.media.fileUrl(id)` for anything that is not an image: a transform
of a PDF is a mistake, and the file URL serves the bytes as uploaded.

## Localization

Media localizes at the **asset** level: a field can hold a different rendition
per locale without `localized: true`. Alt text follows the asset.

## Storage

Where bytes live is `config/storage.ts` - local disk or S3-compatible. Changing
the adapter does **not** move existing files, and delivery always goes through
the current adapter, so assets uploaded before a switch 404 until you copy
them.

## Common mistakes

- **Expecting `tangen.media.upload()`.** Uploading is REST.
- **Importing `transformUrl` from `@tangen/sdk`.** It is `tangen.media.transformUrl`.
- **Reading `.alt`.** The asset carries `altText`.
- **Requesting a transform of a PDF.**
- **Omitting `alt`.**
- **Switching storage adapters and not copying the files.**

## Related

- [Fields reference](/reference/fields) · [SDK reference](/reference/sdk) ·
  [Delivery API](/reference/delivery-api) · [Performance](/build/performance)
