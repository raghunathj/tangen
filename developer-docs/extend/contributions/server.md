---
title: Server contributions
description: Every supported server-side surface an extension can contribute.
audience: extension-developer
type: reference
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-16
verification: executable
verifiedBy: stage-g7/crm
---

# Server contributions

Your server entry's default export declares these. All of them are optional.

| contribution | key | what it does |
|---|---|---|
| **Routes** | `adminRoutes` | HTTP endpoints. See [Server routes](/extend/contributions/routes) |
| **Content hooks** | `contentHooks` | `beforeChange`, `afterChange`, `beforeDelete`, `afterDelete` on content writes |
| **Event subscriptions** | `events` | platform events such as `object.published` |
| **Queued tasks** | `tasks` | durable background work, namespaced `ext:<id>:<name>` |
| **Publish policy** | `publishPolicy` | stand between a type and publication |
| **Custom field servers** | `fieldTypes` | validation and coercion for your field types |
| **Webhook triggers** | `webhookTriggers` | events site developers can subscribe webhooks to |
| **Search providers** | `searchProviders` | contribute results to search, per audience |
| **Porter providers** | `porterProviders` | rows your extension exports and imports; each call gets your own store as `scope.store` (on import, `ctx.store`) and the `db` handle only under `db:own` |
| **Flow triggers and actions** | `flowTriggers`, `flowActions` | usable in Flows where that extension is present |
| **MCP tools** | `mcpTools` | tools exposed over MCP, where that capability is on |
| **Lifecycle callbacks** | `onInstall`, `onStart`, `onStop`, `onUpgrade`, `onUninstall`, `onDispose` | see [The lifecycle in practice](/extend/contract/lifecycle) |

Every one is called **only for workspaces where the extension is installed**.

Some of these depend on a capability being available - `mcpTools` needs MCP,
`flowActions` needs the Flows extension. Declare the dependency, or degrade.

## Content hooks

A hook of an extension whose manifest declares `settings` also gets `ctx.settings.get()` (E.7), the same values its routes read.

```ts
export default {
  contentHooks: {
    afterChange: async (ctx) => {
      if (ctx.statusChange?.to !== 'published') return
      // …
    },
  },
} satisfies TangenExtensionServer
```

`beforeChange` and `beforeDelete` may **throw to abort**. `afterChange` and
`afterDelete` may not - their errors are logged, not surfaced.

Extension hooks run **before** site hooks, in install order. A site hook can
rely on yours having written already.

## Events

```ts
events: [
  {
    types: ['object.published', 'object.unpublished'],
    handler: async (event, ctx) => { /* … */ },
  },
],
```

`types` is a list of event type names, or `'*'` for everything. Subscribe
narrowly: `'*'` means your handler runs on every write in the workspace.

Handlers are for **reacting**, not for gating. To refuse a write, use a content
hook or `publishPolicy`.

## Queued tasks

```ts
tasks: [
  {
    name: 'reindex',
    description: 'Rebuild the review index',
    handler: async (payload, ctx) => { /* … */ },
  },
],
```

Namespaced as `ext:<extensionId>:reindex`. Durable: a task survives a restart
and is retried according to the platform's queue semantics. Use one for
anything slow, so a request does not wait on it.

## Publish policy

```ts
publishPolicy: async (ctx, input) => {
  // input: { typeName, objectId? }
  // return a refusal to stand between this type and publication
},
```

Called only for workspaces where you are installed. This is how a review
workflow gates publishing.

## Webhook triggers

`webhookTriggers` declares events a **site developer** can point a webhook at,
so your extension's happenings become part of their integration surface.

## Filters

`filters` registers transforms against a point another extension or the
platform runs:

```ts
filters: [
  { point: 'content.beforeWrite@^1', when: { contentType: 'review' }, priority: 50,
    transform: (record, c) => { if (typeof record.body === 'string') record.body = record.body.trim() } },
],
```

`content.beforeWrite@1` runs on every create and update (the record about to
be written, after content hooks, before validation) in draft mode: mutate
the record you are handed. `priority` orders (ascending), `when` narrows by
`contentType` and `locale`, and a transform that throws or takes longer than
`timeoutMs` (1000 ms) is skipped with a warning attributed to you - the write
continues. `content.validate@1` runs on every save and every publish: return
`{ fields: { path: message }, record: [message] }` (or nothing) and the
platform merges every extension's findings into its normal validation
error - field messages inline, record messages in the banner; `c.phase` tells
you whether this is a save or a publish, so a publish-only rule is one
condition. `content.publish@1` runs over the snapshot about to be published:
mutate it, or return `Filters.REJECT('why')` (from `@tangen/cms`) to veto the
publish with an error attributed to you. The Admin runs it as a dry run too
(`c.dryRun === true`: decide, do not act), so the veto shows on the Publish
button before anyone clicks - prefer it over `publishPolicy`, which is
deprecated onto this point. `content.serialize@1` runs over the
rows every read returns - REST, the content client, GraphQL - so a computed
field or a redaction reaches every transport once; `content.beforeDelete@1`
runs over the row about to be deleted and `Filters.REJECT('why')` vetoes it.
Under manifest `grants` you need `filters:content` for the platform's
content points. Declare and run points of your own with
`ctx.filters.declare` and `ctx.filters.apply`; see
[Cross-extension](/extend/cross-extension).

