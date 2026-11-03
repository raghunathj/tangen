# @tangen/nextjs

Next.js helpers for a Tangen frontend: published and draft rendering from one
set of routes, plus the toolbar's SSR timings relay.

**This is not the client.** Content is read with `@tangen/sdk`, which is
framework-free; this package holds only the pieces that need Next itself.

## Install

```sh
bun add @tangen/nextjs
```

## Published and draft from the same page

A read's lifecycle view is one argument. An API key serves the published web by
default, and serves drafts only when it asks for them AND holds the objects
`read_draft` grant, so the two views are the same query with a different
status:

```ts
import { previewStatus } from '@tangen/nextjs'

const { data } = await tangen.objects('page')
  .where({ path })
  .status(await previewStatus())   // 'draft' while previewing, else 'published'
  .limit(1)
  .get()
```

`previewStatus()` reads Next's own draft mode, which the preview route below
turns on. Outside a Next request context it answers `published`, so a script or
a test renders the live site rather than throwing.

Published reads serve the snapshot frozen at publish time and 404 an
unpublished row, so a draft can never leak into the published view. A draft
read serves the live column values and carries `hasDraftChanges`, which is what
a "newer than published" banner reads.

### Use two keys

Draft access belongs to the key, not to the cookie. Give the draft key the
`read_draft` grant and use it **only** when previewing; leave your everyday key
without it:

```ts
// lib/tangen.ts
import { createClient } from '@tangen/sdk'
import { isDraftMode } from '@tangen/nextjs'

const published = createClient({ apiUrl: process.env.TANGEN_API_URL!, apiKey: process.env.TANGEN_API_KEY!, retries: 2 })
const draft = createClient({ apiUrl: process.env.TANGEN_API_URL!, apiKey: process.env.TANGEN_DRAFT_API_KEY!, retries: 2 })

export async function tangen() {
  return (await isDraftMode()) ? draft : published
}
```

Both keys are server-side only. Never prefix either with `NEXT_PUBLIC_`.

One key with `read_draft` also works, and the API still refuses a draft read to
a key without the grant. Two keys buy one thing: the everyday key *cannot*
read a draft even if site code passes a status through from somewhere it
should not, so the boundary holds without depending on the site being careful.

## The preview route

`createPreviewHandler` takes three options, all required:

| Option | What it is |
| --- | --- |
| `apiUrl` | The Tangen API origin, e.g. `https://cms.example.com`. The handler appends `/api/v1/...` itself. |
| `secret` | A Tangen API key (`tgn_...`) with read access. Despite the name it is a credential, not a shared secret you invent: it is sent as `Authorization: Bearer`, and an arbitrary string is refused with a 401. Server-side only. |
| `redirect` | Given the request, returns the path to send the browser to once draft mode is on. |

```ts
// app/api/preview/route.ts
import { createPreviewHandler } from '@tangen/nextjs'

export const GET = createPreviewHandler({
  apiUrl: process.env.TANGEN_API_URL!,
  secret: process.env.TANGEN_API_KEY!,
  redirect: (req) => {
    const { searchParams } = new URL(req.url)
    // The admin sends id and type when the previewUrl template names neither.
    return `/preview?id=${searchParams.get('id') ?? ''}&type=${searchParams.get('type') ?? ''}`
  },
})
```

The handler validates the token against the API, enables Next draft mode,
stores the token in an `HttpOnly` cookie and answers a 307 to `redirect(req)`.
It reads the token from `preview_token` (the name the admin's Preview button
appends) or from `token`.

The exit route exports the handler itself, with no call:

```ts
// app/api/preview/disable/route.ts
import { disablePreview } from '@tangen/nextjs'

export const GET = disablePreview
```

`disablePreview()` would run the handler at module scope with no request.

Point `frontend.previewUrl` in the CMS at this route for the Preview button to
open it.

**What the cookie is worth knowing about:** a preview token is minted for one
object id, while draft mode is a whole-session flag. Treating a valid token as
"this session may browse drafts" is therefore broader than the token's own
scope, which is why the grant on the key is the real gate. `getPreviewToken()`
returns the stored token for the narrower read below.

## One object, with live keystrokes

Inside the admin's preview pane there is a second path, and it is the one
`docs/live-preview.md` documents and `examples/nextjs-live-preview/` ships:
read the token from the URL and fetch that one object's draft with
`@tangen/sdk`, which also subscribes to the editor's unsaved edits.

```ts
import { fetchPreviewObject, onLivePreview } from '@tangen/sdk'

const draft = await fetchPreviewObject({ apiUrl, id, type, token })
```

It serves one object by id, masked to the field-level view of whoever minted
the token, with media expanded and links resolved editorially. Use it for
in-context preview; use `previewStatus()` above to browse a whole draft site.

## SSR timings

The Tangen Toolbar shows which SDK requests a server render made. Render the
relay once, late in the root layout's `<body>`:

```tsx
// app/layout.tsx
import { TangenSsrTimings } from '@tangen/nextjs'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {process.env.NODE_ENV !== 'production' && <TangenSsrTimings />}
      </body>
    </html>
  )
}
```

It is a development tool. Gate it the way you gate the toolbar.

## License

MIT
