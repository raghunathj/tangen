---
title: Flow contributions
description: Contributing an action and a trigger to Flow from an external extension, using only published packages.
audience: extension-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g7/crm
---

# Flow contributions

Your extension can add nodes to Flow's canvas and event types flows can start
from. Both are declarations on your server entry; Flow finds them through the
[extension registry](/extend/cross-extension).

This works from a registry-installed extension. It needs no private import and
no access to the Tangen repository.

## An action

```ts
import { defineExtensionServer } from '@tangen/cms'

export default defineExtensionServer({
  flowActions: [{
    name: 'crm_create_lead',
    label: 'Create CRM lead',
    description: 'Stores a lead in this extension\'s own store.',
    capability: 'crm:write',
    configFields: [
      { key: 'company', label: 'Company', kind: 'text' },
      { key: 'tier', label: 'Tier', kind: 'text' },
    ],
    handler: async (config, ctx) => {
      const id = `lead_${crypto.randomUUID().slice(0, 8)}`
      await ctx.store.put(`lead:${id}`, { id, company: String(config.company ?? '') })
      ctx.emit?.('lead-created', { leadId: id, tier: String(config.tier ?? '') })
      return { leadId: id }
    },
  }],
})
```
What each part buys you:

- **`name`** is what a flow's node references. Namespace it - it shares one map
  with every other contributor.
- **`configFields`** are rendered by the Admin automatically. You write no UI.
- **`capability`** hides the action from members who lack the grant, and is
  re-checked at execution.
- **`handler`** receives `(config, ctx, meta)`. `config` has its `{{tokens}}`
  already resolved.

### Declaring your outputs

Declare the fields your result contains, and the builder offers them as tokens
instead of asking an author to remember them:

```ts
output: [
  { key: 'lead.id', label: 'Lead id', type: 'string' },
  { key: 'lead.tier', label: 'Tier', type: 'string' },
],
handler: async (config, ctx) => {
  const lead = { id: 'nw_q96aczht', tier: 'enterprise' }
  return { lead }
},
```

`key` is a **dot-path into the object you return** - so `lead.id` describes the
nested result above, and a downstream node reads
`{{steps.createLead.output.lead.id}}`. Proven from a registry-installed
extension: the metadata reached the catalog intact and both nested tokens
resolved in a real run.

`type` is a hint for the picker: `string`, `number`, `boolean`, `json`, `array`.

Declaring `output` is optional - omit it and your action still works, it just
contributes no tokens. What you must not do is declare it in the wrong shape;
registration warns by name if you do, rather than accepting metadata nothing
can read.

`meta` carries the execution identity - `flowId`, `flowName`, `trigger`,
`idempotencyKey` and `attempt` - which is what lets an action that reaches an
external system deduplicate a retried delivery.

## A trigger

```ts
flowTriggers: [{
  type: 'ext:crm:lead-created',
  label: 'CRM lead created',
  payloadFields: [
    { path: 'payload.leadId', label: 'Lead id', sample: 'lead_ab12' },
    { path: 'payload.tier', label: 'Tier', sample: 'enterprise' },
  ],
}]
```
The `type` must match what your `ctx.emit` produces. `ctx.emit('lead-created', …)`
namespaces to `ext:<your-id>:lead-created`, so declare that full string.

`payloadFields` do double duty: they populate the Insert-data picker for
conditions, and `sample` prefills Flow's test-run dialog.

## Your handler runs as you

A contributed handler executes with **your** extension's context: your
`ctx.store`, your `ctx.emit`, your `ctx.options`. Flow invokes it; it does not
own it. A lead written by the action above is stored under your extension id,
not Flow's.

## Contributions follow activation

Flow reads contributions from the extensions active in that workspace and
workspace. Disable your extension and its actions leave the canvas; a flow
referencing one stops being runnable rather than failing halfway. You do not
register or unregister anything.

## Where the types come from

For an extension, `@tangen/cms` is enough - `defineExtensionServer` accepts the
contribution shapes directly. If you want the types by name, import them from
the Flow contract:

```ts
import type { FlowActionContribution, FlowTriggerContribution } from '@tangen/ext-flows/contract'
```
See [the Flow contract import](/reference/flow-contract) for the boundary,
including why the package root is not a server import.

## Related

- [Cross-extension integration](/extend/cross-extension)
- [Flow contract reference](/reference/flow-contract)
- [Extension options](/extend/configuration)
