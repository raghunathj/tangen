---
title: Cross-extension integration
description: How one extension discovers another through contribution points, and why a contributed handler runs with its own context.
audience: extension-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-16
verification: executable
verifiedBy: stage-g7/crm
---

# Cross-extension integration

Extensions can find each other. That is how Flow discovers actions it did not
write, and it is available to your extension for the same purpose.

Nothing here requires a private import or knowledge of the Tangen repository.

## Asking what else is active

```ts
const others = ctx.registry?.() ?? []
// [{ id: 'seo', server: {…}, ctx: () => Promise<ExtensionServerCtx> }, …]
```
Each entry is one extension that is **active in this workspace**. An extension that is declared but not installed here, or
installed but disabled, is not in the list. You never have to check activation
yourself.

For a single yes/no there is a narrower question:

```ts
if (await ctx.hasExtension('seo')) { /* … */ }
```
## The contribution convention

Contributions are addressed by **point**: `flow.actions@1`, `mcp.tools@1`,
`search.providers@1`, `webhook.triggers@1`, and so on. You contribute from your
server entry - the well-known key you already know (`flowActions`) or the
explicit form, `contributions: { 'flow.actions@1': [...] }` - and a host reads
them all through one call:

```ts
for (const { extensionId, item, ctx: ctxFor } of ctx.contributions?.('flow.actions@1', { except: ctx.extensionId }) ?? []) {
  // item is the contributed action; ctxFor() is the contributor's own context
}
```

`contributions` lists only the extensions active here, in registration order,
skips a contributor whose manifest `grants` lack the point's grant
(`flow:contribute-nodes` for Flow nodes, `mcp:contribute-tools` for MCP tools),
and throws on a point it does not know - a typo is an error, not an empty
list. `ctx.contribute(point, items)` adds items at runtime from `onStart`, scoped to
the workspace that `onStart` runs for; the handle it returns withdraws them
early, and the host withdraws them when that scope stops.

If your extension wants contributions of its own, declare a point
(`declareContributionPoint({ id: 'acme.widgets', version: 1, multiplicity: 'multi' }, 'acme')`)
and document it; contributors fill it under that name. `ctx.registry()` still
returns every active server entry for conventions that predate points. An
extension that publishes nothing is simply never integrated with - most
extensions expose no integration surface at all, and that is the normal case.

## Contributor-owned context

The important part. When you execute another extension's handler, run it with
**their** context, not yours:

```ts
const handlerCtx = entry.ctx ? await entry.ctx() : ctx
await contribution.handler(config, handlerCtx)
```
`entry.ctx()` lazily builds that extension's own `ExtensionServerCtx` for the
same workspace. Their `ctx.store` writes under their extension
id, their `ctx.emit` namespaces to their events, their `ctx.options` are the
ones their config declared.

This is observable. When Flow runs a CRM extension's contributed action, the
row it stores lands under `extension_id = 'crm'`, not `flows`:

```text
crm   | lead:lead_i6lrot7y
flows | flow:fl_1d92a2b7…
flows | run:fl_1d92a2b7…
```
Storage stays owned by whoever wrote the handler, whichever extension invoked
it.

## Filter points

Where a service is an implementation you call, a **filter point** is a value
you let others transform. Declare one in your namespace and run it wherever
you produce the value; peers register against it:

```ts
// the owner
ctx.filters?.declare({ id: 'acme.reviews.summary', version: 1, scope: ['contentType'], mode: 'value', isolation: 'skip' })
const { value: summary } = await ctx.filters!.apply('acme.reviews.summary@1', draft, { scope: { contentType: 'review' } })

// a peer, in its server entry
filters: [{ point: 'acme.reviews.summary@^1', priority: 20, transform: (summary) => `${summary} (verified)` }]
```

`value` mode returns the next value (undefined leaves it); `draft` mode hands
every transform one clone to mutate. A broken transform is skipped and
attributed on a `skip` point; only an `abort` point lets a transform veto
with `Filters.REJECT(reason)`.

## Typed services

Contributions are items a host collects. A **service** is the other
direction: one extension offers an implementation, another calls it.

```ts
// the provider declares and offers
// tangen.extension.ts: provides: { services: ['acme.reviews.moderation@1'] }
onStart(ctx) {
  return ctx.services?.provide('acme.reviews.moderation@1', { flag: async (id: string) => ctx.store.put(`flag:${id}`, { at: Date.now() }) })
}

// the consumer declares and asks
// tangen.extension.ts: requires: { services: ['acme.reviews.moderation@^1'] }  (or optional)
const moderation = ctx.services?.get<Moderation>('acme.reviews.moderation@^1')
```

Provide from `onStart`: the implementation closes over your ctx, so it runs
with your authority whoever calls it. When your service acts on a caller's
behalf - it reads or writes content for whoever asked - provide a **factory**
instead, and consumers dispatch it:

```ts
// provider
ctx.services?.provide('acme.reviews.moderation@1', ({ tangen, caller }) => ({
  flag: (id: string) => tangen.objects('review').update(id, { flagged: true }),   // bound to provider ∩ caller
}))
// consumer, on a route
const moderation = await ctx.services?.dispatch<Moderation>('acme.reviews.moderation@^1', { as: ctx.exec })
```

The factory receives an execution under your grants intersected with the
caller's authority, a client bound to it, and who asked; a viewer cannot do
through your service what a viewer cannot do, and nobody can make your
service exceed your own grants. Declare what you provide in your own
namespace (`<your id>.<name>@<major>`); offering something you did not
declare is refused. A consumer that `requires` a service is never started
without an active provider whose major satisfies the range; one that lists
it under `optional` gets `undefined` and degrades. Publish the type from a
public subpath (`@acme/reviews/contract`) so consumers import the type and
never your code.

## Related

- [Flow contributions](/extend/flow-contributions) - the worked example
- [Extension options](/extend/configuration)
- [Extension storage](/extend/data/extension-data)
