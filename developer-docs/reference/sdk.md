---
title: SDK
description: "@tangen/sdk: creating a client, reading and writing content, media, errors, cancellation and what has no SDK surface."
audience: site-developer
type: reference
status: stable
package: "@tangen/sdk"
lastVerified: 2026-09-01
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# SDK

```bash
bun add @tangen/sdk
```

The root entry is **browser-safe**: it imports no `node:` module. Node and Bun
server helpers live in `@tangen/sdk/node`.

## Creating a client

```ts app/lib/tangen.ts
import { createClient } from '@tangen/sdk'

export const tangen = createClient({
  apiUrl: process.env.TANGEN_API_URL!,
  apiKey: process.env.TANGEN_API_KEY!,
})
```

| option | type | default | means |
|---|---|---|---|
| `apiUrl` | `string` | required | the API origin, e.g. `https://cms.example.com`. The SDK adds the API path; a base already ending in `/api/v1` also works |
| `apiKey` | `string` | required | the key. Keep it server-side |
| `fetch` | `FetchFn` | global `fetch` | your own fetch, for instrumentation or a proxy |
| `timeoutMs` | `number` | `30000` | per-request timeout |
| `retries` | `number` | `0` | extra attempts for 429, 502, 503, 504 and network failures |
| `onResponse` | `RequestObserver` | - | called once per response with timings. Throwing here is swallowed |
| `toolbarDetail` | `boolean` | `false` | opt this key in as the Toolbar's drill-down fetcher. Requires `permissions.toolbar.enabled` on the key |

## Reading content

```ts
const { data, meta } = await tangen
  .objects('article')
  .where({ featured: true })
  .sort('publishedAt', 'desc')
  .depth(1)
  .limit(20)
  .get()
```

The builder is typed by your generated registry: `objects('article')` is a
literal union, so a typo is a compile error and the row comes back fully typed.

| method | does |
|---|---|
| `.where(query)` | the [TangenQL](/reference/tangenql) filter |
| `.sort(field, direction)` | ordering, e.g. `.sort('publishedAt', 'desc')`. camelCase field names are canonical |
| `.limit(n)` `.offset(n)` `.after(cursor)` | paging |
| `.total(false)` | skip the count, keep an exact `hasMore` |
| `.depth(n)` | relation expansion, `0`–`5` |
| `.props([...])` `.populate(field, [...])` | project the row, and one relation's expanded record |
| `.status('published' \| 'draft' \| 'any')` | publication state |
| `.locale(code)` | which locale to read |
| `.serialize(...)` `.cacheStrategy(...)` | response options |
| `.get()` | run it, returning `{ data, meta }` |
| `.find(id)` `.findBySlug(slug)` | one object |

## Writing content

Available when the key grants the action.

| method | needs |
|---|---|
| `.create(values)` | `objects: write` |
| `.update(id, values)` | `objects: write` |
| `.delete(id)` | `objects: delete` |
| `.publish(id)` `.unpublish(id)` | `objects: publish` |
| `.publishPreflight(id)` | `objects: publish` - the cascade plan, no write |
| `.schedule(id, at)` `.unschedule(id)` | `objects: publish` |

## Globals, media, search

```ts
const settings = (await tangen.globals('site_settings').get()).data.values
const assets   = await tangen.media.list({ limit: 20 })
const hits     = await tangen.search('pricing')
const locales  = await tangen.locales()
```

`tangen.media` is **read-only by design**: list, read, and build public asset
URLs. Uploading is a REST call, not an SDK method.

`tangen.knowledge` (`search`, `ask`, `askStream`) requires the `knowledge`
capability to be on server-side. `askStream` accepts an `AbortSignal`.

## Cancellation

Every method accepts `{ signal }`, a native `AbortSignal`. Aborting cancels the
request **and stops the retry loop**, so a cancelled read does not quietly
retry three more times.

```ts
const controller = new AbortController()
const p = tangen.objects('article').limit(50).get({ signal: controller.signal })
controller.abort()
```

## Errors

Every failure throws `TangenError`, carrying the server's code and status. See
[Errors](/reference/errors).

```ts
import { TangenError } from '@tangen/sdk'

try {
  await tangen.objects('article').create({ title: '' })
} catch (e) {
  if (e instanceof TangenError && e.code === 'VALIDATION_ERROR') {
    // e.fieldErrors names the offending fields
  }
}
```

## Links

```ts
import { isInternalLink, isExternalLink, isLinkResolved, linkSuffix } from '@tangen/sdk'
```

See [Link](/reference/link) for what these are for and why there is no
`hrefOf()`.

## Also exported

`pickVariant` and `getOrCreateVisitorId` for A/B experiments · the preview
helpers (`fetchPreviewObject`, `onLivePreview`, `isLivePreview`, and the
message-type constants) · the request observers (`observeRequests`,
`observeInFlight`, `parseServerTiming`) · the SSR timing collector
(`createSsrRequestCollector`, `renderSsrTimingsTag`).

## Not in the SDK

**Site authentication has no SDK surface.** Registering, logging in, refreshing
and reading the current site user are REST calls your application makes
directly. This is a known limitation, not an oversight, and the endpoints are
in [Authentication](/reference/authentication). Do not expect
`tangen.auth.login()` - it does not exist.

Media **uploads**, form **submissions** and schema operations are likewise REST
or CLI, not SDK.

## Related

- [TangenQL](/reference/tangenql) · [Errors](/reference/errors) ·
  [Authentication](/reference/authentication) ·
  [Delivery API](/reference/delivery-api) · [Link](/reference/link)
