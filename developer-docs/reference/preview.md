---
title: Preview
description: Preview tokens, the draft-read endpoint, TTLs, scoping and the live-preview stream.
audience: site-developer
type: reference
status: stable
lastVerified: 2026-09-01
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Preview

Preview lets a frontend read **draft** content that no API key may read, using
a short-lived token instead of a key.

There are four endpoints. Three are control; only one serves content.

| method | path | auth | does |
|---|---|---|---|
| `POST` | `/api/v1/preview/token` | member session | mint a token |
| `GET` | `/api/v1/preview/validate` | member session | check a token is live |
| `GET` | `/api/v1/preview/stream` | member session | SSE: draft changes as they happen |
| `GET` | `/api/v1/preview/object/:id` | **the token itself** | read one draft object |

## The token

```text
prev_<32 hex characters>
```

| property | value |
|---|---|
| **default TTL** | 3600 seconds (1 hour) |
| **maximum TTL** | 86400 seconds (24 hours) |
| **minimum TTL** | 60 seconds |
| **storage** | Redis, with the TTL as its expiry |
| **scope** | one workspace, and **optionally one `objectId`** |

A token scoped to an object reads that object and nothing else. An unscoped
token reads any draft in its workspace.

**Preview requires Redis.** Without it there is nowhere to hold a token with an
expiry, and the endpoints refuse.

### Minting

```http
POST /api/v1/preview/token
Content-Type: application/json

{ "objectId": "obj_01H...", "expiresInSeconds": 900 }
```

Minting needs a **member session** - it is an Admin action. Your frontend never
mints its own token; it receives one, in the preview URL the Admin builds from
`frontend.previewUrl`.

## Reading a draft

```http
GET /api/v1/preview/object/obj_01H...?type=article&locale=fr
X-Tangen-Preview-Token: prev_a1b2...
```

The header **is** the credential. There is no `Authorization` on this request,
and an API key is not accepted.

The response is the draft object with media expanded at every depth (blocks
included) and links resolved, localized to `locale` when given.

Responses are **`no-store`**. Draft content is never cached by the platform, by
a CDN, or by a browser.

## Failure

| condition | answer |
|---|---|
| header absent | `401 UNAUTHORIZED` - "Missing X-Tangen-Preview-Token header" |
| token unknown or expired | `401 UNAUTHORIZED` |
| token scoped to a different object | refused |
| object in another workspace | refused |
| Redis unavailable | refused |

A failed preview read never falls back to published content. It fails, and your
frontend renders the published page or a not-found.

## Security

- **A token is a draft-read credential.** Anyone holding it reads unpublished
  content for its lifetime. Treat it like a password.
- **Prefer object-scoped tokens with short TTLs.** An editor previewing one
  article needs one object for a few minutes.
- **Never put a token in a page a search engine can reach**, and never render it
  into HTML your published site serves.
- Preview responses are `no-store`; do not cache them yourself, and do not
  reuse a preview response to warm a published cache.
- The token grants **read** only. It cannot write, publish, or reach any other
  endpoint.

## The live-preview stream

`GET /api/v1/preview/stream` is Server-Sent Events over a member session: the
Admin editor pushes a draft's changes as they are typed. The SDK wraps the
browser side of it (`onLivePreview`, `isLivePreview`, and the message-type
constants) so an iframe can re-render without a fetch.

## SDK

```ts
import { fetchPreviewObject } from '@tangen/sdk'

const draft = await fetchPreviewObject({
  apiUrl: process.env.TANGEN_API_URL!,
  id, type: 'article', token, locale: 'fr',
})
```

Returns the object, or `null` on any failure.

## Related

- [Configuration](/reference/configuration) - `frontend.previewUrl` and the
  per-type overrides · [SDK](/reference/sdk) ·
  [Permissions](/reference/permissions) · [Errors](/reference/errors) ·
  [Preview in practice](/build/content/preview)
