---
title: GraphQL
description: "The generated GraphQL API: how to turn it on, what the schema looks like, and what it will not do."
audience: site-developer
type: reference
status: experimental
package: "@tangen/graphql"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g12/clean-room
---

# GraphQL

Tangen can serve your content model as GraphQL as well as REST. The schema is
**generated from your content types**, so it changes when you push.

> **Status: experimental.** The endpoint, the authentication and the permission
> model are the same ones REST uses and are stable. The *shape of the generated
> schema* - field names, argument names, the connection wrapper - has not been
> frozen, and no external project has been built on it. Use it where a breaking
> change between releases is acceptable. [TangenQL](/reference/tangenql) through
> the [SDK](/reference/sdk) is the supported path for a site you have to keep
> running.

## Turning it on

```bash
tangen enable graphql
```

That writes `app/config/graphql.ts` and wires it into your workspace config:

```ts app/config/graphql.ts
import { defineGraphqlConfig } from '@tangen/cms'

export const graphqlConfig = defineGraphqlConfig({
  enabled: true,
  // mutations: true,          // opt-in create/update/publish/delete
  // introspection: true,      // schema introspection for tooling
})
```

Restart, and `POST /api/v1/graphql` answers. Nothing to install: `@tangen/graphql`
is a dependency of `@tangen/api`, so it is already in your project.

**While GraphQL is off, `POST /api/v1/graphql` is a `404`** - the route is
indistinguishable from absent.

## Authentication

Exactly the same credential REST takes:

```http
POST /api/v1/graphql
Authorization: Bearer <api key>
Content-Type: application/json

{"query": "{ articles { data { title } } }"}
```

No credential is a `401`. See [Authentication](/reference/authentication).

## Permissions

Grants are enforced **in the resolvers**, per type, and a refusal is a refusal -
never an empty list.

| situation | answer |
|---|---|
| key has no `objects: read` for the type | `errors[0].extensions.code = "FORBIDDEN"`, `data: null` |
| `status: "draft"` without `objects: read_draft` | `FORBIDDEN`, naming the grant |
| no credential | `401` before the query is parsed |

A read returns **published content only**, exactly as REST does.

## The generated schema

For a content type named `article` you get:

| field | arguments | returns |
|---|---|---|
| `articles` | `where`, `orderBy`, `limit`, `offset`, `after`, `locale`, `status` | `ArticleConnection` |
| `article` | `id`, `slug`, `locale`, `status` | `Article` |
| `global` | `name` | the global's values |

A connection is `{ data, meta }`, not the Relay `edges`/`node` shape:

```graphql
{
  articles(limit: 5, where: { section: { eq: "world" } }) {
    data { id title slug section }
    meta { total }
  }
}
```

```json
{ "data": { "articles": { "data": [ { "id": "…", "title": "Hello Tangen", "slug": "hello-tangen", "section": "world" } ], "meta": { "total": 1 } } } }
```

`where` mirrors [TangenQL](/reference/tangenql)'s operators. `status` is a
string: `status: "draft"` is a request for drafts and needs the grant above.

## Mutations

**Off by default.** With `mutations: false` (the default) any mutation is
rejected by the schema itself:

```text
The mutation operation is not supported by the schema.
```

Set `mutations: true` and the schema gains five per type:

```text
createArticle · updateArticle · publishArticle · unpublishArticle · deleteArticle
```

They run through the same handlers, validation and permission checks the REST
endpoints use - a mutation is not a way around a grant. A key with `read` but
not `write` gets `FORBIDDEN`:

```json
{ "errors": [ { "message": "You do not have permission to write 'article'",
                "path": ["createArticle"], "extensions": { "code": "FORBIDDEN" } } ],
  "data": { "createArticle": null } }
```

`input` takes `title`, `slug` and the type's own fields. As with REST, a create
without a `slug` leaves it null rather than deriving one.

## Introspection and the GraphiQL page

`GET /api/v1/graphql` serves a GraphiQL console. It is a static page and needs
no credential; every query it sends does.

> The console is served whether or not GraphQL is enabled, so seeing it is not
> evidence that the API is on. `POST` is the test: `404` means off.

Introspection is on in a development configuration. Turn it off with
`introspection: false` where you do not want the schema published.

## What it does not do

- **No SDL endpoint.** `GET /api/v1/graphql/schema` is a `404`; use
  introspection.
- **No subscriptions over `POST`.** A `Subscription` type is generated only
  while a realtime hub is running in the process, and it is served over the
  realtime socket rather than this route.
- **No file uploads.** Media goes through the REST media endpoints.
- **No typed client.** `tangen types` generates types for the SDK, not for
  GraphQL.

## Related

- [TangenQL](/reference/tangenql) - the query vocabulary `where` mirrors
- [Permissions](/reference/permissions) - the grants the resolvers check
- [Delivery API](/reference/delivery-api) - the REST surface this parallels
