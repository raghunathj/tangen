---
title: Pagination
description: Offset paging, cursors, and when to skip the count.
audience: site-developer
type: guide
status: stable
package: "@tangen/sdk"
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-g4/tangenql
---

# Pagination

```ts
const { data, meta } = await tangen.objects('article').limit(20).offset(40).get()
```

`meta` carries `total`, `limit`, `offset`, `cursor` and `hasMore`.

## Offset, for page numbers

Right when the reader picks a page and expects "Page 3 of 12".

```ts
const page = 3, perPage = 20
const { data, meta } = await tangen
  .objects('article')
  .sort('publishedAt', 'desc')
  .limit(perPage)
  .offset((page - 1) * perPage)
  .get()

const totalPages = Math.ceil((meta.total ?? 0) / perPage)
```

Offset gets slower as it grows: the database still walks the rows it skips.

## Cursors, for feeds

Right for infinite scroll, a "load more" button, or walking everything.

```ts
let cursor: string | undefined
do {
  const { data, meta } = await tangen
    .objects('article')
    .sort('publishedAt', 'desc')
    .limit(100)
    .after(cursor)
    .get()

  process(data)
  cursor = meta.hasMore ? meta.cursor : undefined
} while (cursor)
```

A cursor walks the same order as your sort and does not degrade with depth.
**Do not mix a cursor with `offset`** - that is refused.

## Skip the count

```ts
.total(false)
```

The count is a second query over the whole table. On a large type it can cost
more than the page itself.

`total` comes back `null`, and **`hasMore` is still exact** - it is not an
estimate. Use this whenever your UI shows "load more" rather than a page count.

## Rule of thumb

| your UI | use |
|---|---|
| page numbers | `offset`, with `total` |
| load more, infinite scroll | `after`, with `total: false` |
| exporting everything | `after`, with `total: false` |

## Related

- [TangenQL reference](/reference/tangenql) · [Performance](/build/performance)
