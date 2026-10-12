---
title: Drafts and publishing
description: "Draft and published status: why a newly created entry is invisible to the Delivery API until it is published, and what a reader sees."
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-g4/publishing
---

# Drafts and publishing

Every object has a `status`: `draft`, `published` or `archived`. An API key
reads **published** content unless you ask otherwise and hold the right to.

## What a reader sees

```ts
await tangen.objects('article').get()                    // published only
await tangen.objects('article').status('draft').get()    // needs objects: read_draft
await tangen.objects('article').status('any').get()       // needs objects: read_draft
```

`objects: read` does **not** include drafts. That separation is what lets you
give a public frontend a key that cannot leak unpublished work.

Publishing takes a **snapshot**. A published object serves what it looked like
when it was published, so an editor's in-progress changes do not appear on the
live site until they publish again.

## Publishing

```ts
await tangen.objects('article').publish(id)
await tangen.objects('article').unpublish(id)
```

Both need `objects: publish`.

**Publishing validates.** Required fields must be filled, and a `422
VALIDATION_ERROR` names each one that is not. A draft may be incomplete; a
published object may not.

## Required relations and cascade

If an object's required relation points at something still in draft, publishing
is refused with **`409 NEEDS_CASCADE`**. Either publish the dependency first, or
ask for a preflight and publish together:

```ts
const plan = await tangen.objects('article').publishPreflight(id)
// plan lists what else would publish, and what blocks it
```

`CASCADE_BLOCKED` means the cascade itself cannot proceed - something in the
chain is invalid, not merely unpublished.

## Unpublishing

Unpublish takes the object offline: the published snapshot is cleared, and it
disappears from published reads. **The draft is untouched** - unpublishing is
not deleting, and republishing restores it.

Any per-object data an extension stores goes offline with it.

## Archiving

`archived` is content you keep but do not serve. It is not in published reads
and it is not deleted.

## Versions

Publishing creates a version. Past versions are readable, and restorable from
the Admin.

## Common mistakes

- **Giving a public frontend `read_draft`.** It leaks unpublished content.
- **Modeling your own `published` boolean.** `status` is the one the platform
  and the Admin use.
- **Expecting an edit to appear live.** Edits land in the draft; publishing
  moves them.
- **Treating `NEEDS_CASCADE` as a bug.** It is the platform refusing to publish
  a page with a broken required link.

## Related

- [Delivery API](/reference/delivery-api) · [Permissions](/reference/permissions)
  · [Errors](/reference/errors) · [Preview](/build/content/preview)
