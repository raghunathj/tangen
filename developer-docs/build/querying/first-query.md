---
title: Your first query
description: Creating a client and reading a list and a single object.
audience: site-developer
type: guide
status: stable
package: "@tangen/sdk"
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-f/northwind#tangenql
---

# Your first query

> The Delivery API serves **published** content. A draft is invisible to an API
> key however it is queried - so an empty result is far more often an unpublished
> object than a wrong filter. See [Publishing](/build/content/publishing).


## Create a client once

```ts app/lib/tangen.ts
import { createClient } from '@tangen/sdk'

export const tangen = createClient({
  apiUrl: process.env.TANGEN_API_URL!,
  apiKey: process.env.TANGEN_API_KEY!,
})
```
**Keep the key on the server.** It is not a user credential, and a browser
bundle is a public place.

## A list

```ts
const { data, meta } = await tangen
  .objects('article')
  .sort('publishedAt', 'desc')
  .limit(20)
  .get()
```
`data` is typed `Article[]` from your generated types - no generic parameter.
`meta` carries `total`, `limit`, `offset`, `cursor` and `hasMore`.

You get **published** content. Drafts need `objects: read_draft` and an
explicit `.status()`.

## One object

```ts
const article = await tangen.objects('article').find(id)
const bySlug  = await tangen.objects('article').findBySlug('launch-day')
```
`findBySlug` is what a page route usually wants, because a slug is what is in
the URL.

## Only the fields you render

```ts
const { data } = await tangen
  .objects('article')
  .props(['id', 'title', 'slug', 'publishedAt'])
  .limit(20)
  .get()
```
A list of cards does not need the body of every article.

## Verify

Ask the API the same question your code is asking, with the same key:

```bash
curl -s -X POST "$TANGEN_API_URL/api/v1/objects/article/query" \
  -H "authorization: Bearer $TANGEN_API_KEY" \
  -H 'content-type: application/json' -d '{"limit":5}'
```

If that returns rows and your code does not, the difference is in your code. If
it returns none, the usual causes are that nothing is published yet, the key
was issued on another deployment, or the key is missing an action - and a missing
action is a `403`, never a silent empty list.

## Common mistakes

- **The key in client-side code.**
- **`objects('articles')`** - the type name is what you declared, usually
  singular, and a typo is a compile error.
- **Expecting drafts.** A default read is published only.

## Related

- [TangenQL reference](/reference/tangenql) · [Filtering and sorting](/build/querying/filtering)
  · [Using the SDK](/build/querying/sdk)
