---
title: Flow contract import
description: The public import surface for Flow contributions and site helpers, and which entry point is not one.
audience: extension-developer
type: reference
status: stable
package: "@tangen/ext-flows"
lastVerified: 2026-09-02
verification: source
verifiedBy: extensions/flows/src/contract.ts
---

# Flow contract import

## Two supported paths

| you are | import from | how |
|---|---|---|
| an extension contributing actions or triggers | `@tangen/cms` | write them **inline** in `defineExtensionServer`, which types them for you |
| a **site** adding helpers | `@tangen/ext-flows/contract` | `defineFlowHelpers`, with the named contribution types |

The two now agree field for field, so a `FlowActionContribution` is assignable
to what `defineExtensionServer` accepts. They disagreed until Stage G5: the
contract said `{ key, label?, type? }`, which everything consumes, and
`@tangen/types` said `{ path, … }`, which nothing ever read. `key` won, because
every built-in and every shipped contribution already used it.

Either style compiles. Writing inline is usually simpler; annotating is useful
when you build contributions in a separate module.

## `@tangen/ext-flows/contract`

```ts
import {
  defineFlowHelpers,
  type FlowActionContribution,
  type FlowTriggerContribution,
  type FlowActionMeta,
  type FlowOutputField,
  type FlowHelpers,
} from '@tangen/ext-flows/contract'
```
The entry is isomorphic - types plus one identity function, importing nothing
but `@tangen/types`. It resolves on a server, in a bundler, and in a test.

`defineFlowHelpers` is an identity function. It exists for inference and costs
nothing at run time:

```ts
// app/flows/index.ts
export default defineFlowHelpers({
  actions: [{
    name: 'site_notify_sales',
    label: 'Notify sales',
    configFields: [{ key: 'channel', label: 'Channel', kind: 'text' }],
    handler: async (config) => ({ notified: String(config.channel ?? '') }),
  }],
  triggers: [{ type: 'custom:sales.escalated', label: 'Sales escalated' }],
})
```
Site helpers reach Flow through the extension's own options:

```ts
// app/config/extensions.ts
import siteFlowHelpers from '../flows'

export default defineExtensions([
  { resolve: '@tangen/ext-flows', options: { ...siteFlowHelpers } },
])
```
## The package root is not a server import

```ts
import '@tangen/ext-flows'          // ✗ fails outside the Admin bundler
```
The root entry is Flow's Admin barrel: it pulls the canvas pages, which import
the Admin's own `@/kit` alias. On a server that fails with
`Cannot find module '@/kit'`.

This is deliberate, not a defect awaiting repair. Every extension's Admin UI
uses that alias, and it resolves only in the Admin's build. **Use
`@tangen/ext-flows/contract`.**

## Related

- [Flow contributions](/extend/flow-contributions)
- [Public contract](/reference/public-contract)
