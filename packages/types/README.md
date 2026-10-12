# @tangen/types

Type definitions and config helpers for the Tangen headless CMS. Used by
`tangen.config.ts`, workspace registries, and every other `@tangen/*` package.

## Install

```sh
bun add @tangen/types
```

## Usage

```ts
import { defineWorkspace, defineWorkspaces, defineSiteConfig } from '@tangen/types'

// app/config/site.ts - the site's own keys; the deployment supplies the values
export default defineSiteConfig({
  supportEmail: { type: 'string', scopes: ['workspace', 'deployment'], clientSafe: true },
})

// app/workspaces/<slug>/workspace.config.ts
export default defineWorkspace({
  name: 'My Site',
  workspaceId: 'wsp_my_site',
  server: { url: 'https://cms.example.com' },   // or SERVER_URL on the deployment
})
```

The package also exports the shared interfaces (`WorkspaceConfig`,
`WorkspaceProject`, `CustomRoute`, `ObjectTypeDefinition`, …) consumed across
the platform.

## License

MIT
