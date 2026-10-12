---
title: Cache lifecycle
description: What a read costs the second time, what publishing invalidates, and what you have to do about it.
audience: site-developer
type: concept
status: stable
package: "@tangen/sdk"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-f/northwind#cache-lifecycle
---

# Cache lifecycle

Delivery reads are cached. You do not configure it, warm it, or clear it after
an edit.

## The whole lifecycle

Measured against a real project, reading one product through the SDK:

```text
cold read              571.7 ms   "Streaming ingestion that does not drop events"
warm read                9.1 ms   "Streaming ingestion that does not drop events"

  -- edit the tagline, publish --

read after publish      42.7 ms   "Ingestion that never drops an event"
read again               5.6 ms   "Ingestion that never drops an event"
```
Three things to take from that:

1. A repeated read is served from cache.
2. **Publishing invalidates.** The next read returns the new value, not a stale
   one, with no action from you.
3. The read after a publish costs more than a warm read and less than a cold
   one - it refills.

This was measured without Redis, on the PostgreSQL fallback. Redis makes the
numbers smaller; the lifecycle is the same.

## What invalidates

Publishing and unpublishing an object invalidate the reads that could return
it. Saving a draft does not - a draft is not in the published view that
Delivery serves.

If you edit and do not publish, the Delivery API is *correct* to keep returning
the old value.

## Controlling it

**The SDK query builder has no cache method.** Caching is automatic and the
platform's defaults are what the measurements above show. There is nothing to
call and nothing to configure per query through `@tangen/sdk`.

A caller posting to the Delivery API directly can state what staleness it will
accept, because `cacheStrategy` is a key on the query body:

```json
{
  "query": { "slug": { "eq": "gridlock" } },
  "cacheStrategy": { "ttl": 60, "swr": 300 }
}
```
`ttl` is how long a result stays fresh; `swr` is how long a stale result may be
served while a fresh one is fetched behind it. Most sites never need it - the
default plus publish-invalidation is the whole story.

## Related

- [Publishing](/build/content/publishing)
- [Your first query](/build/querying/first-query)