## Connectors

`contributions['connectors@1']` declares how an outside service is reached -
its auth kind (`oauth2`, `apiKey`, `basic`), the `hosts` it talks to, a
`request(conn, path, init)` that adds the credential, and a `health(conn)`.
The platform stores an operator's credentials for it, sealed, and hands
consumers an authed client through `ctx.connections.get(id)`; you need
`connections:contribute` to offer one and consumers need
`connections:<id>` to use it.

Operators add connections in Settings → Connections. For `apiKey` the
page asks for each of your `fields`; for `basic`, a username and
password; for `oauth2`, the client id and secret of the OAuth app they
registered with the provider (its redirect URL is the API's
`/api/v1/connections/oauth/callback`) - core runs the authorize redirect,
the state and PKCE, the code exchange at your `tokenUrl`, and seals the
tokens; your `request` then reads `conn.credentials.accessToken`. The
page's Test button runs your `health(conn)`, so declare one. When an
operator holds several connections of one connector they are told apart by
label: `ctx.connections.get(id, { label })`; without a label you get the
first active one.

Declare `revokeUrl` on an `oauth2` auth so a revocation in Settings reaches
the provider. Refresh is the platform's job: `conn.credentials.accessToken`
is always the current token, refreshed before expiry or after a 401 and the
request retried once, so never cache a token outside the call.

## GraphQL

`contributions['graphql.types@1']` (grant `graphql:contribute`) extends the
generated schema: `{ sdl, resolvers }` where the SDL adds your types,
`extend type Query { ... }`, `extend type Mutation { ... }` or
`extend type <ContentType> { ... }`, and `resolvers[Type][field]` covers
exactly the fields you added. A resolver gets `(source, args, context)`
with `context.ctx` your extension ctx bound to the caller.

## Translation engines

`contributions['translation.provider@1']` adds a machine-translation engine
(grant `translation:provide`): `{ id, label, languages?, translate(texts, opts) }`
returning `{ texts }` in order. The translate route takes it as `engine`,
refuses a target outside `languages`, and the locales route lists it for the
Admin. `google` and `ai` are core's ids.

## Storage providers

`contributions['storage.provider@1']` adds a storage adapter (grant
`storage:provide`): `{ id, label, description?, create(config) }` where
`create` returns a `StorageAdapter` from the resolved `storage.*` config.
The deployment picks it with `storage.adapter` / `STORAGE_ADAPTER=<id>`;
an id nothing provides is a boot error. `local` and `s3` are core's ids.

## AI providers

`contributions['ai.provider@1']` adds an AI provider (grant `ai:provide`):
`{ id, label, capabilities, models, text?, json?, image?, vision?, embeddings? }`
where `capabilities` names what you implement (`text.generate`,
`json.generate`, `image.generate`, `vision.describe`, `embeddings.generate`).
The platform routes each capability to the workspace's preferred provider
when it advertises it, else the first available one that does; a
definition advertising more than it implements is dropped with a warning.
Consumers call `ctx.ai.generateJSON` (`ai:generate`), `ctx.ai.vision.describe`
(`ai:vision`) and `ctx.ai.embeddings.generate` (`ai:embed`).

## When an operator changes your settings

```ts
onSettingsChange: async (ctx, { changed }) => {
  if (!changed.includes('searchConsoleProperty')) return
  await ctx.enqueue('sync-search-console', { once: true })
}
```

A setting is usually a pointer at the outside world, so this is where you act
on one moving instead of waiting for your next scheduled run. You are told
the KEYS that changed, never the values: read what you need with
`ctx.settings.get()`, so no secret reaches a hook payload. A key counts only
when its value actually differs (clearing counts; a secret counts whenever
one is submitted, because a re-seal is a different ciphertext).

It runs after the write is stored, under your extension's authority, and a
throw is logged rather than failing the operator's save. **Never block it** -
the Save button is waiting, so enqueue rather than calling a provider inline.
Only an operator's save fires it, so a write you make yourself cannot loop
back.

## Contributions by point

`contributions` is the explicit form of the well-known keys above:
`{ 'flow.actions@1': [...], 'mcp.tools@1': [...] }`. Both spellings reach a
host through `ctx.contributions(point)`; see
[Cross-extension](/extend/cross-extension).

## Not a contribution

**Telemetry is not an extension surface.** It is a Core capability with no
persistence and no public extension API. Use `ctx.log` for logging; audit
records are the platform's and are durable.

Do not build against anything not listed on this page, and do not infer a
surface from what a first-party extension does - some of them use internals
that are not part of the public contract.

## Related

- [Server routes](/extend/contributions/routes) ·
  [Extension data](/extend/data/extension-data) ·
  [Custom field types](/extend/contributions/fields) ·
  [The lifecycle in practice](/extend/contract/lifecycle)
