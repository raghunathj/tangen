---
title: Query with TangenQL and the SDK
description: A delivery key, and the six queries this site actually needs.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch7
---

# 7. Query with TangenQL and the SDK

**Goal** a scoped API key, and every query the frontend needs, executing.

**Prerequisites** [chapter 6](/learn/enterprise-website/seed-and-publish).

## Make a delivery key

In the Admin: **Settings → API keys → New**. Label it `Northwind website`, and
grant read on **objects**, **globals**, **media** and **forms**. The key is
shown once.

Scope it to what the site reads and nothing more. A website never writes, and a
key that can write is a key that can be made to write.

Creating one through the API instead, the permission shape is a map of scopes to
actions, not a list:

```bash
curl -X POST 'http://localhost:3000/api/v1/api-keys' \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"label":"Northwind website",
       "permissions":{"objects":{"actions":["read"]},"globals":{"actions":["read"]},
                      "media":{"actions":["read"]},"forms":{"actions":["read"]}}}'
```

`{"objects":["read"]}` is refused with a 422 naming every scope that got it
wrong. The key comes back once, on `data.key`.

Your server process then needs two variables:

```bash
TANGEN_API_URL=http://localhost:3000     # the Tangen API, not the admin
TANGEN_API_KEY=tgn_…                     # the key above
```

**This key is a server credential.** It goes in the environment of your server
process. A key in a browser bundle is a public key.

```bash
bun add @tangen/sdk
bun add -d @types/bun
```

`@types/bun` is what makes `Bun.file` and `import.meta.dir` typecheck in the
scripts and the server. Add `"bun"` to `types` in `tsconfig.json`, and add
`web` and `scripts` to `include` - the scaffold covers `app` only, so without
this the site's own code is never typechecked.

```ts web/server.ts
import { createClient } from '@tangen/sdk'

const tangen = createClient({
  apiUrl: process.env.TANGEN_API_URL ?? 'http://localhost:3000',
  apiKey: process.env.TANGEN_API_KEY!,
})
```

## The six queries

**A page by its path.** The commonest query a website makes:

```ts
const { data } = await tangen.objects('page')
  .where({ path: { eq: '/company/about' } })
  .limit(1)
  .get()
```

**A list, sorted, with only the fields the card needs:**

```ts
const { data } = await tangen.objects('product')
  .props(['id', 'title', 'slug', 'tagline'])
  .sort('order', 'asc')
  .get()
```

`props` is worth using on list pages. It is the difference between shipping a
card and shipping every block body on the page.

**A relation, expanded:**

```ts
const { data } = await tangen.objects('article')
  .depth(1)                       // author and categories become records
  .sort('publishedAt', 'desc')
  .limit(10)
  .get()

data[0].author.title              // 'Ava Owen'
```

**One thing by slug:**

```ts
const [item] = (await tangen.objects('product')
  .where({ slug: { eq: 'gridlock' } })
  .limit(1)
  .get()).data
```

**A Global.** Note the extra unwrap: values sit at `data.values`, unlike
objects, which return rows at `data`:

```ts
const settings = (await tangen.globals('site-settings').get()).data.values
settings.siteName          // 'Northwind Systems'
```

Wrap it once and stop thinking about it:

```ts
const global = async (name: string) => (await tangen.globals(name).get()).data.values
```

**A miss.** An unmatched query is an empty array and a `200`, not an error. Your
route decides what a miss means, which for a website is a 404.

## Expected result

Every query above returns data. The article query's `author` is an object with
a `title`, not an id string.

## Verification

- a page query by `path` returns exactly one row
- `depth(1)` expands `author` into a record
- `tangen.globals('site-settings')` returns your seeded values
- an unknown slug returns `{ data: [] }` with status `200`

## Common mistake

**Writing the wire body by hand and putting the filter at the top level.** The
filter goes under `query`. A stray top-level key used to be dropped silently;
it is refused now, and the message names `query`.

## Relevant canonical docs

- [TangenQL reference](/reference/tangenql) - every operator, boolean groups,
  pagination, depth, and what it refuses
- [SDK reference](/reference/sdk) - the client, cancellation, retries
- [Globals](/build/globals) · [Permissions](/reference/permissions) - key scopes
