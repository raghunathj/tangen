---
title: Add media and relationships
description: Upload real assets, reference them from content, and relate types to each other.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch5
---

# 5. Add media and relationships

**Goal** files uploaded through the API and referenced from content, and types
that point at each other.

**Prerequisites** [chapter 4](/learn/enterprise-website/globals-and-navigation).

## What we are building

Northwind's relations are all editorial facts, not demonstrations:

```text
solution  → products      a solution is sold THROUGH products
article   → person        an author, so a name changes in one place
article   → category      taxonomy
caseStudy → product       which product the story is about
```

And its media: a logo in Site settings, a hero image on the home page and on an
article, two author photos, one PDF.

## Relations, in the model

You already wrote these in chapter 2. This is what they mean:

```ts
// A solution is sold through products, so the relation is the point of the type.
products: field.relation({ label: 'Products', config: { targetType: 'product', many: true } }),

// Authorship is a relation, not a string.
author: field.relation({ label: 'Author', config: { targetType: 'person' } }),
```

A relation stores an id. It becomes the full record when you ask for it with
`.depth(1)`, which chapter 7 does.

## Uploading

Media is **multipart**, so it is one of the few things that does not go through
the SDK. Note the response envelope: `{ asset }`, not the `{ data }` every
content route returns.

```ts scripts/seed.ts
async function upload(file: string): Promise<string> {
  const body = new FormData()
  body.append('file', new File([await Bun.file(`${import.meta.dir}/../assets/${file}`).arrayBuffer()], file))
  const res = await fetch(`${API}/media/upload`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body,
  })
  const json: any = await res.json().catch(() => null)
  const id = json.asset.id as string
  return id
}
```

Then reference the returned id from any media field:

```ts
await create('person', { role: 'Principal Engineer', avatar: await upload('ava-owen.png') },
  'Ava Owen', 'ava-owen')
```

## Two shapes, one field

This is worth knowing before chapter 8 renders anything:

- a media field on a **content object** expands to the full asset under
  `.depth(1)`
- the same field on a **Global** comes back as the **bare id string**, because
  Globals have no depth

Both are enough to build an image URL, since a transform only needs the id.

## Expected result

```bash
curl -s "$API/media?limit=1" -H "authorization: Bearer $TOKEN"
```

returns assets with `id`, `originalName`, `mimeType`, `width`, `height` and
`altText`. The Admin's Media section shows them.

## Verification

- five assets exist: three PNGs, one PDF, one logo
- a `download` object has a `file` that expands under `.depth(1)`
- the Admin's Media library lists them

## Common mistake

**Expecting `tangen.media.upload()`.** Uploading is REST and multipart. Reading
and URL building are on the SDK's `media` accessor.

## Relevant canonical docs

- [Media](/build/media) - upload, transforms, variants, rendering
- [Relations](/build/content-modeling/relations) - many, depth, and back-references
- [Fields reference](/reference/fields)
