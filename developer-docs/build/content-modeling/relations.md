---
title: Relations
description: Connecting content types, one and many, and what it costs to read them.
audience: site-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g8/relations
---

# Relations

A relation points at other content.

```ts app/content-objects/article/schema.ts
author:     field.relation({ label: 'Author', config: { targetType: 'person' } }),
categories: field.relation({ label: 'Categories', config: { targetType: 'category', many: true } }),
```

## Reading them costs depth

A relation is an id until you ask for more:

```ts
await tangen.objects('article').depth(0).get()   // author is an id
await tangen.objects('article').depth(1).get()   // author is the person object
await tangen.objects('article').depth(2).get()   // and the person's own relations expand
```

**The ceiling is 5**, and each level is another expansion pass. Ask for what
you render:

```ts
const { data } = await tangen
  .objects('article')
  .depth(1)
  .populate('author', ['id', 'title', 'slug'])   // project the expanded record
  .limit(20)
  .get()
```

`populate` narrows the expanded record; `props` narrows the row itself.

A cycle stops at the object already on the path, so a mutual relation cannot
loop.

## Filtering across one

A dotted path filters by a field on the related record, **one level deep**:

```ts
.where({ 'author.title': { contains: 'jane' } })
.where({ 'categories.slug': 'engineering' })
```

Deeper paths are refused. If you need two levels, query the middle type first.

## Finding what points at you

`_referencedBy` selects objects that a **many** relation points at:

```ts
await tangen.objects('person')
  .where({ _referencedBy: { type: 'article', field: 'contributors' } })
  .get()
```

It works through many relations only, and it refuses `link` fields - links do
not participate in backlink discovery.

## Relation or link

| | |
|---|---|
| **relation** | a structural connection you query, filter and expand. An article *has* an author |
| **link** | a destination an editor chose, which may be external. A CTA *points at* something |

Use a relation when the connection is part of the model. Use a
[link](/build/content-modeling/links) when it is an editorial choice.

## Modeling notes

- **Put the relation where the cardinality is natural.** An article has one
  author; a person has many articles. Declare it on the article.
- **A many-relation you always expand is a depth cost on every read.** Consider
  whether the list view needs it.
- **Required relations affect publishing.** Publishing an object whose required
  relation points at a draft is refused with `NEEDS_CASCADE`. Publish the
  dependency, or publish with the cascade.

## Related

- [TangenQL reference](/reference/tangenql) · [Querying relations](/build/querying/relations)
  · [Links and navigation](/build/content-modeling/links) ·
  [Errors](/reference/errors)
