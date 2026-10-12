---
title: Scheduling
description: Publishing at a future time, and what happens when that time arrives.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g8/scheduling
---

# Scheduling

```ts
await tangen.objects('article').schedule(id, '2026-10-01T09:00:00Z')
await tangen.objects('article').unschedule(id)
```

Needs **both `objects: write` and `objects: publish`**. A key with only one gets
a `403` naming the other, which is the fastest way to tell them apart.

On the wire the field is `scheduledAt`:

```http
POST /api/v1/objects/<id>/schedule?type=article&env=development
{ "scheduledAt": "2026-10-01T09:00:00Z" }
```

A scheduled object takes the status **`scheduled`** - not `draft` - and carries
`scheduledAt`. It is still invisible to the Delivery API, which serves published
content only, so a default read will not find it. When its time arrives the
platform publishes it: no request of yours, and no cron of yours.

## What is checked, and when

Scheduling **validates as if publishing now**: an object that could not publish
cannot be scheduled. That means the failure lands while a person is looking at
it, rather than at 3am.

At the scheduled moment the validation runs again. If the object has become
invalid since - a required relation was unpublished, a required field cleared -
it is **left scheduled** rather than published, and it retries on a later tick.
Nothing publishes incomplete.

## Time

Timestamps are absolute. Send UTC and let your frontend format for the reader.

## Verify

`scheduledAt` is on every object. A scheduled article is `status: 'scheduled'`
with a `scheduledAt` in the future; after publication `scheduledAt` is cleared and
`publishedAt` is set.

## Related

- [Drafts and publishing](/build/content/publishing) ·
  [Delivery API](/reference/delivery-api) · [Fields reference](/reference/fields)
