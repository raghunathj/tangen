---
title: Preview
description: Showing draft content on your frontend without leaking it.
audience: site-developer
type: guide
status: stable
package: "@tangen/sdk"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g8/preview
---

# Preview

An editor clicks Preview in the Admin and lands on **your** site showing the
draft. Three things make that work, and one of them is a credential you must
handle carefully.

## The flow

```text
Admin  ──mints a token──►  opens frontend.previewUrl with ?token=…&id=…&type=…
                                        │
Your frontend  ──GET /preview/object/:id with X-Tangen-Preview-Token──►  Tangen
                                        │
                            the draft object, no-store
```

The Admin mints the token; your frontend spends it. **Your frontend never mints
one** - minting needs a member session.

## Configure where Preview lands

```ts tangen.config.ts
{
  frontend: {
    url: 'http://localhost:4321',
    previewUrl: 'http://localhost:4321/preview?id={id}&type={type}&slug={slug}',
    previewUrls: {
      article: 'http://localhost:4321/blog/{slug}?preview=1&id={id}',
    },
  },
},
```

`{id}`, `{type}` and `{slug}` are substituted. `previewUrls` overrides per type
and falls back to `previewUrl`.

## Read the draft

```ts app/routes/preview.ts
import { fetchPreviewObject } from '@tangen/sdk'

const draft = await fetchPreviewObject({
  apiUrl: process.env.TANGEN_API_URL!,
  id, type, token,
  locale,                       // optional
})

if (!draft) {
  // token missing, expired, or scoped elsewhere - do not fall back to published
  return notFound()
}
```

It returns the object with media expanded and links resolved, or `null` on any
failure.

## Securing it

The token is a **draft-read credential**. Anyone holding it reads unpublished
content until it expires.

**Do this:**

- Read the token from the request on the **server**, use it there, and never
  send it to the browser.
- Set a short TTL. An editor previewing one article needs minutes, not a day.
- Prefer object-scoped tokens, which read that object and nothing else.
- Keep the preview route out of your sitemap, and return `X-Robots-Tag:
  noindex` from it.
- Fail closed. If the token is bad, render not-found - never the published
  version, which quietly makes preview look like it worked.

**Do not:**

- Put the token in a client-side bundle, a cookie readable by JavaScript, or a
  URL you log.
- Cache a preview response, or use it to warm a published cache. Tangen serves
  these `no-store` and so should you.
- Reuse one long-lived token as "the preview key".

## Caching

Preview responses are `no-store`. If your framework caches routes by default,
opt this route out - Next.js `export const dynamic = 'force-dynamic'`, or your
framework's equivalent. A cached draft is a leak with a long tail.

## Live preview

`onLivePreview` subscribes to changes as an editor types, so an iframe
re-renders without a fetch:

```ts
import { onLivePreview, isLivePreview } from '@tangen/sdk'

if (isLivePreview()) {
  onLivePreview({ onUpdate: (object) => render(object) })
}
```

Guard it with `isLivePreview()` so the listener does not run on the public site.

## Errors

| you get | means |
|---|---|
| `null` from `fetchPreviewObject` | any failure: no token, expired, wrong scope |
| `401 UNAUTHORIZED` | the header was missing or the token is not live |

Preview needs **Redis**, which is where tokens live with their expiry.

## Common mistakes

- **Falling back to published on a failed token.** The editor sees a stale page
  and believes it.
- **Rendering the token into HTML.**
- **Caching the preview route.**
- **Expecting an API key to read `/preview/object/:id`.** The header is the only
  credential that route accepts.

## Related

- [Preview reference](/reference/preview) - TTLs, scoping, the four endpoints
- [Configuration reference](/reference/configuration) - `previewUrl`
- [Drafts and publishing](/build/content/publishing) ·
  [Frontend integration](/build/frontend)
