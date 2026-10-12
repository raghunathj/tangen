---
title: Using the SDK
description: Configuring the client, cancelling requests, handling errors, and what the SDK does not do.
audience: site-developer
type: guide
status: stable
package: "@tangen/sdk"
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-f/northwind#sdk
---

# Using the SDK

```ts app/lib/tangen.ts
import { createClient } from '@tangen/sdk'

export const tangen = createClient({
  apiUrl: process.env.TANGEN_API_URL!,
  apiKey: process.env.TANGEN_API_KEY!,
  timeoutMs: 10_000,
  retries: 2,
})
```

One client per process. Creating one per request throws away nothing important
but is pointless.

`retries` adds attempts for 429, 502, 503, 504 and network failures. It does
**not** retry a 4xx that is your fault.

## Browser or server

The root entry is browser-safe - it imports no `node:` module. But **the API key
is not**: a key in a browser bundle is a public key. Read on the server and pass
data down.

`@tangen/sdk/node` holds the Node and Bun SSR helpers.

## Cancelling

```ts
const controller = new AbortController()
const promise = tangen.objects('article').limit(50).get({ signal: controller.signal })
controller.abort()
```

Aborting cancels the request **and stops the retry loop**, so a cancelled read
does not quietly retry three more times. Every method takes `{ signal }`.

## Errors

```ts
import { TangenError } from '@tangen/sdk'

try {
  await tangen.objects('article').create({ title: '' })
} catch (e) {
  if (e instanceof TangenError) {
    if (e.code === 'VALIDATION_ERROR') return showFieldErrors(e.fieldErrors)
    if (e.code === 'NOT_FOUND') return notFound()
    if (e.code === 'FORBIDDEN') return serverError('key is missing an action')
  }
  throw e
}
```

Switch on `code`, never on the message.

## Globals, media, search

```ts
const settings = (await tangen.globals('site_settings').get()).data.values
const assets   = await tangen.media.list({ limit: 20 })
const hits     = await tangen.search('pricing')
const locales  = await tangen.locales()
const maps     = await tangen.extensionSettings('maps')   // an extension's settings marked public, e.g. a Maps browser key
```

`tangen.media` is read-only. Uploading is a REST call.

## What the SDK does not do

**Site authentication.** There is no `tangen.auth`. Registering, logging in,
refreshing and reading the current site user are REST calls your application
makes with `fetch`. See [Site authentication](/build/auth).

Media **uploads**, form **submissions** and schema operations are also REST or
CLI.

## Related

- [SDK reference](/reference/sdk) · [Errors](/reference/errors) ·
  [Site authentication](/build/auth) · [Query troubleshooting](/build/querying/troubleshooting)
