---
title: Capabilities and dependencies
description: Declaring what you need, and designing for on, off and unavailable.
audience: extension-developer
type: guide
status: stable
lastVerified: 2026-09-16
verification: source
verifiedBy: packages/types/src/extension.ts
---

# Capabilities and dependencies

Your extension runs in deployments you did not configure. Declare what you need,
and degrade honestly when it is not there.

## Declaring

```ts tangen.extension.ts
requires: {
  capabilities: ['media', 'search'],
  extensions: [{ id: 'acme.core', version: '^1' }],
},
optional: {
  extensions: ['acme.analytics'],
},
```

| | means |
|---|---|
| `requires.capabilities` | runtime capabilities that must be **available** in the process. One missing makes your extension `unavailable` with a safe reason, and it **never starts** |
| `requires.extensions` | extensions that must be installed **and enabled in the same workspace** |
| `optional.extensions` | used when present; your extension works without them |

Capability ids you may require include `media`, `search`, `mail`, `knowledge`,
`redis`, `realtime`, `scheduler` and `webhooks`. The full registered list is in
[Reference → Extension manifest](/reference/extension-manifest#dependencies).

Declare only what you genuinely need. A `requires.capabilities: ['redis']` you
added defensively makes your extension unavailable in every Redis-less
deployment.

## The three states

| state | means | who changes it |
|---|---|---|
| `on` | installed, enabled, code loaded, everything it requires available | - |
| `off` | not installed here, or switched off | an operator |
| `unavailable` | it cannot run here | an operator, by fixing the condition |

**Never write "if installed, it is running".** Installed is one of four
conditions that must all hold.

## Optional dependencies

Check at runtime, and mean it:

```ts
const handler = async (req, ctx) => {
  if (await ctx.hasExtension?.('acme.analytics')) {
    // the richer path
  }
  // the path that always works
}
```

`hasExtension` answers for **this workspace**. Absent on a
runtime that does not wire it - so `?.` and a sensible default, not an
assumption.

## Degrading honestly

Three bad patterns, and what to do instead:

**Silently doing nothing.** A feature that quietly stops is a support ticket.
Say what is missing.

**Crashing.** A missing optional dependency is not an exception.

**Pretending it worked.** Returning an empty list where you meant "search is
off here" is the worst of the three, because nobody investigates it.

```ts
if (!(await ctx.hasExtension?.('acme.analytics'))) {
  return { available: false, reason: 'Analytics is not enabled in this workspace.' }
}
```

Give the caller a reason an operator could act on, and never a stack trace or a
credential.

## Capability is not permission

A capability is about the **deployment**; a permission is about the **caller**.

- `search` `off` - nobody can search here, whatever their role.
- `search` `unavailable` - it cannot run here at all; an operator fixes it.
- no `search: read` action - **this caller** cannot search, while others can.

They are three different answers and they need three different messages. A page
that says "you do not have permission" because a capability is off tells a user
something false about their own account.

## Your extension is a capability too

Yours appears in the platform's capability list as `ext:<id>` - so
`acme.reviews` is `ext:acme.reviews`. That is how the Admin knows whether to
render your pages, and it is why a disabled extension's UI disappears rather
than erroring.

You do not register that yourself and you do not read the registry directly.
Declare in the manifest, and the platform does the rest.

## Typed services are not capabilities

A **capability** is a platform feature this deployment has or lacks. A
**service** is an implementation another extension offers you, with a type:
`requires: { services: ['seo.service@^1'] }` and `ctx.services.get<SeoService>('seo.service@^1')`.
The rules are the same shape - required blocks you, optional degrades - but
the provider is an extension, the version is a range, and the answer is a
typed object rather than a yes or no. See
[Cross-extension](/extend/cross-extension#typed-services).

## Related

- [The lifecycle in practice](/extend/contract/lifecycle) ·
  [Extension manifest reference](/reference/extension-manifest) ·
  [Permissions](/reference/permissions) ·
  [Permissions and security](/extend/contributions/permissions)
