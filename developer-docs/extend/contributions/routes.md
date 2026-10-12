---
title: Server routes
description: "Adding HTTP endpoints from an extension: member, key and public routes, their request context, capabilities and error handling."
audience: extension-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-16
verification: executable
verifiedBy: stage-g7/crm
---

# Server routes

An extension declares routes in its **server entry**, as data. You never touch
the HTTP framework.

```ts src/server.ts
import type { TangenExtensionServer } from '@tangen/cms'

export default {
  adminRoutes: [
    {
      method: 'GET',
      path: 'list',
      auth: 'member',
      capability: 'reviews:read',
      handler: async (req, ctx) => {
        const rows = await ctx.store.list('review:')
        return { data: rows.map((r) => r.data) }
      },
    },
  ],
} satisfies TangenExtensionServer
```

`method` is `GET`, `POST`, `PATCH` or `DELETE`. `path` is relative and may
contain `:param` segments.

## `auth` decides the mount

This is the most important field on the route, and the name `adminRoutes` is
misleading: only one of the three is an admin surface.

| `auth` | mounts at | who |
|---|---|---|
| `'member'` (default) | `/api/v1/admin/ext/<id>/<path>` | admin-panel member sessions. `req.memberId` is set |
| `'key'` | `/api/v1/ext/<id>/<path>` | a workspace API key. The workspace resolves from the key; `req.apiKeyId` is set |
| `'public'` | `/api/v1/ext/<id>/<path>` | **unauthenticated.** Workspace from the `X-Tangen-Workspace` header or the sole loaded workspace |

**Every mount 404s while the extension is uninstalled**, indistinguishable from
a route that was never declared. That is deliberate: an absent extension should
not be discoverable.

**Every route runs as its caller.** `ctx.tangen` is bound to the member, to the
key (or the identity the key is a credential of), or - on a `public` route - to
a reader holding only what the route declares in `authority`
(`{ objects: { actions: ['read'] } }` by default). A route may also declare
`access: { roles?, capability? }`, the same rule a page uses, and the server
decides it before your handler runs: owner and admin pass, a listed role
passes, a held capability passes. Declare `contract: 1` on the manifest to say
the extension is written against this.

## Choosing `auth`

Default to `'member'`. Reach for the others only with a reason:

- **`'key'`** when a customer's *server* calls you - a webhook receiver, a
  server-to-server integration.
- **`'public'`** when a *browser* must call you without a credential - an embed
  script, an unauthenticated form receiver. This is the one to be careful with:
  anyone on the internet can call it, and an unresolvable workspace is a 404
  rather than an error.

A public route must validate its own input, rate-limit itself, and return
nothing it would not put on a billboard.

## Capability gating

```ts
{ method: 'POST', path: 'approve/:id', auth: 'member', capability: 'reviews:moderate', handler }
```

`capability` is enforced **before your handler runs**, so a caller without it
never reaches your code. Declare the id in your manifest's `capabilities` so an
operator can grant it.

Inside the handler you can ask further questions:

```ts
handler: async (req, ctx) => {
  if (!req.can?.('reviews:moderate')) return { error: 'forbidden' }
  if (!req.actAsRole?.(['legal'])) return { error: 'legal review required' }
  if (!(await req.canWriteLocale?.(null))) return { error: 'base-language rights required' }
}
```

| helper | answers |
|---|---|
| `req.can(capability)` | does the caller hold this capability |
| `req.memberRole` | their workspace role on this deployment |
| `req.actAsRole(roles)` | do they satisfy a role restriction. `null` means no restriction; `owner` always satisfies one, so a restriction naming nobody still has a recovery path |
| `req.canWriteLocale(locale)` | may they write content in this language. `null` asks about the base language |

**Any route that writes content should ask `canWriteLocale`.** A capability
grant must never become a way around the locale model.

## Rate limiting

Available to `key` and `public` handlers:

```ts
await ctx.tangen.rateLimit(`reviews:${req.headers?.['x-forwarded-for'] ?? 'anon'}`, 10, 60)
```

## Context

The handler's second argument is your server context:

