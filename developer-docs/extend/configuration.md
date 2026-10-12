---
title: Extension options
description: How a project configures your extension, what ctx.options carries, and why options are workspace-scoped while activation is not.
audience: extension-developer
type: reference
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g7/crm
---

# Extension options

A project configures your extension where it declares it:

```ts
// app/config/extensions.ts
import { defineExtensions } from '@tangen/cms'

export default defineExtensions([
  { resolve: '@tangen/ext-crm', options: { leadPrefix: 'nw' } },
])
```
Your server entry reads that object as `ctx.options`:

```ts
import { defineExtensionServer } from '@tangen/cms'

export default defineExtensionServer({
  flowActions: [{
    name: 'crm_create_lead',
    label: 'Create CRM lead',
    handler: async (config, ctx) => {
      const prefix = String((ctx.options as { leadPrefix?: unknown })?.leadPrefix ?? 'lead')
      return { leadId: `${prefix}_${crypto.randomUUID().slice(0, 8)}` }
    },
  }],
})
```
With that configuration the lead ids come back as `nw_…`. Without it they come
back as `lead_…`. That difference is the whole contract.

## Scoping

**Options are workspace-scoped. Activation is deployment-scoped.** These are
different axes and conflating them is the easiest mistake to make here.

| | scope | lives in |
|---|---|---|
| the options object | workspace | `app/config/extensions.ts` |
| installed / enabled | **deployment** | that deployment's database |

A workspace declares your extension once, with one options object, and that
object serves development, staging and production alike. Whether your extension
is *running* on a given deployment is a separate question answered by
`tangen extension install` and `enable` there.

So there is no per-deployment options object. If your extension needs to behave
differently per deployment, read the deployment's role:

```ts
const role = ctx.deploymentRole?.()   // 'development' | 'staging' | 'production'
```
## Defaults are yours

The platform hands you exactly what the project wrote, or `undefined`. It does
not merge, validate or substitute defaults on your behalf. Every default in your
extension is a default *you* apply, which is why the example above writes
`?? 'lead'` rather than assuming a value arrived.

`ctx.options` is the resolver's answer for your `config` keys: an option an
operator typed in the Admin beats the entry in `app/config/extensions.ts`,
which beats your manifest default. A field marked `secret: true` never
appears in `ctx.options` - it is a reference, and `ctx.secrets.get(name)`
returns the material (see [Secrets](/extend/data/secrets)).

Read defensively. `ctx.options` is whatever a project put in a config file.

## A caution worth knowing

Until recently `ctx.options` was always `undefined` - every extension in every
workspace silently ran on its defaults, and because defaults are normal, nothing
looked broken. If you are debugging an option that seems not to arrive, check
you are on `@tangen/api` 0.1.146 or later.

## Operator settings

A `list` field may take its options from the workspace's content types:
`settings.list().optionsFrom('content-types')` (Review's `requireReviewFor`).
Your content hooks read settings through the same `ctx.settings.get()` your
routes use; the kernel hands every hook of a settings-declaring extension that
accessor (E.7). A setting that needs an optional grant says so with
`.requires('<grant>')`: without the grant it is visibly unavailable, reads
answer its default, and enabling it is refused naming the grant (E.15). A
setting a website needs is marked `.public()`: core serves it on
`GET /api/v1/ext/<id>/settings` and the SDK reads it with
`client.extensionSettings(id)`; secrets and connections can never be public (E.18).

Options are set in code at install. What an operator changes at runtime is
`settings` in the manifest: plain descriptors from the `settings` builders in
`@tangen/types` (`boolean`, `number`, `string`, `select`, `list`, `secret`,
`connection`, `resource`), each with `.default()`, `.optional()`, `.label()`,
`.describe()`. The platform validates and stores them (secrets sealed),
serves `GET/POST /api/v1/admin/ext/<id>/settings` to members with
`manage:settings`, and your server reads them with `ctx.settings.get()`.
Bump `settingsVersion` and export `migrateSettings(values, fromVersion)`
when the shape changes. Details and an example: the Extensions guide,
"Settings".

### Acting when a setting changes

A setting is usually a pointer at the outside world - which property, which
channel, which spreadsheet - so export `onSettingsChange` and do the work the
moment one moves, instead of waiting for your next scheduled run:

```ts
export default defineExtensionServer({
  onSettingsChange: async (ctx, { changed }) => {
    if (!changed.includes('searchConsoleProperty')) return
    await ctx.enqueue('sync-search-console', { once: true })   // never inline
  },
})
```

You are told the KEYS that moved, never the values - read what you need with
`ctx.settings.get()`, so no secret reaches a hook payload. A key counts as
changed only when its value differs (a re-save of the same form calls
nobody); clearing counts; a secret counts whenever one is submitted, because
a re-seal is a different ciphertext. The hook runs after the write is stored,
under your extension's authority, and a throw is logged rather than failing
the operator's save. **Do not block**: the Save button is waiting, so enqueue
rather than calling a provider inline. Only an operator's save fires it - a
write your extension makes itself does not call back, so the hook cannot
loop.

## Related

- [Extensions overview](/extensions) - declare, install, enable
- [The extension context](/extend/contract) - everything else on `ctx`
- [Cross-extension integration](/extend/cross-extension) - `ctx.registry()`
