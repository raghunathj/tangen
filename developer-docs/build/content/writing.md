---
title: Writing content from code
description: Creating and updating objects, and not overwriting somebody else's edit.
audience: site-developer
type: guide
status: stable
package: "@tangen/sdk"
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-g4/publishing
---

# Writing content from code

Most content is written by people in the Admin. Sometimes your application
writes it: an import, a form that creates a submission record, a sync from
another system.

```ts
const created = await tangen.objects('article').create({
  title: 'Launch day',
  subtitle: 'What we shipped',
})

await tangen.objects('article').update(created.id, { subtitle: 'Revised' })
await tangen.objects('article').delete(created.id)
```

`create` and `update` need `objects: write`; `delete` needs `objects: delete`.

A created object is a **draft**. Publishing is a separate call.

## Validation

A write that violates the model is refused with `422 VALIDATION_ERROR`, and
`fieldErrors` names each field. Draft writes are more permissive than
publishing: `required` is enforced at publish.

## Not overwriting somebody else

Every read returns an **`ETag`**. Send it back as `If-Match` and your write
applies only if nothing changed in between:

```ts
const res = await fetch(`${api}/api/v1/objects/article/${id}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'If-Match': etag,
  },
  body: JSON.stringify({ subtitle: 'Revised' }),
})
```

If the row moved you get **`409 STALE_OBJECT`**, carrying the current ETag.
Reread, reapply your change, retry. Do not loop blindly - a stale write usually
means a human is editing the same object.

Omitting `If-Match` means "any version" and skips the check. That is the right
choice for an importer that owns the data, and the wrong one for anything a
person also edits.

## Slugs

A slug is unique per type. Two concurrent creates with the same slug: one wins,
the other gets a **`409 CONFLICT`**. Retry with a different slug, or let the
`slug` field derive itself from the title.

## Common mistakes

- **Expecting a created object to be live.** It is a draft.
- **Retrying a `STALE_OBJECT` with the same body.** Reread first.
- **Writing with a key that only has `read`.** That is a `403`, not an empty
  result.

## Related

- [SDK reference](/reference/sdk) · [Errors](/reference/errors) ·
  [Drafts and publishing](/build/content/publishing) ·
  [Permissions](/reference/permissions)