| | |
|---|---|
| `ctx.extensionId`, `ctx.workspaceId` | identity - scope every read and write by them |
| `ctx.options` | this workspace's configuration - the resolver's answer for your `config` keys |
| `ctx.secrets?.get(name)` | the material behind a declared `secrets` name or a `secret: true` config field, from this deployment's provider; never in `ctx.options` |
| `ctx.store` | your key-value storage |
| `ctx.http(url, init?)` | outbound HTTP with your extension's reach: fetch's shape, limited to the hosts your manifest `grants` name (`network:api.example.com`); an undeclared host, or one that resolves to a private address, is refused before any request (`code: 'NETWORK_REFUSED'`), redirects are re-checked hop by hop, and every call is audited. Use it instead of the global `fetch` - it is what an install review and an operator's audit can see |
| `ctx.tangen` | the content client, **bound to the caller**: it does what the member, the key or the public route's declared `authority` may, never more. A viewer's session cannot create through it; a key without `write` cannot write |
| `ctx.exec` | the caller's execution: `exec.actor.identity` (`{ kind: 'member' \| 'api_key' \| 'agent' \| 'service' \| 'extension', id }`), the workspace, the locale context, the request id and correlation id |
| `ctx.clientFor(exec)` | a content client bound to another execution - pair it with `resolveActor` to act as a recorded member, key or identity |
| `ctx.resolveActor(id)` | the CURRENT authority of a recorded member, key or identity id: `{ ok: true, actor }` or `{ ok: false, reason }` when it was suspended, removed or revoked. Under manifest `grants` it needs `delegation:act-as`; `ctx.db` needs `db:own`, `ctx.ai` needs `ai:generate`, `ctx.enqueue` needs `jobs:enqueue` |
| `ctx.deploymentRole?.()` | `development`, `staging` or `production` |
| `ctx.hasExtension?.(id)` | is another extension active here |
| `ctx.contributions?.(point, { except? })` | every item the active extensions contribute to a point (`'flow.actions@1'`), each with its contributor and a lender for the contributor's own ctx; throws on an unknown point |
| `ctx.connections?.get(id)` | an authed client for a configured connection (`connections:<id>` grant); see [Connectors](/extend/contributions/server#connectors) |
| `ctx.filters?.register(reg)` / `apply(point, value, { scope })` / `declare(def)` | filters: register a transform for this workspace (the handle withdraws), run one of your own points over a value, declare a point in your namespace |
| `ctx.services?.get<T>(ref)` / `resolve(ref)` / `provide(ref, impl)` / `dispatch(ref, { as })` | typed services between extensions: get `'seo.service@^1'` from the active provider (`undefined` when none satisfies), resolve adds who provides it, provide offers one of your declared services from `onStart`, dispatch instantiates a factory service for a caller under provider ∩ caller |
| `ctx.contribute?.(point, items)` | contribute at runtime (from `onStart`), scoped to this workspace; the returned handle withdraws early, and the host withdraws when the scope stops |
| `ctx.realtime?.publish(…)` | publish on a declared channel |
| `ctx.log(message)` | log a line |
| `req.requestId` | the correlation id, echoed as `X-Tangen-Request-Id`. Put it in your log lines |

## Errors

Return a value and it is the response body. Throw, and the platform reports a
failure to the client under the same `requestId` - **without your exception
text**.

Do not return a driver message, a stack trace, or the value that was rejected.

## Testing

```ts
import { describe, it, expect } from 'bun:test'
import server from '../src/server'

const route = (m: string, p: string) => server.adminRoutes!.find((r) => r.method === m && r.path === p)!

describe('GET list', () => {
  it('is a member route gated on reviews:read', () => {
    const r = route('GET', 'list')
    expect(r.auth ?? 'member').toBe('member')
    expect(r.capability).toBe('reviews:read')
  })

  it('scopes its read to the calling workspace', async () => {
    const seen: string[] = []
    const ctx = {
      workspaceId: 'wsp_a', extensionId: 'acme.reviews',
      store: { list: async (p: string) => { seen.push(p); return [] } },
      log: () => {},
    }
    await route('GET', 'list').handler({ params: {}, query: {}, body: null }, ctx as never)
    expect(seen).toEqual(['review:'])
  })
})
```

The route table is plain data, so most of what matters is assertable without a
server.

## Related

- [Permissions and security](/extend/contributions/permissions) ·
  [Server contributions](/extend/contributions/server) ·
  [Admin contributions](/extend/contributions/admin) ·
  [Permissions reference](/reference/permissions)
