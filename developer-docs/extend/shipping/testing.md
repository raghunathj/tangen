---
title: Testing an extension
description: What to test, and the lifecycle paths people forget.
audience: extension-developer
type: guide
status: stable
lastVerified: 2026-09-16
verification: executable
verifiedBy: stage-g7/hello-tests
---

# Testing an extension

Most of what matters is **plain data**. The manifest, the route table, the
migrations and the config are all values you can assert on without a server,
which makes the cheapest tests the most useful ones.

## The manifest

```ts
import manifest from '../tangen.extension'

it('declares a namespaced id and a version', () => {
  expect(manifest.id).toMatch(/^[a-z0-9][a-z0-9._-]*$/)
  expect(manifest.id).toContain('.')
  expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/)
})

it('names components that its browser entry actually exports', async () => {
  const client = await import('../src/index')
  for (const page of manifest.pages ?? []) expect(client).toHaveProperty(page.component)
  for (const panel of manifest.sidebarPanels ?? []) expect(client).toHaveProperty(panel.component)
})
```

The second one is the highest-value test on this page: a component name that
does not resolve is a page that renders nothing, and it fails at build time in
somebody else's project rather than in yours.

## Handlers, grants and peers

Event handlers, tasks and lifecycle hooks take a `ctx`. Build one with
`@tangen/extension-testkit` rather than a hand-made object: it runs under the
same actor, policy and facility gate the platform applies, from your
manifest's [`grants`](/reference/extension-manifest#grants), so a test proves
what production will enforce.

```ts
import { createTestCtx, withExtensions, contributionsOf, expectRefused, resetTestkit } from '@tangen/extension-testkit'
import manifest from '../tangen.extension'
import server from '../src/server'

afterEach(() => resetTestkit())

it('reacts to a publish within its grants', async () => {
  const test = createTestCtx({ extensionId: manifest.id, grants: manifest.grants?.required, tangen: client })
  await server.events![0]!.handler({ type: 'object.published', payload: { id: '1' } } as never, test)
  expect(test.calls.enqueued).toEqual([{ taskId: 'acme.reviews:notify', payload: { id: '1' } }])
})

it('cannot reach what it did not ask for', async () => {
  const test = createTestCtx({ extensionId: manifest.id, grants: ['content:read'] })
  expect(test.db).toBeUndefined()                                   // no db:own
  await expectRefused(() => test.emit!('reviews.changed', {}))      // no events:emit
})

it('sees what its peers contribute', () => {
  withExtensions([{ id: 'acme.analytics', server: { flowActions: [{ name: 'analytics.track', label: 'Track' }] } }])
  expect(contributionsOf<{ name: string }>('flow.actions@1').map((c) => c.item.name)).toEqual(['analytics.track'])
})
```

The ctx it returns carries an in-memory `store` (`createMemoryStore`), a
`calls` record of every `enqueue`, `emit` and `log` (a testkit addition, not a
contract member), and the `tangen` you pass: a stub, or a client bound to a
real test database. Omit `grants` and the ctx holds nothing - the store and
`db` are absent, the queue and the bus refuse by name - exactly as the platform
runs an extension that declares none (there is no trusted class).

## Configuration

Test the absent case first - a project may declare you with no options at all.

```ts
it('applies defaults when nothing is configured', () => {
  expect(readConfig(undefined).moderation).toBe(true)
})
it('coerces junk rather than propagating it', () => {
  expect(readConfig({ maxPerPage: 'lots' }).maxPerPage).toBe(20)
})
```

## Secrets

Both states, and one negative:

```ts
it('reports unavailable when the credential is absent', async () => {
  delete process.env.ACME_REVIEWS_KEY
  expect((await handler(req, ctx)).ok).toBe(false)
})
it('never returns the credential', async () => {
  process.env.ACME_REVIEWS_KEY = 'test-not-a-real-key'
  expect(JSON.stringify(await handler(req, ctx))).not.toContain('test-not-a-real-key')
})
```

## Routes

```ts
const route = (m: string, p: string) => server.adminRoutes!.find((r) => r.method === m && r.path === p)!

it('gates every mutating route on a capability', () => {
  for (const r of server.adminRoutes ?? []) {
    if (r.method === 'GET') continue
    expect(r.capability, `${r.method} ${r.path}`).toBeTruthy()
  }
})

it('scopes its reads to the calling workspace', async () => {
  const seen: Array<Record<string, unknown>> = []
  const ctx = { workspaceId: 'wsp_a', extensionId: 'acme.reviews',
                store: { list: async () => { seen.push({}); return [] } }, log: () => {} }
  await route('GET', 'list').handler({ params: {}, query: {}, body: null }, ctx as never)
  expect(seen).toHaveLength(1)
})
```

The capability sweep is a **loop over the route table**, so it covers the route
somebody adds next month too.

## Migrations

```ts
it('has unique ids in declared order', () => {
  const ids = migrations.map((m) => m.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect([...ids].sort()).toEqual(ids)
})

it('is idempotent and scopes rows', () => {
  for (const m of migrations.filter((x) => /CREATE TABLE/i.test(x.sql))) {
    expect(m.sql).toMatch(/IF NOT EXISTS/i)
    expect(m.sql).toMatch(/workspace_id/)
  }
})
```

Then apply them against a real PostgreSQL, **twice**, and assert the second run
changes nothing.

## Lifecycle paths people forget

| path | assert |
|---|---|
| **disable** | nothing of yours is reachable - routes 404, nav item gone |
| **uninstall then reinstall** | your rows are still there and are adopted, not duplicated |
| **upgrade** | only new migrations run; old ones are not re-applied |
| **a required capability absent** | you are `unavailable` with a reason, and nothing started |
| **an optional dependency absent** | the reduced path works and says why |
| **purge** | only after an explicit approval, and never in production |

Disable and reinstall are the two most commonly broken, because they are the two
nobody runs by hand.

## Isolation

```ts
it('cannot read another workspace\\'s rows', async () => {
  await store('wsp_a').put('review:1', { body: 'A' })
  expect(await store('wsp_b').get('review:1')).toBeUndefined()
})
```

Two tests, and they are the ones that would have caught the worst bug your
extension could ship.

## Admin components

Render each one and assert the four states: **loading**, **error**, **empty**,
**ready** - and that they are four, not two. Then assert the effect's
dependencies include **both** `workspaceId` and `env`.

Use a browser only for what needs one: layout at a width, and focus.

## What not to test

Not that Tangen runs your migrations, gates your capability, or clears the
published snapshot on unpublish. Those are the platform's tests. Testing them
gives you a suite that breaks when Tangen improves.

## Related

- [The lifecycle in practice](/extend/contract/lifecycle) ·
  [Local development](/extend/shipping/local-development) ·
  [Permissions and security](/extend/contributions/permissions)
