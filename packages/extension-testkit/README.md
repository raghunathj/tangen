# @tangen/extension-testkit

Test an extension against the real Tangen kernel.

```ts
import { createTestCtx, withExtensions, contributionsOf, expectRefused, resetTestkit } from '@tangen/extension-testkit'
import manifest from '../tangen.extension'
import server from '../src/server'

afterEach(() => resetTestkit())

it('reindexes only what its grants allow', async () => {
  const ctx = createTestCtx({ extensionId: manifest.id, grants: manifest.grants?.required, tangen: myClient })
  await server.events![0]!.handler(event, ctx)
  expect(ctx.calls.enqueued).toEqual([{ taskId: 'seo:reindex', payload: { id: '1' } }])
  await expectRefused(() => ctx.emit!('seo.indexed', {}))   // no events:emit grant
})
```

`createTestCtx` builds a ctx under the same actor, policy and facility gate a
boot applies, from the manifest's `grants`; `withExtensions` registers fake
peers into the real contribution registry so `ctx.contributions` answers as in
production; `createMemoryStore` is an in-memory `ctx.store`; `expectRefused`
and `expectAllowed` name a refusal instead of asserting on an error's shape.
Documentation: `developer-docs/extend/shipping/testing.md`.
