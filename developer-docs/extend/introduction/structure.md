---
title: Extension structure
description: The files an extension has, which are required, and what each one is for.
audience: extension-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g7/hello
---

# Extension structure

```text
my-extension/
├── package.json
├── tangen.extension.ts      # required - the manifest, default export
└── src/
    ├── index.ts             # optional - the BROWSER entry: Admin components
    ├── server.ts            # optional - the SERVER entry: routes, hooks, tasks
    └── migrations.ts        # optional - ledgered SQL migrations
```

**Only the manifest is required.** An extension that declares a content type and
nothing else needs one file.

## `tangen.extension.ts`

The manifest, as the default export. It is **data**, not behaviour: ids,
versions, dependencies, and the *names* of things it contributes. It never
holds a function that renders UI.

```ts tangen.extension.ts
import type { TangenExtensionManifest } from '@tangen/cms'

export default {
  id: 'acme.reviews',
  name: 'Reviews',
  version: '1.0.0',
  server: './src/server.ts',
} satisfies TangenExtensionManifest
```

## `src/server.ts`

Server behaviour: routes, event subscriptions, queued tasks, content hooks,
custom field type servers, install and uninstall callbacks. Named in the
manifest's `server` field.

It runs on the server only. It must not import anything browser-facing, and
**nothing in it may run at import time**.

## `src/index.ts` — the browser entry

Admin components, as **named exports**. The manifest refers to them by name;
the Admin build resolves those names statically at build time.

```ts src/index.ts
export { ReviewPanel } from './components/ReviewPanel'
export { ReviewsPage } from './pages/ReviewsPage'
```

This entry must be **browser-safe**: no `node:` imports, no database, no
secrets. It ends up in the Admin bundle.

## `src/migrations.ts`

An ordered array of `{ id, sql }`. SQL only, so the checksum is the truth of
what ran.

## `package.json`

```jsonc
{
  "name": "@acme/tangen-reviews",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./server": "./src/server.ts"
  },
  "peerDependencies": { "@tangen/cms": "*" }
}
```

`@tangen/cms` is a **peer** dependency: the host project supplies it, and two
copies would mean two registries.

## The two-entry rule

Keeping the browser and server entries apart is not style. The browser entry is
bundled into the Admin and shipped to every editor's laptop; the server entry
holds your secrets and your database access. A single entry means one of those
two things is in the wrong place.

## Declaring it in a project

```ts app/config/extensions.ts
import { defineExtensions } from '@tangen/cms'

export default defineExtensions([
  { resolve: '@acme/tangen-reviews', options: { moderation: true } },
  { resolve: '../../extensions/my-local-extension' },
])
```

`resolve` is an npm package name or a path in the project. Declaring makes it
**available**; installing and enabling are separate, per-deployment acts.

## Related

- [Your first extension](/extend/introduction/first-extension) ·
  [Writing a manifest](/extend/contract/manifest) ·
  [Extension manifest reference](/reference/extension-manifest)
