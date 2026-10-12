---
title: Querying relations
description: Expanding related content with depth, and keeping the cost down.
audience: site-developer
type: guide
status: stable
package: "@tangen/sdk"
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-f/northwind#tangenql
---

# Querying relations

A relation is an id until you ask for more.

```ts
await tangen.objects('article').depth(0).get()   // author: "obj_01H…"
await tangen.objects('article').depth(1).get()   // author: { id, title, … }
await tangen.objects('article').depth(2).get()   // and the author's relations expand
```

**The ceiling is 5.** Asking for more is refused with a `422` naming the field;
over REST the gateway clamps instead and reports it in `meta.clamped`.

## Ask for what you render

```ts
const { data } = await tangen
  .objects('article')
  .depth(1)
  .populate('author', ['id', 'title', 'slug'])
  .props(['id', 'title', 'slug', 'author'])
  .limit(20)
  .get()
```

`props` narrows the row; `populate` narrows the **expanded** record. A card grid
needs the author's name, not their biography.

## What depth does not affect

- **Media** expands at every depth, including `0`. It is always resolved, and
  it resolves on the object you asked for rather than on expanded targets.
- **`object` fields** are values on the row at every depth.
- **Links** consume no depth at all - a link resolves the same at `depth(0)`.

So `depth` is about **relations**, and nothing else.

## Cycles

An article's author whose latest article is that article stops at the object
already on the path. You cannot loop, however deep you ask.

## Cost

Each level is another expansion pass. A list of 50 articles at `depth(2)` is
three passes over widening sets.

Practical shapes:

| view | depth |
|---|---|
| a card grid | `0` or `1` with `populate` |
| an article page | `1` |
| a page needing the author's employer | `2` |
| anything deeper | query the middle type separately |

## Related

- [TangenQL reference](/reference/tangenql) · [Relations](/build/content-modeling/relations)
  · [Performance](/build/performance)
