---
title: Filtering and sorting
description: Narrowing a result set with operators and boolean groups, and ordering it.
audience: site-developer
type: guide
status: stable
package: "@tangen/sdk"
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-f/northwind#tangenql
---

# Filtering and sorting

A filter is an object. **Every condition ANDs.**

```ts
await tangen.objects('article')
  .where({ featured: true, views: { gt: 100 } })
  .get()
```

A bare value means equals, and `null` means absent:

```ts
.where({ slug: 'launch-day' })      // equals
.where({ excerpt: null })            // has no excerpt
```

## The operators you will use

```ts
.where({ views: { gte: 50 } })                    // gt gte lt lte
.where({ status: { in: ['published'] } })          // in, nin
.where({ title: { contains: 'launch' } })          // case-insensitive
.where({ slug: { startsWith: 'guide-' } })         // case-insensitive prefix
.where({ heroImage: { exists: true } })            // presence
```

`contains`, `ncontains` and `startsWith` are case-insensitive. On a
`multiselect`, `in` **overlaps** rather than compares - `{ tags: { in: ['blue'] } }`
matches any row tagged blue.

The full operator list is in [Reference → TangenQL](/reference/tangenql).

## Or, and grouping

```ts
.where({ _or: [{ featured: true }, { views: { gt: 1000 } }] })
```

Conditions **inside one branch AND together**, and a top-level condition ANDs
with the whole group:

```ts
// (featured AND views < 10) OR (views = 50)
.where({ _or: [{ featured: true, views: { lt: 10 } }, { views: { eq: 50 } }] })

// (views > 90 OR views = 0) AND published this year
.where({ _or: [{ views: { gt: 90 } }, { views: { eq: 0 } }], publishedAt: { gte: '2026-01-01' } })
```

Groups nest four levels deep.

## Filtering by a related field

```ts
.where({ 'author.title': { contains: 'jane' } })
.where({ 'categories.slug': 'engineering' })
```

**One level only.** For two, query the middle type first.

## Sorting

```ts
.sort('publishedAt', 'desc')
```

Use the name from your content model - `createdAt`, `publishedAt`, `title`, or
any field you declared. camelCase is canonical. The default is `createdAt`
descending.

## A realistic query

```ts
const { data, meta } = await tangen
  .objects('article')
  .where({
    'categories.slug': 'engineering',
    heroImage: { exists: true },
    _or: [{ featured: true }, { views: { gt: 500 } }],
  })
  .sort('publishedAt', 'desc')
  .props(['id', 'title', 'slug', 'publishedAt'])
  .limit(12)
  .get()
```

## Common mistakes

- **An array as a condition.** `{ views: [1, 2] }` is refused; use `in`.
- **A string operator on a number.** Refused, not coerced.
- **A two-level relation path.** Refused.
- **Expecting `contains` to be case-sensitive.** It is not.

## Related

- [TangenQL reference](/reference/tangenql) · [Pagination](/build/querying/pagination)
  · [Query troubleshooting](/build/querying/troubleshooting)
