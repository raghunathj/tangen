---
title: Extension manifest
description: "Manifest v1: every field, what it declares, and how config, secrets, migrations and dependencies work."
audience: extension-developer
type: reference
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-16
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Extension manifest

An extension is a package with a `tangen.extension.ts` at its root. The
manifest **declares** what the extension contributes; nothing in it runs at
import.

```ts tangen.extension.ts
import type { TangenExtensionManifest } from '@tangen/cms'

export default {
  id: 'acme.reviews',
  name: 'Reviews',
  version: '1.0.0',
  description: 'Customer reviews on any content type.',

  requires: {
    capabilities: ['media'],
    extensions: [{ id: 'acme.core', version: '^1' }],
  },
  optional: {
    extensions: ['acme.analytics'],
    services: ['acme.analytics.events@^1'],
  },
  provides: {
    services: ['acme.reviews.moderation@1'],
  },
  grants: {
    required: ['content:read', 'content:update:types(review)', 'db:own'],
    optional: ['ai:generate'],
  },

  config: {
    moderation: { type: 'boolean', label: 'Hold reviews for moderation', default: true },
    webhookUrl: { type: 'string', label: 'Notify URL', required: false },
    apiToken:   { type: 'string', label: 'API token', secret: true },
  },
  secrets: ['ACME_REVIEWS_KEY'],
  migrations: './src/migrations.ts',

  server: './src/server.ts',
} satisfies TangenExtensionManifest
```

## Identity

| field | type | required | means |
|---|---|---|---|
| `id` | `string` | **yes** | globally unique, `[a-z0-9][a-z0-9._-]*`. Namespace it: `acme.reviews` |
| `name` | `string` | **yes** | what an operator sees |
| `version` | `string` | **yes** | the extension's own version |
| `description` | `string` | no | one line |
| `contract` | `1` | no | the framework contract the extension is written against. `1` means every server surface it uses receives an execution and a client bound to it (`ctx.exec`, `ctx.tangen`), its capabilities may declare `gates`, its routes may declare `access` and `authority`, and it imports nothing from the internal set ([Public contract](/reference/public-contract)) |

## Dependencies

```ts
requires: {
  capabilities: ['media', 'search'],
  extensions: [{ id: 'acme.core', version: '^1' }],
},
optional: { extensions: ['acme.analytics'] },
```

| field | means |
|---|---|
| `requires.capabilities` | runtime capability ids that must be **available** in the process - `media`, `search`, `mail`, `knowledge`, `redis`, `realtime`, `scheduler`, `webhooks`, and the rest. **One missing makes the extension `unavailable` with a safe reason, and it never starts** |
| `requires.extensions` | extensions that must be installed **and enabled in the same workspace**. A dependency is `'id'` or `{ id, version }` |
| `optional.extensions` | used when present, and the extension works without them |
| `requires.services` | typed services another extension must provide here, as `<ns>.<name>@<range>` (`seo.service@^1`). No active provider whose declared major satisfies the range → your extension is `blocked`, with the reason naming the service |
| `optional.services` | typed services used when present; `ctx.services.get` answers `undefined` otherwise, and the missing ones are reported as `service:<ref>` |
| `provides.services` | the typed services you offer, in your own namespace with a bare major (`acme.reviews.moderation@1`); fulfil each from `onStart` with `ctx.services.provide(ref, impl)`. Providing one you did not declare is refused |

A required capability that is `off` or `unavailable` is not an error you can
catch - the extension simply does not become active there, and the reason says
which one.

## Grants

```ts
grants: {
  required: [
    { grant: 'content:read', reason: 'Reads reviews to moderate them' },
    { grant: 'content:update:types(review)', reason: 'Flags and hides reviews' },
    'db:own',
  ],
  optional: [
    { grant: 'ai:generate', reason: 'Drafts replies with your AI provider', enables: 'AI replies' },
  ],
},
```

Say **why** for every grant that reads or changes platform data (MEDIUM and
HIGH tiers): the reason is shown to the person installing your extension,
in `inspect`, and in the Admin, exactly as you wrote it; a missing one is a
validation warning. An optional grant's `enables` names the feature so a
denial reads "AI replies disabled" rather than a grant id.

`grants` is the authority your extension **runs with** off a route - in event
handlers, in tasks that say `runAs: 'extension'`, in lifecycle hooks. It is
not `requires` (what must exist for the extension to start) and not
`permissions` (the capabilities you define for the roles editor).

| field | means |
|---|---|
| `grants.required` | REQUIRED with a `server` entry (the validator refuses a server entry without a `grants` block; an empty list means it needs none, and holds none): what the extension cannot work without. Declaring it binds those surfaces to an actor that holds exactly these grants and never an administrator's authority: reads see the published web unless the query asks for drafts and `content:read:draft` is held; writes need `content:create` / `content:update` / `content:publish` / `content:delete`, optionally scoped `:types(a,b)` |
| `grants.optional` | grants that unlock more when approved; the extension must work without them |

