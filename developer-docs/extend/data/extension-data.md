---
title: Extension data
description: The extension store, and per-object data that follows publication.
audience: extension-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g7/crm
---

# Extension data

Most extensions do not need a table. `ctx.store` is a key-value store scoped to
your extension and this workspace - no DDL, no migrations.

Rows live in the deployment's database, discriminated by workspace. Two
workspaces never see each other's entries, and another deployment has its
own store: extension data reaches it through Porter, not by itself.

```ts
await ctx.store.put('settings', { theme: 'dark' })
const settings = await ctx.store.get('settings')

await ctx.store.put('review:r_01', { rating: 5, body: 'Great' })
const reviews = await ctx.store.list('review:', { limit: 50 })

await ctx.store.remove('review:r_01')
const total = await ctx.store.count?.('review:')
```

| method | does |
|---|---|
| `get(key)` | one value, or `undefined` |
| `put(key, data)` | write |
| `remove(key)` | delete |
| `list(prefix, opts?)` | entries whose key starts with `prefix`. `opts`: `orderByDataKey`, `desc`, `limit`, `offset` |
| `count?(prefix)` | how many, without fetching payloads |

Scoping is automatic. You never write `workspace_id` yourself, and
you cannot read another workspace's rows.

## Choose keys with prefixes

`list` is prefix-based, so keys are your index:

```text
settings                       one row
review:<objectId>:<reviewId>   listable by object
index:pending:<reviewId>       a second access path
```

Design them before you write the first one. There is no query language here -
if you need one, use a [migration](/extend/data/migrations) and a real table.

## When the store is the wrong tool

| | use |
|---|---|
| a handful of values, settings, light per-object state | `ctx.store` |
| rows you filter, sort or join | a table via `migrations` or `customTables` |
| content editors manage in the Admin | `contentTypes` |

## Per-object data follows publication

**When the key is a content object's id**, that entry is per-object panel state,
and the platform maintains a **published snapshot** beside your draft.

```ts
const draft = await ctx.extensionData.get('acme.reviews', objectId)
const live  = await ctx.extensionData.getPublished('acme.reviews', objectId)
```

| happens | to the published snapshot |
|---|---|
| the object is **published** | your `data` is copied into it |
| the object is **unpublished**, archived, or moved out of published | it is **cleared** |
| the object stays published and you write again | unchanged until the next publish |

**A Delivery read of the object serves the published snapshot, never your
draft.** That is what lets an editor work on SEO metadata for a live page
without it appearing on the site.

`getPublished` returns **`null`** when the object has no published version -
never published, or unpublished. That is a different answer from `{}`, which is
a published object whose extension state is empty. Collapsing the two shows
blank published values for something that was never published.

```tsx
const live = await ctx.extensionData.getPublished('acme.reviews', objectId)
if (live === null) return <NotPublishedYet />
return <PublishedState value={live} />
```

## A member can write this row - sign what a decision depends on

One table serves both jobs on this page: your `ctx.store` and the per-object
panel data the Admin reads and writes. They share a key tuple, so **a member
with content-write permission on the object can overwrite your entry for it**,
through the Admin's panel-data route. That is by design - a panel saves its own
state - and for display state it costs nothing.

It costs something when the value **is** a decision. If your extension stores
"this was approved", "this passed the check", "the quota is 5", a member can
write that value directly and skip whatever produced it.

`ctx.sign` is the answer. It is a MAC over a string, keyed per extension from a
deployment secret no member can read, on both the server ctx and the
content-hook ctx:

```ts
// writing the decision
const verdict = { approvedBy: actor.id, contentHash: hashOf(row) }
await ctx.store.put(objectId, { ...verdict, mac: ctx.sign?.(JSON.stringify(verdict)) })

// acting on it, later and elsewhere
const row = await ctx.extensionData.get(EXT_ID, objectId)
const { mac, ...verdict } = row
if (!ctx.sign || mac !== ctx.sign(JSON.stringify(verdict))) {
  throw new Error('This approval can no longer be verified')
}
```

Three rules make it hold:

- **Sign the canonical form, not the object.** `JSON.stringify` of the same
  values in a different key order is a different string, and the two sides of
  the comparison usually reach the value by different read paths. Sort the keys,
  or hash a projection you control.
- **Fail closed when you cannot verify.** `ctx.sign` is optional, because a host
  predating it has none. Absent means "cannot verify", which means refuse -
  never fall back to comparing the bare value, which is the hole reopened.
- **Mark the format.** Prefix the stored signature (`v1:`), so a value written
  before you started signing is recognisable. It is unverifiable rather than
  wrong, and saying so lets you give an accurate message instead of accusing an
  editor of an edit they did not make.

The MAC is per extension, so a value signed for yours does not verify for
anyone else's, and it is deterministic, so the two sides of a comparison agree.
It proves the value came from your code. It does not keep the row private - a
member can still read it - so a secret still belongs in `ctx.secrets`.

## Draft and published in a panel

A panel usually shows both: what the editor is working on, and what the public
currently sees. Read both, label them, and never present the draft as live.

## Moving between deployments

Porter carries your per-object data with the object it belongs to, so an
object imported on another deployment arrives with its extension data
intact. A Release publishes in place and does not move data anywhere.

## Locales

The store has **no locale dimension**. If your data varies by locale, carry that
inside your own payload and say so in your own contract - do not assume the
platform will split it for you.

## Testing

```ts
it('clears the published snapshot when the object is unpublished', async () => {
  await publish(objectId)
  expect(await ctx.extensionData.getPublished('acme.reviews', objectId)).not.toBeNull()

  await unpublish(objectId)
  expect(await ctx.extensionData.getPublished('acme.reviews', objectId)).toBeNull()
  expect(await ctx.extensionData.get('acme.reviews', objectId)).toBeDefined()   // the draft survives
})
```

## Related

- [Migrations](/extend/data/migrations) · [Server contributions](/extend/contributions/server)
  · [Admin contributions](/extend/contributions/admin)
