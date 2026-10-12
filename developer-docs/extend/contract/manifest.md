---
title: Writing a manifest
description: Authoring a manifest that installs, with the decisions that matter.
audience: extension-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g7/hello
---

# Writing a manifest

Every field, with its type, is in
[Reference → Extension manifest](/reference/extension-manifest). This page is
about the choices.

```ts tangen.extension.ts
import type { TangenExtensionManifest } from '@tangen/cms'

export default {
  id: 'acme.reviews',
  name: 'Reviews',
  version: '1.0.0',
  description: 'Customer reviews on any content type.',
  author: 'Acme Inc',
  homepage: 'https://acme.example/reviews',
  license: 'MIT',

  requires: { capabilities: ['media'] },

  config: {
    moderation: { type: 'boolean', label: 'Hold reviews for moderation', default: true },
    webhookUrl: { type: 'string', label: 'Notify URL' },
  },
  secrets: ['ACME_REVIEWS_KEY'],
  // deploymentRoles: ['development', 'staging'],   // omit: every deployment
  migrations: './src/migrations.ts',

  capabilities: [
    { id: 'reviews:read', label: 'View reviews' },
    { id: 'reviews:moderate', label: 'Moderate reviews', implies: ['reviews:read'] },
  ],

  server: './src/server.ts',
  pages: [{ path: '', component: 'ReviewsPage', nav: { label: 'Reviews', icon: 'IconStar' } }],
  sidebarPanels: [{ id: 'reviews', label: 'Reviews', component: 'ReviewPanel', types: ['product'] }],
} satisfies TangenExtensionManifest
```

## Choose the id once

`id` is `[a-z0-9][a-z0-9._-]*` and it is **forever**. It is the install
identity, the route prefix (`/api/v1/ext/<id>/`), the page path
(`/extensions/<id>`), the capability id (`ext:<id>`), and the key in an
operator's install state.

**Namespace it**: `acme.reviews`, not `reviews`. A bare noun will collide.

Changing it later is not a rename - it is a different extension, and the old
one's data stays behind.

## Version means something

`version` drives UPGRADE. Bump it when you ship, because that is what makes new
migrations run.

## Say who wrote it

`author`, `homepage` and `license` are what an operator reads on
**Settings > Extensions** before trusting your extension: the table shows the
author with the website as a link, and the sheet shows the licence beside
them. All three are optional and none is guessed at - an undeclared one reads
"Not declared".

`homepage` is rendered as a link, so it must be an `http(s)` URL; anything
else fails manifest validation rather than reaching a browser.

That screen also compares the version a workspace RUNS with the one your
package ships (an upgrade the operator runs) and, on request, with your
package's `dist-tags.latest` at the registry (an update they install). Both
read the version from this manifest, so keep it in step with your
`package.json`.

## Declare capabilities the roles editor can see

`capabilities` are **RBAC capabilities your extension defines** - not runtime
capabilities you require. They appear in the roles editor for workspaces where
you are installed, and your routes and pages gate on them.

Ids are namespaced `scope:name`. `implies` saves an operator ticking two boxes:

```ts
{ id: 'reviews:moderate', label: 'Moderate reviews', implies: ['reviews:read'] }
```

## Components are names, not functions

`pages[].component` and `sidebarPanels[].component` are the **names of named
exports** of your browser entry. The Admin build resolves them statically.

The manifest is data. It is read by the CLI, the server and the Admin build, and
a function value in it cannot survive any of those.

## Panels: scope them

```ts
sidebarPanels: [{ id: 'reviews', label: 'Reviews', component: 'ReviewPanel', types: ['product'] }]
```

Omitting `types` shows the panel on **every** content type. Editors of every
type will see it, including the ones it makes no sense for. List the types.

## Content types and tables

| you want | declare |
|---|---|
| content editors manage in the Admin | `contentTypes` |
| tables `tangen push` plans and creates | `customTables` |
| tables you evolve yourself with SQL | `migrations` |

Do not reach for `migrations` when `customTables` fits - a declared table is
planned, reported and drift-checked.

## Validate it

```bash
bun run tangen extension install acme.reviews
```

An invalid manifest fails here, naming the field. Required config with no value
fails at install too, which is where you want it.

## Related

- [Extension manifest reference](/reference/extension-manifest) ·
  [Capabilities and dependencies](/extend/contract/capabilities) ·
  [Admin contributions](/extend/contributions/admin) ·
  [Configuration](/extend/data/configuration)
