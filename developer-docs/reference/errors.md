---
title: Errors
description: The public error codes, their HTTP statuses, and the ones your application is expected to handle.
audience: site-developer
type: reference
status: stable
package: "@tangen/sdk"
lastVerified: 2026-09-01
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Errors

Every failure carries a **stable code** you can switch on. The message is for a
human and may change; the code will not.

```jsonc
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "title is required",
    "fieldErrors": { "title": "required" }
  }
}
```

Through the SDK this arrives as a `TangenError` with `code`, `message`,
`statusCode`, and `fieldErrors` when the code carries them.

## Codes your application should handle

| code | status | when |
|---|---|---|
| `VALIDATION_ERROR` | **422** | the request is well-formed and wrong: a missing required field, a bad operator, a depth outside `0..5`, an invalid link. `fieldErrors` names each offending field. Some argument-level refusals use **400** |
| `UNAUTHORIZED` | 401 | no credential, or one that is not valid |
| `FORBIDDEN` | 403 | a valid credential without the action for this request |
| `NOT_FOUND` | 404 | the object does not exist, or is not visible in this status |
| `TYPE_NOT_FOUND` | 404 | the content type is not in this deployment's schema. Usually a missing `tangen push` |
| `FIELD_NOT_FOUND` | 404 | the field is not on that type |
| `CONFLICT` | 409 | a uniqueness collision, most often a slug |
| `STALE_OBJECT` | **409** | you are overwriting a version you did not read. See below |
| `NEEDS_CASCADE` | 409 | publishing would leave a required relation pointing at a draft. Retry with the cascade, or publish the dependency first |
| `CASCADE_BLOCKED` | 409 | the cascade itself cannot proceed |
| `RATE_LIMITED` | 429 | too many requests. Honour `Retry-After` |
| `PAYLOAD_TOO_LARGE` | 413 | the body exceeds the request limit |
| `BAD_REQUEST` | 400 | malformed at the protocol level |

## Optimistic concurrency: `STALE_OBJECT`

Every content read returns an **`ETag`**. Send it back as **`If-Match`** on a
write, and the write only applies if nobody changed the row in between.

```ts
const res = await fetch(`${api}/api/v1/objects/article/${id}`, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'If-Match': etag,                 // the ETag from the read
  },
  body: JSON.stringify({ title: 'New title' }),
})
```

If the row moved, you get **409 `STALE_OBJECT`**:

```jsonc
{
  "error": {
    "code": "STALE_OBJECT",
    "message": "article \"obj_01H...\" changed since you read it: reread it and apply your edit to the current version.",
    "details": { "objectId": "obj_01H...", "type": "article", "currentEtag": "W/\"...\"" }
  }
}
```

The refusal carries the **current** ETag so you can reread and retry. It never
carries the competing content.

The token is the row's own `updated_at` at full database precision, base64url
in a weak ETag, and the check is added to the UPDATE's `WHERE` - so it is the
database's check, not the application's, and two writers racing cannot both
win. Omitting `If-Match`, or sending `*`, means "any version" and skips the
condition.

## Capability and configuration codes

These say a feature is not available here rather than that you did something
wrong.

| code | means |
|---|---|
| `UNAVAILABLE` | a capability this request needs cannot run in this deployment |
| `AI_NOT_CONFIGURED` | no AI provider key is configured |
| `KNOWLEDGE_DISABLED` / `KNOWLEDGE_NOT_INDEXED` / `KNOWLEDGE_PACKAGE_MISSING` | the knowledge capability is off, unindexed, or its optional package is not installed |
| `FORM_DISABLED` / `FORM_CLOSED` / `FORM_NOT_OPEN` | the form exists and is not accepting submissions |
| `ENTRY_LIMIT` | the form reached its configured submission limit |

A capability being unavailable is **not** a permission error. See
[Permissions](/reference/permissions).

## Upstream and realtime

`UPSTREAM_ERROR` and `UPSTREAM_TIMEOUT` mean a third-party service Tangen
called failed or was slow; the provider's own message is not passed through.
The `REALTIME_*` codes belong to the realtime transport and are documented with
it.

## What errors never contain

Stack traces, SQL, driver text, secrets, or the value that was rejected. In
production an unexpected internal failure is a generic message with a request
id - the detail is in the server's log, not in the response.

## Related

- [SDK](/reference/sdk) · [Permissions](/reference/permissions) ·
  [TangenQL](/reference/tangenql) · [Delivery API](/reference/delivery-api)
