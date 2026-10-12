---
title: Configuration
description: Declaring options an operator sets, and reading them safely at runtime.
audience: extension-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g7/crm
---

# Configuration

Declare your options in the manifest so the platform can validate them at
install and upgrade, show them in the Admin, and know which ones never to print.

```ts tangen.extension.ts
config: {
  moderation: { type: 'boolean', label: 'Hold reviews for moderation', default: true },
  webhookUrl: { type: 'string', label: 'Notify URL', description: 'Posted to on each new review' },
  maxPerPage: { type: 'number', label: 'Reviews per page', default: 20 },
  blockedWords: { type: 'string[]', label: 'Blocked words' },
  apiToken: { type: 'string', label: 'API token', secret: true },
},
```

| key | means |
|---|---|
| `type` | `'string' \| 'number' \| 'boolean' \| 'string[]' \| 'json'`. **Required** |
| `label`, `description` | what an operator sees |
| `required` | install and upgrade **fail** without a value |
| `default` | used when the value is absent |
| `secret` | the value is a credential: redacted in logs and diagnostics, never echoed back |

## Values come from the project

```ts app/config/extensions.ts
export default defineExtensions([
  { resolve: '@acme/tangen-reviews', options: { moderation: false, maxPerPage: 50 } },
])
```

Configuration is per workspace. An operator can also edit declared options in
the Admin.

## Read it defensively

```ts
const handler = async (req, ctx) => {
  const moderation = (ctx.options?.moderation as boolean) ?? true
  const perPage = Number(ctx.options?.maxPerPage ?? 20)
}
```

`ctx.options` is the options object from this workspace's entry. **Read it with
a fallback every time**, even for a key with a `default`: a project may declare
you with no options at all, and a defensive read is one `??`.

A tidy pattern:

```ts src/config.ts
export interface ReviewsConfig { moderation: boolean; webhookUrl?: string; maxPerPage: number }

export function readConfig(options: Record<string, unknown> | undefined): ReviewsConfig {
  return {
    moderation: options?.moderation !== false,
    webhookUrl: typeof options?.webhookUrl === 'string' ? options.webhookUrl : undefined,
    maxPerPage: Number.isFinite(Number(options?.maxPerPage)) ? Number(options!.maxPerPage) : 20,
  }
}
```

One place that coerces, one type the rest of your code trusts, and it is a pure
function you can test.

## `required` is a real gate

```ts
webhookUrl: { type: 'string', label: 'Notify URL', required: true },
```

Install and upgrade fail without it. That is the right place for it - an
operator finds out while installing, not at 3am when the first review arrives.

Use `required` only for something with no sensible default. Everything else gets
a `default` and degrades.

## Site config your extension defines

`ctx.workspaceConfig?.()` returns the workspace's loaded config, so an
extension can read a settings key the site declares for it. **Read it
defensively**: the shape is whatever the site authored, the seam is absent on
runtimes that load no workspace config, and it is read-only by contract.

## Configuration is not secrets

A `secret: true` config value is a **per-workspace credential an operator
types**. A deployment-wide credential is a
[secret](/extend/data/secrets) - a deployment variable you declare by name.

If a value would be the same for every workspace on the deployment, it is a
secret, not config.

## Testing

```ts
import { describe, it, expect } from 'bun:test'
import { readConfig } from '../src/config'

describe('config', () => {
  it('applies defaults when a project declares no options', () => {
    expect(readConfig(undefined)).toEqual({ moderation: true, webhookUrl: undefined, maxPerPage: 20 })
  })
  it('coerces a bad number rather than propagating NaN', () => {
    expect(readConfig({ maxPerPage: 'lots' }).maxPerPage).toBe(20)
  })
})
```

## Related

- [Secrets](/extend/data/secrets) · [Writing a manifest](/extend/contract/manifest)
  · [Extension manifest reference](/reference/extension-manifest)
