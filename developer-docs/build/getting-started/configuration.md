---
title: Configuring a project
description: Which config file to reach for, what the deployment supplies, and where secrets go.
audience: site-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-g4/getting-started
---

# Configuring a project

Every config file exports through a `define*` helper, so the shape is checked
before anything runs.

## Which file

| you want to | edit |
|---|---|
| point at a database, or change a URL | the deployment's `.env` (`DATABASE_URL`, `SERVER_URL`, `FRONTEND_URL`) |
| declare an extension | `config/extensions.ts` |
| turn on site-user accounts | `config/auth.ts` |
| move media to S3 | `config/storage.ts` |
| send mail | `config/mail.ts` |
| add a language | `config/localization.ts` |
| add a site-wide setting | `globals/index.ts` |

## Deployments

The workspace config says what the site is. Where it runs is the
deployment's `.env`: one database, one role, its URLs.

```bash .env  (development, the laptop)
DATABASE_URL=postgres://localhost:5432/my_site_dev
# TANGEN_DEPLOYMENT_ROLE is unset: development, localhost URLs
```

```bash .env  (production, the server)
DATABASE_URL=postgres://.../my_site_prod
TANGEN_DEPLOYMENT_ROLE=production
SERVER_URL=https://cms.example.com
FRONTEND_URL=https://example.com
ADMIN_URL=https://admin.example.com
```

```ts app/tangen.config.ts  (values every deployment shares)
server: { cors: { origins: ['https://example.com'] } },
frontend: { previewUrl: 'https://example.com/preview?id={id}' },
```

There are exactly three roles - `development`, `staging`, `production` - and
each is a deployment of its own. Nothing on a request or a command selects
between them. See [Deployments](/reference/deployments).

## Secrets

Config files are committed. Secrets are not. A config file names the
variable; the deployment supplies the value:

```ts
ai: { apiKey: { anthropic: 'ANTHROPIC_API_KEY' } },   // a name, never a value
```

Never put a connection string, a key or a client secret in the file itself.

## Verify

```bash
bun run tangen check
```

`check` validates the schema and configuration without touching the database.

## Common mistakes

- **A content type in `config/`.** Content types live in `content-objects/`.
- **`dev` instead of `development`.** The role is the slug.
- **A literal secret in a config file.** It is committed the moment you save it.
- **Expecting a config change to reach the database.** Schema changes need
  `tangen push`; server config is read at boot.

## Related

- [Configuration reference](/reference/configuration) - every key
- [Environment variables](/reference/environment-variables)
- [Deployments](/reference/deployments)
