---
title: Your first extension
description: The smallest extension that installs, runs and can be verified.
audience: extension-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g7/hello
---

# Your first extension

The smallest useful extension: one server route, one Admin page, no database of
its own.

## Scaffold

```bash
bun run tangen extension create
```

It writes the manifest, the entries and a `package.json`, and appends the
extension to `app/config/extensions.ts`.

## The manifest

```ts extensions/hello/tangen.extension.ts
import type { TangenExtensionManifest } from '@tangen/cms'

export default {
  id: 'acme.hello',
  name: 'Hello',
  version: '0.1.0',
  description: 'A minimal Tangen extension.',

  config: {
    greeting: { type: 'string', label: 'Greeting', default: 'Hello' },
  },

  server: './src/server.ts',

  pages: [
    {
      path: '',
      component: 'HelloPage',
      nav: { label: 'Hello', icon: 'IconPuzzle', section: 'extensions' },
    },
  ],
} satisfies TangenExtensionManifest
```

`pages[].component` is the **name of a named export** of the browser entry, not
a function. The manifest holds no functions.

## The server entry

```ts extensions/hello/src/server.ts
import type { TangenExtensionServer } from '@tangen/cms'

export default {
  adminRoutes: [
    {
      method: 'GET',
      path: 'greeting',
      auth: 'member',
      handler: async (req, ctx) => {
        const greeting = (ctx.options?.greeting as string) ?? 'Hello'
        return { greeting, role: ctx.deploymentRole?.() ?? null }
      },
    },
  ],
} satisfies TangenExtensionServer
```

That mounts at `GET /api/v1/admin/ext/acme.hello/greeting` and answers to
member sessions only.

## The browser entry

```tsx extensions/hello/src/index.ts
export { HelloPage } from './pages/HelloPage'
```

```tsx extensions/hello/src/pages/HelloPage.tsx
import { useParams } from 'react-router-dom'

export function HelloPage() {
  const { workspaceId, env } = useParams<{ workspaceId: string; env: string }>()
  return (
    <div>
      <h1>Hello</h1>
      <p>Workspace {workspaceId}.</p>
    </div>
  )
}
```

A page gets **no injected props**. Read the workspace from the route with
`useParams()`, because it is the identity everything else is scoped by.

## Declare, install, enable

```ts app/config/extensions.ts
export default defineExtensions([
  { resolve: '../../extensions/hello', options: { greeting: 'Hi' } },
])
```

```bash
bun run tangen extension install acme.hello
bun run tangen extension enable  acme.hello
bun run tangen extension list
```

Declaring makes it available. Installing and enabling are separate acts, per
deployment, and they are an operator's to make.

## Verify

The page appears in the Admin sidebar under Extensions, at
`/:workspaceId/:env/extensions/acme.hello`. The route answers:

```bash
curl -H "Authorization: Bearer <member session>" \
  https://localhost:3000/api/v1/admin/ext/acme.hello/greeting
```

Disable it and both disappear:

```bash
bun run tangen extension disable acme.hello
```

That is the property worth checking first: a disabled extension contributes
**nothing** - no nav item, no page, no route.

## What to add next

- [Migrations](/extend/data/migrations) if it needs tables
- [Secrets](/extend/data/secrets) if it calls an external service
- [Capabilities](/extend/contract/capabilities) if it depends on media, search
  or another extension

## Related

- [Extension structure](/extend/introduction/structure) ·
  [Admin contributions](/extend/contributions/admin) ·
  [Server routes](/extend/contributions/routes) ·
  [Local development](/extend/shipping/local-development)
