---
title: Delivery API
description: The REST endpoints an API key can call, grouped by the scope that grants them.
audience: site-developer
type: reference
status: stable
lastVerified: 2026-09-01
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Delivery API

Everything below is `https://<your-api>/api/v1/…` with an API key:

```http
Authorization: Bearer <key>
```

The [SDK](/reference/sdk) wraps most of this and is the recommended path. Use
REST directly when you need something the SDK does not cover - uploads, form
submissions, and site authentication.

**A key is scoped to one workspace on one deployment.** Endpoints are grouped
below by the [scope and action](/reference/permissions) that grants them; a key
without the action gets `403 FORBIDDEN`.

## Content — `objects`

| method | path | action |
|---|---|---|
| `POST` | `/objects/:type/query` | `read` — the [TangenQL](/reference/tangenql) endpoint. The one you will use most |
| `GET` | `/objects/:type` | `read` — list |
| `GET` | `/objects/:type/:id` | `read` — one object |
| `GET` | `/objects/:type/by-slug/:slug` | `read` |
| `GET` | `/objects/:type/versions` · `/versions/:versionId` | `read` |
| `GET` | `/objects/:type/slug-check` | `read` — is a slug free |
| `POST` | `/objects/:type` | `write` — create |
| `PATCH` | `/objects/:type/:id` | `write` — update. Send `If-Match` |
| `DELETE` | `/objects/:type/:id` | `delete` |
| `POST` | `/objects/:type/:id/publish` · `/unpublish` · `/stage` | `publish` |
| `POST` | `/objects/:type/:id/publish/preflight` | `publish` — the cascade plan, no write |
| `POST` | `/objects/:type/schedule` · `DELETE` same path | `publish` |
| `GET` `POST` `PUT` `DELETE` | `/objects/:type/:id/labels` | `read` / `write` |

Reading returns **published** content. Drafts need the separate `read_draft`
action **and** an explicit `status`.

```bash
curl -X POST https://cms.example.com/api/v1/objects/article/query \
  -H "Authorization: Bearer $TANGEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "query": { "featured": true },
        "sort": { "field": "publishedAt", "direction": "desc" },
        "limit": 10,
        "depth": 1
      }'
```

```jsonc
{
  "data": [ /* rows */ ],
  "meta": { "total": 42, "limit": 10, "offset": 0, "cursor": "…", "hasMore": true }
}
```

## Globals — `globals`

| method | path | action |
|---|---|---|
| `GET` | `/globals` | `read` |
| `GET` | `/globals/:name` | `read` |
| `PUT` `PATCH` | `/globals/:name` | `write` |

## Media — `media`

| method | path | action |
|---|---|---|
| `GET` | `/media` · `/media/folders` | `read` |
| `GET` | `/media/asset/:id` · `/asset/:id/usage` | `read` |
| `GET` | `/media/file/:id` · `/media/transform` | `read` |
| `POST` | `/media/upload` | `write` |
| `PATCH` | `/media/asset/:id` | `write` |
| `DELETE` | `/media/asset/:id` | `delete` |

`GET /media/file` and `/media/transform` serve bytes and are reachable without
a key, so a browser can load an image.

## Search — `search`

| method | path | action |
|---|---|---|
| `POST` | `/search` | `read` |

## Forms — `forms`

| method | path | action |
|---|---|---|
| `GET` | `/forms` · `/forms/:formId` · `/forms/:formId/schema` | `read` |
| `POST` | `/forms/:formId/submit` | `submit` |
| `GET` | `/forms/:formId/submissions` | `read` |

## Custom tables — `tables`

| method | path | action |
|---|---|---|
| `POST` | `/tables/:name/query` | `read` |

## Localization

| method | path |
|---|---|
| `GET` | `/i18n/locales` — which languages this workspace serves |

## Site authentication

Fourteen endpoints under `/auth/…`, for your site's **end users** rather than
for your application's key. They are in
[Authentication](/reference/authentication).

## Unauthenticated

A small set answers without a credential: `GET /api/health`,
`GET /api/v1/media/file`, `GET /api/v1/media/transform`, `GET /media/*`,
`GET /llms.txt`, the form embed asset, and the GraphiQL shell.

## Not public

The **Admin API** is not part of this contract. Endpoints under `/admin/…`,
`/auth-users/…`, the extension data routes, schema writes, releases, Porter,
workspace and member management, and the playground exist for the Admin panel
and change without notice. Being able to reach one with a member session is not
a promise that it will still be there.

`POST /objects/bulk-update`, `/objects/migrate` and `/objects/export` are Admin
operations, not Delivery.

## Headers

| header | on | means |
|---|---|---|
| `Authorization: Bearer <key>` | request | the API key |
| `ETag` | read response | the version token for this object |
| `If-Match` | write request | apply only if the object is still at this version. See [`STALE_OBJECT`](/reference/errors) |
| `Retry-After` | `429` | when to retry |

## Errors

Every failure is the envelope in [Errors](/reference/errors).

## OpenAPI

There is no OpenAPI specification for v1. This page is the contract.

## Related

- [SDK](/reference/sdk) · [TangenQL](/reference/tangenql) ·
  [Permissions](/reference/permissions) · [Errors](/reference/errors) ·
  [Authentication](/reference/authentication)
