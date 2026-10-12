---
title: Secrets
description: "API keys and other credentials an extension reads: declaring them by name, reading their values from the environment, and not leaking them."
audience: extension-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-16
verification: source
verifiedBy: packages/types/src/extension.ts
---

# Secrets

A secret is a **deployment-wide credential** the deployment's secret
provider resolves (self-hosted: the process environment). You declare the
variable **names**; the values never touch your manifest, your repository,
your options or your logs.

```ts tangen.extension.ts
secrets: ['ACME_REVIEWS_KEY', 'ACME_REVIEWS_WEBHOOK_SECRET'],
```

That is a list of variable names, and nothing else. Declaring them registers
`ext.<id>.secret.<NAME>` as a secret reference: the platform resolves it at
boot, reports whether it resolved, requires it in production, and never reads
the value into anything it might print.

## Secret or config

| | use |
|---|---|
| the same value for every workspace on this deployment - an API key for a service you own | **`secrets`** - a deployment variable |
| a different value per workspace, typed by an operator in the Admin | **`config`** with `secret: true` |

Getting this wrong is the common mistake. A vendor API key that is yours is a
secret. A customer's own webhook token is secret config.

## Reading one

Ask `ctx.secrets` for the name you declared, at the point of use:

```ts src/server.ts
export default {
  adminRoutes: [
    {
      method: 'POST', path: 'sync', auth: 'member', capability: 'reviews:moderate',
      handler: async (req, ctx) => {
        const key = ctx.secrets?.get('ACME_REVIEWS_KEY')
        if (!key) {
          ctx.log('ACME_REVIEWS_KEY is not set; sync is unavailable')
          return { ok: false, reason: 'This deployment has no Acme credential configured.' }
        }
        return { ok: true, synced: await sync(key) }
      },
    },
  ],
} satisfies TangenExtensionServer
```

**At the point of use, not at import.** `ctx.secrets` is scoped to your
extension (its declared `secrets` and its `secret: true` config fields) and
answers from the deployment's provider each time. A module-scope
`const KEY = process.env.…` would read the process when the file is imported -
the import-time work the lifecycle forbids - and would bypass the one reader
the platform accounts for. Extension code does not read `process.env`.

## Under grants

If your manifest declares [`grants`](/reference/extension-manifest#grants),
`ctx.secrets` answers your own declared names as before, and a platform-wide
secret only when a `secrets:<name>` grant names it. Reading one you were not
granted throws rather than returning `undefined`, so a missing grant is a
visible error and never a silent empty value.

## Absent is a normal state

A deployment may not have your secret. That is not an exception - it is a
capability that is unavailable here.

- **Say what is missing**, by variable name, in a message an operator can act
  on.
- **Do not throw** on a missing secret at boot.
- **Do not fall back** to a default credential.

## Never leak one

- **Never log a value.** Log the variable's *name* and that it is absent.
- **Never return one** in a route response, an error, or a diagnostic.
- **Never put one in your browser entry.** It ships to every editor's browser.
- **Never put one in a manifest, a config file or a test fixture.**
- **Never echo it back** from a settings page. `secret: true` config is
  write-only from the Admin's side, and yours should be too.

An error from an external service can contain the credential you sent it. Do
not pass a provider's message through:

```ts
catch (e) {
  ctx.log('acme sync failed')        // not e.message
  return { ok: false, reason: 'The Acme service rejected the request.' }
}
```

## Rotation

Secrets are read from the environment at the point of use, so rotating one is a
deployment concern: change the variable, restart. Your extension needs no
rotation logic - which is another reason not to cache the value in a
module-scope constant.

## Testing

Test both states, and use an obvious fake:

```ts
describe('sync', () => {
  it('reports unavailable when the credential is absent', async () => {
    delete process.env.ACME_REVIEWS_KEY
    const res = await route.handler(req, ctx)
    expect(res.ok).toBe(false)
    expect(res.reason).not.toContain('undefined')
  })

  it('never returns the credential', async () => {
    process.env.ACME_REVIEWS_KEY = 'test-not-a-real-key'
    const res = await route.handler(req, ctx)
    expect(JSON.stringify(res)).not.toContain('test-not-a-real-key')
  })
})
```

The second test is the one worth writing. It fails the day someone adds a debug
field to a response.

## Related

- [Configuration](/extend/data/configuration) ·
  [Permissions and security](/extend/contributions/permissions) ·
  [Environment variables](/reference/environment-variables)