The grant language is `<family>:<verb>[:<scope>(a,b)]`: `content:*` (with
`types(...)` for a type list and `fields(...)` for a field allow-list -
`content:update:fields(seo.*)` may write every field of the `seo` group and
nothing else; a write naming another field, `title` included, is refused
with a 403 that names it), `media:read|write|delete`, `globals:read|write[:names(...)]`,
`search:read[:audiences(internal)]`, `webhooks:*`, `tables:read`,
`schema:pull`, `locales:all` or `locales:en,fr`, `capability:<id>` for a role
capability, and facility grants such as `db:own`, `ai:generate`,
`jobs:enqueue`, `network:<host>` and `connections:<id>` that gate what `ctx`
hands you. `network:api.example.com` opens `ctx.http` to that host
(`network:*.example.com` for its subdomains, `network:localhost:8080` with a
port); a host that resolves to a private address stays refused unless
`network:private` is held. `secrets:<name>` opens a platform-wide secret to
`ctx.secrets` - your own declared `secrets` need no grant. The other
facilities follow the same rule: `db:own` opens `ctx.db`, `ai:generate`
opens `ctx.ai`, `jobs:enqueue` opens `ctx.enqueue` and `ctx.tangen.enqueue`,
`events:emit` opens `emit`, `delegation:act-as` opens `ctx.resolveActor`.
Without the grant the facility is absent from `ctx`, or refuses with a 403
that names the grant. `ctx.store` (your own storage) needs no grant. A grant the platform does not know fails validation; a privileged
one (`db:platform`, `network:any`, `secrets:any`, `schema:push`) validates
with a warning and can only be approved by a trusted install, never from a
marketplace.

Omit `grants` and the extension keeps the authority it has today.

## Configuration

```ts
config: {
  moderation: { type: 'boolean', label: 'Hold for moderation', default: true },
  apiToken:   { type: 'string',  label: 'API token', secret: true },
},
```

| key | type | means |
|---|---|---|
| `type` | `'string' \| 'number' \| 'boolean' \| 'string[]' \| 'json'` | **required** |
| `label`, `description` | `string` | what the Admin shows |
| `required` | `boolean` | install and upgrade fail without it |
| `default` | `unknown` | used when the value is absent |
| `secret` | `boolean` | **the value is a credential: redacted in logs and diagnostics, and never echoed back** |

Declaring config is what lets the platform validate the options at install and
upgrade, show them in the Admin, and know which ones never to print.

Values are supplied per workspace, in `app/config/extensions.ts`:

```ts
export default defineExtensions([
  { resolve: '@acme/tangen-reviews', options: { moderation: false } },
])
```

## Secrets

Two different things, and the distinction matters:

| | where it lives | for |
|---|---|---|
| `config` with `secret: true` | the workspace's extension options, in the database | a per-workspace credential an operator enters in the Admin |
| `secrets: ['ACME_REVIEWS_KEY']` | **the process environment** | a deployment-wide credential |

## Deployment roles

```ts
deploymentRoles: ['development'],            // a developer tool
deploymentRoles: ['development', 'staging'], // never in production
```

The deployment **roles** the extension may be active on; omit it to allow
every deployment. `tangen extension install` and `enable` refuse a
deployment of another role, boot never adopts the extension there, and the
activation gate answers `not-permitted` for any row that slips through - so
the extension contributes nothing observable on that deployment, whatever
the rows say. Its config keys stay declared; nothing it declares is required
where it is not active.

`secrets` is a list of deployment variable **names** the server entry reads.
Declaring them means the platform knows they are credentials; it never reads
their values into anything it might log. Nothing in the manifest ever contains
a secret's value.

## Migrations

```ts src/migrations.ts
import type { ExtensionMigration } from '@tangen/cms'

export default [
  { id: '0001_create_reviews', sql: `CREATE TABLE IF NOT EXISTS acme_reviews (...)` },
] satisfies ExtensionMigration[]
```

| field | means |
|---|---|
| `id` | stable, ordered by position, **never renamed after it has run** |
| `sql` | SQL only, so its checksum is the truth of what ran |

They run **in declared order at INSTALL and UPGRADE**, each in its own
transaction, recorded in the platform's ledger with a checksum. They never run
at import, REGISTER, ENABLE or START.

Rules: never edit or reorder one that has run · write them idempotently
(`IF NOT EXISTS`) · prefix your tables · scope every row by `workspace_id`.
**No runtime DDL, ever** - an extension does not create a table
outside this mechanism.

An extension whose migrations are pending is **not active**, and the
reason says so.

## Contributions

| field | contributes |
|---|---|
| `capabilities` | capability definitions the extension provides. A definition may name the platform `gates` it opens (`gates: ['content.rawCss']` lets a holder write raw CSS on a block), so the platform never names an extension's capability itself |
| `fieldTypes` | custom field types, inheriting a built-in primitive |
| `contentTypes` | content types the extension owns |
| `customTables` | tables planned and created by `tangen push` |
| `sidebarPanels` | panels beside the content editor |
| `pages` | Admin pages |
| `routes` | HTTP routes under the extension's mount. A route may declare `access` (the same `{ roles?, capability? }` rule a page uses, decided on the server) and, for a `public` route, `authority` (the grants its `ctx.tangen` holds; default: read published content) |
| `commands` | CLI commands |
| `dashboardWidgets` | dashboard widgets |
| `contentHooks` | `beforeChange`, `afterChange`, `beforeDelete`, `afterDelete` |
| `realtime.channels` | realtime channels |
| `versionedData` | whether the extension's per-object data is versioned with the object |
| `server` | path to the server entry |
| `onInstall`, `onUninstall` | non-schema setup and advisory cleanup. **They receive the workspace only - no database handle** |

## Distribution

An extension reaches a project by `resolve` in `app/config/extensions.ts`:
either an **npm package name** or a **path inside the project**.

Some first-party Tangen extensions are not currently published as packages, so
they cannot be installed by name from an external project. Do not assume a
first-party extension is installable because it exists.

## Related

- [Extension lifecycle](/reference/extension-lifecycle) ·
  [Permissions](/reference/permissions) ·
  [Configuration](/reference/configuration) ·
  [Public contract](/reference/public-contract)
