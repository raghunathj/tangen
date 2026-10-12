---
title: Permissions and security
description: Declaring capabilities, gating routes and pages, and the boundaries you must not cross.
audience: extension-developer
type: guide
status: stable
lastVerified: 2026-09-16
verification: source
verifiedBy: packages/api/src/routes/extensions/server-routes.ts
---

# Permissions and security

## Declare what you gate on

```ts tangen.extension.ts
capabilities: [
  { id: 'reviews:read',     label: 'View reviews' },
  { id: 'reviews:moderate', label: 'Moderate reviews', implies: ['reviews:read'] },
],
```

Ids are namespaced `scope:name`. They appear in the roles editor for workspaces
where you are installed, and `implies` saves an operator ticking two boxes.

Then gate with them:

```ts
adminRoutes: [{ method: 'POST', path: 'approve/:id', auth: 'member', capability: 'reviews:moderate', handler }],
pages: [{ path: '', component: 'ReviewsPage', access: { capability: 'reviews:read' } }],
```

Route capability is enforced **before your handler runs**. Page access removes
the nav item as well as the page.

## Capability is not permission

Two different questions, and your UI must not conflate them:

- **your extension** being `off` or `unavailable` - the deployment does not have
  this feature here
- **this member** lacking `reviews:moderate` - they do have the feature, and not
  this action

A page that says "you do not have permission" because the extension is disabled
tells someone something false about their own account. The platform renders the
right state for the extension's own availability; you handle the permission half
inside your page.

## Least privilege

- Gate every mutating route on a capability.
- Split read from write: `reviews:read` and `reviews:moderate`, not one
  `reviews:manage`.
- Do not gate a read on an admin-only capability because it was easier.
- Do not invent a parallel vocabulary. Use platform capability ids where they
  fit, and namespace your own.

## Your extension is a principal

Every read and write your server code makes goes through an execution with an
actor. On a route that actor is the caller. Off a route - an event handler, a
task, a lifecycle hook - it is the extension itself, attributed as
`extension:<id>`. The kernel models that as its own actor kind (`'extension'`)
whose authority is compiled from grants such as `content:read`,
`content:update:types(post)`, `media:write`, `capability:reviews:moderate` and
`locales:all`; it never holds an administrator's authority, and a grant the
kernel does not recognise is refused rather than ignored.

Declare it in the manifest ([`grants`](/reference/extension-manifest#grants))
and ask for the narrowest reads and writes you need: keep drafts out of
anything public, and never assume a handler can do what an administrator can.
Every facility is behind a grant too - `store:own` for your store, `db:own`
for your own tables, `routes:member` / `routes:key` / `routes:public` for your
routes of that auth mode, `hooks:content` for your content hooks,
`events:subscribe` for your event subscriptions, `jobs:enqueue`,
`events:emit`, `realtime:publish`, `mail:send`, `storage:deliver`, `ai:*`,
`network:<host>` (or `network:option(<path>)`, a `*` segment mapping over an array, for a host the operator
configures in your options), `secrets:<name>`. Without the grant the facility
is absent, the route is not mounted, the hook or subscription does not run.
The install review shows each grant's tier and reason, and records what was
approved; the bundled extensions declare their grants the same way.

### What grants are, and what they are not

Grants are how an extension **declares** what it needs, how an operator
**reviews** it before installing, and how the kernel removes the facilities it
did not ask for. That is genuinely useful: a `store:own` extension has no
`ctx.db`, an extension with no `network:<host>` has no `ctx.http`, and a
grantless manifest is handed nothing.

They are not a sandbox. Your server entry runs **inside the API process**, so
it can reach anything that process can reach, whatever `secrets:<name>` it
declared: `process.env`, and the deployment's `.env` file sitting in the
working directory. Removing one of those would not change the answer, which is
why the platform does not pretend otherwise. Installing an extension is
therefore a decision to trust its code, in the same way adding a dependency
is, and the grant list plus the install review are there to make that decision
an informed one rather than to contain a hostile one.

What the kernel does hold is the module graph: `@tangen/db` and
`@tangen/api/kernel` are not resolvable from an extension package, so a
facility the platform withholds cannot be obtained by importing around it.
`ctx.db` really is the only database handle on offer. That boundary is real;
it is simply not a boundary against the filesystem.

Two consequences worth designing around:

- **Ask for the narrowest grants anyway.** They are what an operator reads
  when deciding whether to install you, and a narrow list is the difference
  between a quick yes and a refusal.
- **If you need real isolation** - running third-party code you do not trust -
  do not reach for grants. Put that code behind a boundary the operating
  system enforces, or run it somewhere else and talk to it over a route.

## Boundaries you must not cross

**Workspace.** Every store read and write is scoped for you. If you write raw
SQL against your own tables, **you** must scope by `workspace_id`.

**Never take identity from the request.** A workspace id in a path or a body is
input, not a credential. Use `ctx.workspaceId`. This exact
mistake - trusting a path parameter - has been a real vulnerability in this
codebase.

**Never widen with a capability.** A capability grant is not a way around the
locale model: a route that writes content should ask
`req.canWriteLocale?.(null)` before writing the base language.

## Route access

| `auth` | think |
|---|---|
| `'member'` | an admin session. Default, and usually right |
| `'key'` | a customer's server, with an API key |
| `'public'` | **anyone on the internet** |

A `public` route must validate every input, rate-limit itself
(`ctx.tangen.rateLimit(key, max, windowSec)`), and return nothing it would not
put on a billboard. An unresolvable workspace is a 404, so a scanner learns
nothing.

## Responses

- **No stack traces, no driver messages, no SQL.** A thrown error is reported
  under the request's correlation id without your exception text; keep it that
  way in your own returns.
- **Never echo a rejected value back.** Not a token, not a card number, not the
  URL that failed validation.
- **Never return a secret**, including inside a diagnostic or a settings read.
- **Log the request id**, not the payload.

## Admin state

- **Key every cache and every fetch on the workspace.** A cache keyed on
  nothing serves one workspace's answer to another.
- **Do not render active feature UI** for an extension that is off or
  unavailable.
- **A persistent condition is not a toast.** "No credential configured" is a
  state on the page; a toast disappears and the user is left confused.

## Production

Your extension inherits the platform's production rules and cannot opt out:
destructive operations refuse in production, and `tangen purge` refuses there.

For your own risky actions, gate on the role rather than the name:

```ts
const role = ctx.deploymentRole?.() ?? 'production'
if (role === 'production') return { ok: false, reason: 'Not available in production.' }
```

`null` means unknown. Choose the cautious branch.

## Related

- [Permissions reference](/reference/permissions) ·
  [Server routes](/extend/contributions/routes) ·
  [Secrets](/extend/data/secrets) ·
  [Admin contributions](/extend/contributions/admin)
