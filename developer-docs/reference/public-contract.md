---
title: Public contract
description: Which Tangen packages and imports are supported, what stable and experimental mean, and what is internal.
audience: site-developer
type: reference
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-06
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Public contract

What Tangen supports, and what may change without warning.

**A package existing is not evidence that it is public.** Tangen is developed in
a monorepo; most of what is in it is the platform's own. Only the imports listed
here are supported.

## What a project installs

```jsonc
{
  "dependencies": {
    "@tangen/cms":   "^0.1",
    "@tangen/api":   "^0.1",
    "@tangen/admin": "^0.1"
  },
  "devDependencies": {
    "@tangen/cli":   "^0.1"
  }
}
```

`tangen create` writes exactly this, pinned to a range and never to `latest`.

## Supported imports

| import | status | what it is |
|---|---|---|
| `@tangen/cms` | **stable** | the surface you write config and schema against: `defineWorkspace`, `defineObjectType`, `field.*`, `defineExtensions`, `defineGlobals`, `defineAuthConfig`, the route helpers, and the shared content types |
| `@tangen/sdk` | **stable** | the read/write client: `createClient`, the query builder, the Link guards, `TangenError` |
| `@tangen/sdk/node` | **stable** | Node and Bun SSR helpers. The root entry is browser-safe and imports no `node:` module |
| `@tangen/api` | **stable** | `createServer`, which your server entry calls |
| `@tangen/api/lean` | **experimental** | `createServerLean`, which resolves only the capabilities you give it |
| `@tangen/db/migrate`, `/content-tables`, `/custom-tables`, `/schema-kit`, `/reconcile` | **stable** | five subpaths. **The package root is not public** |
| `@tangen/graphql`, `@tangen/mcp`, `@tangen/knowledge`, `@tangen/realtime`, `@tangen/realtime-react`, `@tangen/porter`, `@tangen/nextjs`, `@tangen/astro`, `@tangen/toolbar` | **experimental** | opt-in capability and framework packages. Supported, still settling |
| `@tangen/types`, `@tangen/schema`, `@tangen/helpers` | **stable via the facade** | importable directly, but `@tangen/cms` re-exports them and is the documented path |

## Bundled with the platform

Two first-party extensions ship with the distribution and are declared in a
scaffolded project already: **`@tangen/ext-seo`** and **`@tangen/ext-flows`**.
You configure and enable them; you never install them. There is no supported
add command for either, and both move on the platform's version line rather
than their own.

Declaring an extension makes it available. Installing and enabling it stays per
workspace and per deployment, in the database, exactly as for any other
extension. Bundled does not mean always on.

## Present in the registry, but not an import surface

Some packages must be published because something public depends on them at
run time. **`@tangen/admin`, `@tangen/ui`, `@tangen/icons`, `@tangen/logging`,
`@tangen/studio-schema`, `@tangen/studio-compiler` and
`@tangen/realtime-admin`** are in that set: a scaffolded project installs
`@tangen/admin`, and `@tangen/api` depends on the rest.

Being installable is not a promise. Their exports are unsupported, they carry
no semver commitment, and no document names them as something to import. Seeing
one in `node_modules` is not permission to import it.

## Not public

- **The internals of every package above.** The platform's own. No semver
  commitment.
- **`@tangen/studio`, `@tangen/studio-react`, `@tangen/studio-runtime`,
  `@tangen/ext-porter`, `@tangen/ext-studio`, `@tangen/ext-review`,
  `@tangen/ext-variants` and `@tangen/ext-kitchen-sink`** are not published at
  all. `@tangen/studio` is in addition a deprecated shim over `studio-schema`,
  `studio-compiler` and `studio-runtime`.
- **Any `/src/` path.** `@tangen/sdk/src/client` and its kind do not resolve at
  all: each package declares its entry points, and a path that is not one of
  them is not reachable.
- **Relative paths into the monorepo.** `../../packages/...` is not an import,
  it is a copy of the platform.
- **First-party extensions other than the two bundled ones.** See
  [Extension manifest](/reference/extension-manifest).

Anything not listed above is internal.

## What the statuses mean

| status | promise |
|---|---|
| **stable** | breaking changes get a major version and a deprecation path |
| **experimental** | the shape can change in a minor version. Supported, and you will be told |
| **deprecated** | still works, has a replacement, will be removed in a major |
| **internal** | no promise at all, including that it still exists next week |

## The kernel contract

Every surface that reaches content resolves one execution with one actor and
converges on the same content operations. What is stable about that:

- the types `ActorContext`, `ExecutionContext`, `LocaleContext`, `JobRunRef`,
  `LifecycleActions` and `Identity` from `@tangen/cms`
- `ctx.exec` on every custom-route, job and extension context, and `ctx.tangen`
  bound to it; `ctx.clientFor` and `ctx.resolveActor` on extension contexts
- the refusal contract: `FORBIDDEN` with a reason, `VALIDATION`,
  `AUTHORITY_LOST` on a run, `object.publish_refused`
- `GET /api/v1/objects/:type/actions` and `/:type/:id/actions`, the one answer
  to "what may this actor do with this object next"
- the event envelope (`actor`, `initiator`, `execution`, `correlationId`,
  `causationId`, `resource`, `locale`) and the `audit_log` record behind it
- the attribution columns `created_by_kind`, `updated_by_kind`,
  `published_by_kind`, `scheduled_by`
- a task's `runAs`; a flow's `owner`, `runAs` and `identity`
- manifest `contract: 1`, capability `gates`, route `access` and `authority`
- the `X-Tangen-Correlation` and `X-Tangen-On-Behalf-Of` headers

Internal, and refused to extensions by a guard test: the storage layer that
acts with Tangen's own authority, the in-process event bus, the queue backends,
the guard functions behind the policy and the resolvers that build actors from
credentials.

## Versions

`@tangen/cms`, `@tangen/api`, `@tangen/admin` and `@tangen/cli` move in
**lockstep**: one `major.minor` line, and a test fails if they drift.
`@tangen/types`, `@tangen/schema`, `@tangen/helpers` and `@tangen/db` are
versioned independently and reached through the four above. `@tangen/sdk` is
**independent** - a client may be older or newer than its server, because it
speaks the REST contract, which is versioned by its `/api/v1` path.

## Related

- [Configuration](/reference/configuration)
- [SDK](/reference/sdk)
- [Extension manifest](/reference/extension-manifest)
