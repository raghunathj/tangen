---
title: The lifecycle in practice
description: "Declare, package, publish, install, enable, upgrade, disable, uninstall: what an extension author must do, and must not do, at each of the eleven stages."
audience: extension-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g7/lifecycle
---

# The lifecycle in practice

```text
REGISTER → INSTALL → ENABLE → MOUNT → START → STOP → DISABLE → UPGRADE → UNINSTALL → PURGE → DISPOSE
```

The stage list and its scopes are in
[Reference → Extension lifecycle](/reference/extension-lifecycle). This page is
about what you write.

## Nothing runs at import

The rule that catches people first. Importing your manifest, your server entry,
registering, installing, or running `onInstall` must not:

- open a database connection or a socket
- start a timer, worker or subscriber
- call an external service
- read a secret

```ts
// wrong - runs the moment the module is imported
const client = new SomeClient(process.env.ACME_KEY)

export default {
  adminRoutes: [{ method: 'GET', path: 'x', handler: async () => client.get() }],
}
```

```ts
// right - created when a request needs it
let client: SomeClient | undefined
const getClient = () => (client ??= new SomeClient(process.env.ACME_KEY))

export default {
  adminRoutes: [{ method: 'GET', path: 'x', handler: async (req, ctx) => getClient().get() }],
}
```

A secret's **value** comes from `process.env`, read at the point of use. The
manifest's `secrets: []` declares the variable **names** you read, not their
values, and there is no `ctx.secrets`. See [Secrets](/extend/data/secrets).

Background work belongs to START, which only happens when the extension is
actually available and wanted here.

## The six callbacks

Your server entry may export six lifecycle callbacks, and each maps to exactly
one stage.

| callback | stage | scope | for |
|---|---|---|---|
| `onInstall(ctx)` | INSTALL | workspace | non-schema setup. Runs **after** migrations, with **no database handle** |
| `onStart(ctx)` | START | workspace | timers, subscribers, consumers, connections |
| `onStop(ctx)` | STOP | per started scope | cease new work. **Idempotent by contract** |
| `onUpgrade(ctx, info)` | UPGRADE | workspace | non-schema upgrade work. Runs after migrations, before the new version is recorded |
| `onUninstall(ctx)` | UNINSTALL | workspace | advisory cleanup. **Your data is not deleted** |
| `onDispose()` | DISPOSE | once per process | release what `onStart` shared across scopes |

```ts src/server.ts
export default {
  onStart: (ctx) => {
    const timer = setInterval(() => sweep(ctx), 60_000)
    return () => clearInterval(timer)          // the cleanup runs at STOP
  },
  onUpgrade: async (ctx, info) => {
    // info: { from: string | null, to: string }
    if (info.from === null) return              // first install; nothing to migrate
    await migrateStoredOptions(ctx)
  },
  onDispose: () => { /* release process-wide handles */ },
} satisfies TangenExtensionServer
```

**`onStart` is where background work belongs** - never at import, and never in
`onInstall`. It is called once per workspace where the extension
is active, and again when a scope becomes active while the process runs.

Return a cleanup function and it runs at STOP; that is usually simpler than
writing `onStop`. **A throw in `onStart` marks that scope's runtime as failed
and starts nothing else of the extension there** - so make it defensive.

`onUpgrade` is not a schema escape hatch: DDL belongs in `migrations`. A throw
leaves the old version on the row, and the next upgrade retries the hook alone.

**There is no `onEnable` and no `onDisable`.** Enabling and disabling are
operator state; your code is not called. You do not need them - a disabled
extension contributes nothing, so its routes 404 and its pages are gone.

## What uninstall takes with it

Uninstall retires your row and stops your runtime; the platform then
revokes the connections made through your connectors (their material is
cleared), cancels your queued jobs, and announces `extension.uninstalled`
with the Flow action and trigger names you contributed, so flows built on
them are paused with a reason instead of failing later. Your stored data
stays until the operator purges.

## Disable is not uninstall

| | happens | your data |
|---|---|---|
| **DISABLE** | an operator switches it off on one deployment | untouched |
| **UNINSTALL** | it is removed from that deployment | **retained** - tables, rows, ledger and content types all survive, and a reinstall adopts them |
| **PURGE** | the separate, approved deletion | gone |

Write your extension so a reinstall is a resumption, not a fresh start. Rows
you left behind will still be there, and they will still have your `workspace_id`
on them.

## Operator state wins

Re-declaring the extension in `app/config/extensions.ts` does **not** re-enable
one an operator disabled, and does not reinstall one they uninstalled.
Declaring makes it available; the rest is their decision, per deployment.

Do not write code, docs or a setup script that assumes deploying re-enables
anything.

## Upgrade

Bumping `version` and deploying makes the new code available. **`UPGRADE`
runs new migrations** - the ones whose ids the ledger has not seen. Migrations
that already ran are never re-run, and must never be edited.

Write upgrades so an old row still makes sense: add columns with defaults,
tolerate an absent value, and do not assume every row was written by the
current version.

## Deployment awareness

Every stage except REGISTER and DISPOSE is per **workspace**, in the
database of the deployment the command runs on. An extension installed on
the development deployment is not installed on production until someone
installs it there.

Read `ctx.deploymentRole?.()` when the decision depends on production-ness:

```ts
const role = ctx.deploymentRole?.() ?? 'production'
if (role !== 'production') {
  // safe to do the noisy thing
}
```

A runtime that does not wire the seam answers `undefined`; treat that as
production and choose the cautious branch.

## Verify the lifecycle

```bash
bun run tangen extension install   acme.reviews
bun run tangen extension disable   acme.reviews   # contributes nothing
bun run tangen extension enable    acme.reviews
bun run tangen extension uninstall acme.reviews   # data retained
bun run tangen extension install   acme.reviews   # adopts it back
bun run tangen doctor                             # what was retained
```

## Related

- [Extension lifecycle reference](/reference/extension-lifecycle) ·
  [Migrations](/extend/data/migrations) ·
  [Capabilities and dependencies](/extend/contract/capabilities) ·
  [Testing an extension](/extend/shipping/testing)
