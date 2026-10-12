---
title: TangenQL
description: "The query language: filters, operators, boolean groups, relations, sorting, pagination, depth and what it refuses."
audience: site-developer
type: reference
status: stable
package: "@tangen/sdk"
lastVerified: 2026-09-02
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# TangenQL

TangenQL is a **JSON query object**, not a string language. There is no parser
and no grammar to escape: you build an object, and the compiler turns it into
SQL. The same object works through the SDK, `POST /api/v1/objects/:type/query`,
and the local client inside a custom route.

```ts
const { data, meta } = await tangen
  .objects('article')
  .where({ featured: true, views: { gt: 100 } })
  .sort('publishedAt', 'desc')
  .limit(20)
  .get()
```

## Filters

A filter is a map of field names to conditions. **Every condition ANDs.**

```ts
.where({ featured: true, views: { gt: 100 } })   // featured AND views > 100
```

A bare value means `eq`:

```ts
.where({ views: 100 })            // same as { views: { eq: 100 } }
.where({ title: 'Launch day' })
```

`null` means absence:

```ts
.where({ note: null })            // same as { note: { exists: false } }
```

## Operators

| operator | on | means |
|---|---|---|
| `eq` | any | equal. The bare-value shorthand |
| `ne` | any | not equal |
| `gt` `gte` `lt` `lte` | numbers, dates | ordered comparison |
| `in` | any | one of. On a **multiselect** it overlaps rather than compares |
| `nin` | any | none of. On a multiselect, the absence of all of them |
| `contains` | strings | case-insensitive substring |
| `ncontains` | strings | case-insensitive substring, negated |
| `startsWith` | strings | case-insensitive prefix |
| `exists` | any | `true` for present, `false` for absent |

```ts
.where({ views: { in: [0, 100] } })
.where({ title: { contains: 'LAUNCH' } })     // case-insensitive
.where({ title: { startsWith: 'la' } })
.where({ tags: { in: ['blue'] } })            // multiselect: overlaps
.where({ note: { exists: false } })
```

A string operator on a non-string value is refused, not coerced.

## Boolean groups

`_or` and `_and` take arrays of conditions. **Conditions inside one branch AND
together**, and a top-level condition ANDs with the group.

```ts
.where({ _or: [{ views: { gt: 90 } }, { title: { contains: 'draft' } }] })

// (featured AND views < 10) OR (views = 50)
.where({ _or: [{ featured: true, views: { lt: 10 } }, { views: { eq: 50 } }] })

// (views > 90 OR views = 0) AND featured
.where({ _or: [{ views: { gt: 90 } }, { views: { eq: 0 } }], featured: true })
```

Groups nest **4 levels deep**. Nesting past that is refused before anything
runs.

## Relations

A **dotted path** filters by a field on the related record, one level deep:

```ts
.where({ 'author.title': { contains: 'jane' } })
.where({ 'cats.title': { contains: 'Rex' } })    // through a many relation
```

An unknown prefix, a prefix that is not a relation, and a path deeper than one
level are all refused.

`_referencedBy` selects objects that a **many** relation points at:

```ts
await tangen.objects('author')
  .where({ _referencedBy: { type: 'article', field: 'contributors' } })
  .get()

// only referrers in a given status count
.where({ _referencedBy: { type: 'article', field: 'contributors', status: 'draft' } })
```

It refuses a field that is not a many relation. **It refuses `link` fields
loudly** - links do not participate in backlink discovery in v1.

## Sorting

```ts
.sort('publishedAt', 'desc')
```

**camelCase is canonical.** System fields sort under their content-model names:
`createdAt`, `updatedAt`, `publishedAt`, `title`, `slug`, `id`, `status`.
Custom fields sort under the name you gave them.

The storage spelling (`created_at`, `updated_at`, `published_at`) is still
accepted for compatibility and compiles to an identical query.

**Default: `createdAt` descending** - newest first.

## Pagination

```ts
.limit(20).offset(40)                    // offset paging
.limit(20).after(meta.cursor)            // keyset paging
.total(false)                            // skip the count
```

`meta` always carries the page facts: `total`, `limit`, `offset`, `cursor` and
`hasMore`.

`total: false` skips the count query and **still answers `hasMore` exactly** -
it is not an estimate. A cursor walks the same order as the sort, and mixing a
cursor with `offset` is refused.

## Publication state

```ts
.status('published')    // default for an API key
.status('draft')
.status('any')
```

A draft is not in a published read. Reading drafts through an API key needs the
`objects: read_draft` action.

## Relation depth

```ts
.depth(1)
```

| depth | a relation field is |
|---|---|
| `0` | the target's id, and nothing is fetched for it |
| `1` | the target object |
| `2` | the target object, with **its** relations expanded |

**The ceiling is 5.** Depth `6` is refused with a `422 VALIDATION_ERROR` naming
the field, before any query is planned. A non-integer, a negative, `NaN`,
`Infinity` and a string are all refused the same way.

On a REST read the gateway **clamps** an over-depth integer to the ceiling and
reports it in `meta.clamped` rather than refusing. The refusal above applies
where no clamp runs: the local client, an extension, the compiler used directly.

A cycle stops at the object already on the path, however deep the request.

**Media expands at every depth, including 0** - it is an always-resolved field
type, not a depth leak. It resolves on the object you asked for, not on an
expanded relation target. **Object fields** are values on the row at every
depth. **Links** consume no depth at all.

## Projection

```ts
.props(['id', 'title', 'slug'])          // exactly these keys come back
.populate('author', ['id', 'title'])     // project ONE relation's expanded record
```

`props` is also the opt-out for media: a projection that omits a media field
returns no media.

## Labels

Labels are **REST-body options**. The SDK builder has no method for them.

```jsonc
// POST /api/v1/objects/article/query
{
  "query": { "labels": { "any": ["launch", "evergreen"] } },
  "includeLabels": true
}
```

`all`, `any` and `none` narrow by attached labels; `includeLabels: true`
attaches them to each row as `_labels`.

## Locale

`locale` is a **top-level key of the request body**, beside `limit` and
`depth` - it is not part of `query`, and on this route it is **not** a
query-string parameter:

```json
// POST /api/v1/objects/page/query
{ "query": { "path": { "eq": "/company/about" } }, "limit": 1, "locale": "fr" }
```

A `?locale=fr` on the query route is **ignored, not refused**: you get a `200`
carrying default-locale content, which looks like a missing translation rather
than a mis-addressed request. The SDK's `.locale('fr')` puts it in the right
place for you.

## What it refuses

- an unknown field name
- an unknown operator (`{ views: { between: [1, 2] } }`)
- a bare array as a condition (`{ views: [1, 2] }`)
- a string operator on a non-string value
- an unknown content type
- a relation path deeper than one level
- `_referencedBy` through a non-many relation, or through a link
- a depth outside `0..5` (where no clamp runs - see Relation depth)
- a cursor combined with `offset`

Every refusal is a `422 VALIDATION_ERROR` with the offending field named.

## Performance

- `total: false` removes a count query on large tables and keeps `hasMore`
  exact.
- Keyset paging (`after`) does not degrade as `offset` grows.
- `props` narrows what is selected and serialized.
- Depth is a budget: each level is another expansion pass.

## Related

- [SDK](/reference/sdk) · [Fields](/reference/fields) · [Link](/reference/link)
  · [Errors](/reference/errors) · [Delivery API](/reference/delivery-api)
