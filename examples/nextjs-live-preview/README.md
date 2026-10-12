# Tangen × Next.js — Live Preview demo

A minimal Next.js (App Router) front-end for a Tangen site — lists **posts**, renders a
**post**/**page** by slug, and demonstrates **live preview**:

- **Tier 1 — draft preview.** The admin's *Preview* button opens `/preview?id=…&type=…&preview_token=…`;
  this site fetches the unpublished draft behind that short-lived token and renders it.
- **Tier 2 — live editing.** When that page is framed inside the admin's preview pane, it
  subscribes to the admin's `postMessage` stream and re-renders as you type — no save, no reload.
  (Because the AI assistant writes into the same field state, AI edits preview live too.)

> **Not Payload.** Tangen is a *separate* headless backend — this front-end is just one example.
> The preview contract is plain **REST** (`GET /api/v1/preview/object/:id`) + **postMessage**, and
> the SDK helpers (`fetchPreviewObject`, `onLivePreview`) are framework-agnostic vanilla functions.
> The same ~30 lines work in **Nuxt, SvelteKit, Astro, Remix, or plain JS**.

## 1. Configure Tangen (enables preview)

Preview is **enabled by config**: set `frontend.previewUrl` on the environment in your Tangen
`tangen.config.ts` (the value comes from `.env`). When it's set, the admin shows the Preview button.

```ts
// tangen.config.ts — environments.development
frontend: {
  url: process.env.FRONTEND_URL,                 // e.g. http://localhost:4321
  previewUrl: process.env.FRONTEND_PREVIEW_URL,  // e.g. http://localhost:4321/preview?id={id}&type={type}
}
```

```sh
# Tangen project .env
FRONTEND_URL=http://localhost:4321
FRONTEND_PREVIEW_URL=http://localhost:4321/preview?id={id}&type={type}
```

The `{id}` / `{type}` placeholders are filled by the admin; the preview token is appended
automatically. Setting `frontend.url` also allow-lists this origin for CORS.

## 2. Configure this site

```sh
cp .env.example .env.local
```

```sh
NEXT_PUBLIC_TANGEN_API_URL=http://localhost:3000          # your Tangen API (no /api/v1)
TANGEN_API_KEY=key_…                                       # a published-read API key (admin → API Keys)
NEXT_PUBLIC_TANGEN_ADMIN_ORIGIN=http://localhost:5173      # your Tangen ADMIN origin (postMessage trust)
TANGEN_WORKSPACE_ID=wsp_…                                  # where published pages are delivered from
TANGEN_ENV=env_development                                 # and from which environment
```

`TANGEN_WORKSPACE_ID` and `TANGEN_ENV` are public **routing** identifiers, not credentials -
a published page is public by definition. They are kept server-side anyway, because there is
no reason to print them in page source and proxying keeps delivery same-origin.

`NEXT_PUBLIC_TANGEN_ADMIN_ORIGIN` is **security-critical** — only postMessage from this origin is
trusted for live updates. Never trust a URL param for it.

## 3. Run

```sh
npm install        # pulls @tangen/sdk (see .npmrc → your registry)
npm run dev        # http://localhost:4321
```

Inside this monorepo the site runs against the packages in `packages/` rather
than a registry. It is not a workspace member (it models a standalone site and
keeps its own lockfile), so neither `bun install` here nor a root install can
resolve its `workspace:*` dependencies. `bun run dev` and `bun run build` link
them first, through `bun run link:workspace`; run that by hand after adding a
`workspace:*` dependency if your editor resolves modules before the dev server
starts. Without it Next.js reports `Module not found: Can't resolve
'@tangen/<name>'` and nothing says why.

- Browse posts at `/`, a post at `/posts/<slug>`.
- In the Tangen admin, open a draft post → **Preview** → this site renders the draft; type in a
  field and watch it update live in the docked pane.

## How it maps to the SDK

```ts
import { fetchPreviewObject, onLivePreview } from '@tangen/sdk'

// Tier 1: render the draft behind the token
const draft = await fetchPreviewObject({ apiUrl, id, type, token })

// Tier 2: live updates while editing (origin-verified)
const off = onLivePreview((obj) => setEntry({ ...obj, ...obj.values }), { allowedOrigin: ADMIN_ORIGIN })
```

Published reads use the typed client: `createClient({ apiUrl, apiKey }).objects('post').status('published').get()`.
GraphQL works too (`POST /api/v1/graphql`) if you prefer it.

## The post list is live (realtime)

`/` wraps the server-rendered list in `components/LivePosts.tsx`, a client
component that subscribes to `objects:post` and calls `router.refresh()` when a
post is published, unpublished or deleted. Realtime signals, it does not
replicate: the event carries the id and what changed; the page refetches
through the same REST path it rendered from.

```ts
const realtime = createRealtimeClient({ apiUrl, mintTicket })     // @tangen/realtime
useRealtimeEvent('objects:post', () => router.refresh())          // @tangen/realtime-react
```

`mintTicket` POSTs to this site's own `app/api/realtime-ticket/route.ts`, which
mints the single-use ticket with the server-only `TANGEN_API_KEY`; the browser
never sees the key, and the connection may hear exactly what the key may read
(a read key hears `object.published`; add `objects:read_draft` to also hear
`object.updated`). No connection opens until the list mounts, and it closes a
few seconds after the last subscriber leaves. Guide: `docs/realtime.md`.

## Published Studio pages come from the Delivery Layer

`/pages/<slug>` does **not** read the authoring API. It resolves the route through the
platform's delivery route and renders the immutable artifact it names:

```ts
import { resolvePage } from '@tangen/studio-runtime'
import { StudioPage } from '@tangen/studio-react'

const page = await resolvePage(API_URL, { route, workspace, env })   // server to server
return <StudioPage page={page} baseUrl="" mount="/api/studio-delivery/" />
```

Two requests, and the split is the point: the route pointer is the only thing a publish
moves, so it is revalidated, and the versioned artifact it names can be cached forever.
Publishing in Studio therefore changes what this site serves with **no rebuild and no
redeploy** - and because delivery is a platform route rather than an extension one, a
disabled Studio cannot take a published page down.

`/api/studio-delivery/*` is a thin same-origin proxy that adds the workspace and
environment. It exists for the browser: a `<link>` in page source would otherwise have to
spell them out. Upstream cache headers pass straight through.

A page with no artifact yet falls back to the CMS read, so content published before the
cutover still renders.

`/api/studio-styles` serves the published workspace stylesheet the same way, for surfaces
that render Studio blocks without a page artifact behind them (live preview, a post body).
It used to call `/api/v1/ext/studio/styles` with the API key; that extension route still
answers for compatibility but is **deprecated** and sends a `Deprecation` header.

## Verifying a build while `next dev` is running

`next build` writes into `.next`, which is the directory a running dev server
is serving from - it replaces the chunks underneath it and every page fails
with `Cannot find module './NNN.js'`. Build into a separate directory instead:

```sh
NEXT_DIST_DIR=.next-verify npx next build
```
