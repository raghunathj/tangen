---
title: Performance
description: Caching, query cost, and finding what makes a page slow.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g8/projection
---

# Performance

Most slow Tangen pages are one of four things: too much depth, no projection,
a missing cache, or an exact count on a large type.

## Query cost

**Depth.** Each level is another expansion pass. A card grid at `depth(2)` does
three passes over a widening set to render a name.

```ts
.depth(1).populate('author', ['id', 'title', 'slug'])
```

**Projection.** `props` narrows what is selected and serialized; `populate`
narrows **one named relation's** expanded record. A list of 50 articles does not
need 50 bodies.

`populate` takes **two arguments**: the relation field, then its columns. The
one-argument form typechecks against a loose signature and silently narrows
nothing, so you keep paying the cost you were trying to avoid.

**Counting.** `total` is a second query over the whole table.

```ts
.total(false)     // hasMore is still exact
```

Use it whenever the UI shows "load more" rather than a page count.

**Paging.** `offset` walks the rows it skips. For feeds and exports use a
cursor:

```ts
.after(meta.cursor)
```

## Caching

Three layers, and they are independent:

| layer | caches | you control |
|---|---|---|
| **Tangen** | content reads, per workspace | TTLs in the workspace config |
| **your frontend** | rendered pages and fetched data | your framework |
| **the browser or CDN** | responses | your headers |

Rules that save real incidents:

- **The locale must be in your cache key.** Otherwise a French reader gets
  English intermittently.
- **Preview is `no-store`.** Never cache it, and never let a preview response
  warm a published cache.
- **Globals are read on nearly every render.** Cache them at least per request.
- **Invalidate on publish**, not on a timer, when freshness matters. A webhook
  on `object.published` is the usual mechanism.

## Modeling for speed

- **A many-relation you always expand** is a cost on every read of that type.
- **Filtering on a field you did not model as filterable** - `link` is not
  filterable - means doing it in your application over a larger result set.
- **Deeply nested repeaters** serialize on every read whether you render them
  or not. `props` is the escape.

## Performance Monitor

The Admin's Devspace has a **Performance Monitor**: per-request SQL with real
execution and pool-queue time, duplicate and N+1 detection, page vitals, and
captured console errors.

It is on in development by default. The process variable that forces it
keeps its older name:

```bash
TANGEN_QUERY_MONITOR=1    # force on
TANGEN_QUERY_MONITOR=0    # force off
```

The Admin toggle wins over the variable. The bootstrap flag is
`queryMonitorEnabled`. **The product is Performance Monitor**; those two
identifiers are the implementation's, and they are what you type.

**It is not Telemetry.** Telemetry is a separate operator-facing capability
that keeps recent operational events in memory. Performance Monitor is a
developer tool for one request at a time.

## Debugging a slow page

1. Open the page with Performance Monitor on.
2. Look at **statement count** first. A page doing 40 queries has an N+1, not a
   slow query.
3. Look for **duplicates** - the same statement several times usually means a
   global read inside a loop.
4. Check **depth and projection** on the query behind it.
5. Only then look at individual timings.

## Related

- [TangenQL reference](/reference/tangenql) · [Pagination](/build/querying/pagination)
  · [Querying relations](/build/querying/relations) ·
  [Environment variables](/reference/environment-variables)
