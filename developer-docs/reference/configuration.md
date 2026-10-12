---
title: Configuration
description: Every public configuration file, the define* helper it uses, and what belongs in each.
audience: site-developer
type: reference
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-01
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Configuration

A Tangen project's configuration is TypeScript. Every file exports through a
`define*` helper from `@tangen/cms`, which gives you type checking on the shape
before anything runs.

**`app/config/` is for how the server runs.** Content types are not
configuration - they live in `app/content-objects/` and are applied with
`tangen push`.

## The files

| file | helper | holds |
|---|---|---|
| `app/tangen.config.ts` | - | the CLI anchor: project name and schema path. Keep it thin |
| `app/workspaces/index.ts` | `defineWorkspaces` | the workspace registry |
| `app/workspaces/<slug>/workspace.config.ts` | `defineWorkspace` | one workspace, composing the barrels below |
| `app/config/extensions.ts` | `defineExtensions` | which extensions this project declares |
| `app/config/auth.ts` | `defineAuthConfig` | site-user authentication |
| `app/config/storage.ts` | `defineStorageConfig` | where media lives |
| `app/config/mail.ts` | `defineMailConfig` | the mailer and form notifications |
| `app/config/localization.ts` | `defineLocalizationConfig` | locales and fallbacks |
| `app/globals/index.ts` | `defineGlobals` | workspace-level singletons |
| `app/config/ai.ts` | - | Content AI providers and models |
| `app/config/graphql.ts` `knowledge.ts` `mcp.ts` `dashboard.ts` `forms.ts` | - | per-capability options |

## The database

A deployment has one database, and it is never in a config file:

```bash .env
DATABASE_URL=postgres://user:pass@host:5432/my_site
TANGEN_DEPLOYMENT_ROLE=development
```

Every command and the API read `DATABASE_URL` through one resolver; a
deployed process with no URL refuses to start. See
[Deployments](/reference/deployments).

## Server and frontend

```ts tangen.config.ts (the workspace)
server: { url: 'https://cms.example.com', cors: { origins: ['https://example.com'], credentials: true } },
frontend: { url: 'https://example.com', previewUrl: 'https://example.com/preview?id={id}' },
```

| key | type | required | means |
|---|---|---|---|
| `server.url` | `string` | no | the API's public URL, used for self-referencing links |
| `server.cors.origins` | `string[]` | no | allowed origins. `['*']` is not recommended in production |
| `server.cors.credentials` | `boolean` | no | allow credentialed requests |
| `frontend.url` | `string` | no | your site, used for CORS and redirect links |
| `frontend.previewUrl` | `string` | no | preview template with `{id}`, `{type}`, `{slug}` |
| `frontend.previewUrls` | `Record<string, string>` | no | per-type preview overrides, falling back to `previewUrl` |
| `gateway` | `GatewayConfig` | no | CORS, rate limits and request limits for this workspace. A workspace may only **narrow** what the operator's ceiling (the `gateway` key of the root `tangen.config.ts`, which also holds `trustedProxy`) allows |

The URLs are the deployment's: `SERVER_URL`, `ADMIN_URL`, `FRONTEND_URL` and
`FRONTEND_PREVIEW_URL` in its variables win over the config, and a
development deployment defaults to localhost. There are exactly three
deployment roles. See [Deployments](/reference/deployments).

## Extensions

```ts app/config/extensions.ts
import { defineExtensions } from '@tangen/cms'

export default defineExtensions([
  { resolve: '@acme/tangen-analytics', options: { siteId: 'abc' } },
  { resolve: '../../extensions/my-extension' },   // a path, for one you are writing
])
```

`resolve` takes a package specifier or a path relative to `app/`. Use the
package specifier for anything installed; the path form is for an extension
living inside your own repository while you develop it. `options` is handed to
that extension as [`ctx.options`](/extend/configuration).

`resolve` is an npm package name or a path in your project. Declaring an
extension makes it **available**; installing and enabling it is per deployment
and lives in its database (`tangen extension install <id>`).

A new project starts with `defineExtensions([])`.

## Storage

```ts app/config/storage.ts
import { defineStorageConfig } from '@tangen/cms'

export default defineStorageConfig({
  adapter: 's3',
  bucket: process.env.S3_BUCKET!,
  region: process.env.S3_REGION!,
})
```

Changing the adapter does not move existing files, and delivery always goes
through the *current* adapter.

## Secrets

Configuration files are code and are committed. **Secrets are not.** A
credential is a **reference**: the config names the variable, the deployment
supplies the value, and `DATABASE_URL` itself is never in a file:

```ts
ai: { apiKey: { anthropic: 'ANTHROPIC_API_KEY' } },   // the NAME of the variable
clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
```

Which variables exist is [Environment variables](/reference/environment-variables).
Extension secrets are declared in the manifest and are covered in
[Extension manifest](/reference/extension-manifest).

## Related

- [Environment variables](/reference/environment-variables) ·
  [Deployments](/reference/deployments) ·
  [Authentication](/reference/authentication) ·
  [Public contract](/reference/public-contract)
