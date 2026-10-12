---
title: Search
description: Adding search to your site - what is indexed, how you query it, and its limits.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g8/search
---

# Search

To add search to your site you query it: there is nothing to install, no index
to build and no third-party service to run. Search is part of the platform,
backed by PostgreSQL full-text search, with one engine.

## There is nothing to enable

Search is part of the platform and answers as soon as you have published
content. There is no `tangen enable search`; the enableable features are `auth`,
`forms`, `localization`, `graphql` and `ai`, and asking for any other name is
refused with that list.

What you do need is a key with the **`search: read`** scope:

```jsonc
{ "permissions": { "objects": { "actions": ["read"] },
                   "search":  { "actions": ["read"] } } }
```

## What is indexed

Published content, indexed as it changes. Publishing, unpublishing, updating and
deleting all update the index in the same transaction as the write - so a
published article is findable immediately, and an unpublished one stops being
found immediately.

Indexing is per **workspace, on each deployment**. Staging content is not in
production's index.

## Search

```ts
const results = await tangen.search('pricing')
```

Needs `search: read`.

Results are ranked, hydrated into full objects, and grouped by type internally
so hydration is one batch per type rather than one query per hit.

## Audiences

Search providers declare an audience. A key granted the `public` audience
searches content; `internal` reaches provider surfaces meant for the Admin.
**Give a public frontend the public audience** - the internal one exists for
Admin search and reaches things a visitor should not see.

## Tuning

| variable | default | does |
|---|---|---|
| `TANGEN_SEARCH_FUZZY` | `false` | typo tolerance via `pg_trgm`. Only the exact string `true` enables it |
| `TANGEN_SEARCH_MAX_RESULTS` | `100` | ceiling on rows one search returns |
| `TANGEN_SEARCH_MAX_OFFSET` | `1000` | the deepest page a caller may request |
| `TANGEN_SEARCH_TIMEOUT_MS` | `2000` | statement timeout for a search |
| `TANGEN_SEARCH_MAX_CONCURRENT` | `4` | concurrent searches per process |
| `TANGEN_SEARCH_MAX_PER_WORKSPACE` | `2` | concurrent searches per workspace |

The concurrency limits exist so a search storm cannot starve content reads.
A search over the limit waits, and a search over the timeout is cut off -
both by design.

## Limits

- **Full-text, not semantic.** It matches words, not meaning. For meaning, the
  Knowledge capability does retrieval over embeddings - a different feature with
  its own requirements.
- **Published content only.** Drafts are not indexed.
- **Not a query engine.** Use [TangenQL](/reference/tangenql) for filtering and
  sorting; use search for a search box.
- **Offset is capped.** Deep paging through results is refused rather than
  allowed to get slow.

## Common mistakes

- **Using search where a filter belongs.** "All articles in this category" is a
  TangenQL query.
- **Expecting drafts.**
- **Giving a public key the internal audience.**
- **Assuming search is on.** It is a capability; check before you build a UI
  that depends on it.

## Related

- [TangenQL reference](/reference/tangenql) · [Permissions](/reference/permissions)
  · [Environment variables](/reference/environment-variables) ·
  [Performance](/build/performance)
