---
title: Deployments
description: One build, one database, one role - what a deployment is, the three roles, and the production safety rules.
audience: operator
type: reference
status: stable
lastVerified: 2026-09-04
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Deployments

A **deployment** is one build of the project, one PostgreSQL database, the
secrets that process needs, and a **role**. Development, staging and
production are three deployments: three processes, three databases, three
`.env` files. There is no environment inside a database, no `?env=` on a
request, no `--env` on a command.

```text
Project (code: schema, extensions, routes, config)
  └─ Workspace (a site: its content, members, roles, media, extensions)
       └─ Deployment (build + one database + secrets + role)
            └─ Runtime (the process that serves it)
```

## The three roles

```bash
TANGEN_DEPLOYMENT_ROLE=development | staging | production
```

| role | for |
|---|---|
| `development` | building. Schema changes originate here; the Admin may write schema code |
| `staging` | review, and the rehearsal of a production change |
| `production` | live traffic |

**These are roles of the process, not names of databases.** You do not
invent a fourth; a value outside the three refuses the boot. When the
variable is unset, `NODE_ENV=production` means `production`,
`NODE_ENV=staging` means `staging`, and anything else is `development`. The
role is safety policy; it never selects content or a database.

## What is isolated

Each deployment has its own:

- **database** - `DATABASE_URL`, the one database the process opens. Every
  row of every workspace lives there; a request cannot reach another
- **content**, including drafts, versions, schedules and Releases
- **schema** - a type exists on a deployment once `tangen push` ran there
- **API keys, sessions and members** - issued and reconciled per deployment
- **media**, when the storage adapter or bucket differs
- **cache**, **Redis**, **search index**, **knowledge index**
- **extension installation state** - installed and enabled are per deployment
- **configuration and secrets** - the deployment's variables

Nothing is shared implicitly. There is no request parameter that crosses a
deployment boundary.

## Moving between them

| what | how |
|---|---|
| **schema** | `tangen push`, run on each deployment (from a laptop, a CI job, or a host inside the network). The plan is printed before anything is applied |
| **content, media, extension data, design assets** | Porter: **export** a bundle and **import** it, or an **instance-to-instance transfer** (the sending server streams the bundle to the receiver's API over a one-time code) |
| **a reviewed set of drafts, published together** | a **Release** - on the deployment where the drafts live. A Release never crosses a database |

Content does not flow automatically. Moving it is an explicit act.

## Production safety

Production is treated differently by the platform, not by convention. The
whole matrix is one function, `deploymentPolicy(role)`:

| protection | development | staging | production |
|---|---|---|---|
| secure refresh cookie | off | on | on |
| `JWT_SECRET` required (a generated secret is refused) | no | yes | yes |
| empty CORS allow-list fails closed | no | yes | yes |
| unmapped errors redacted from responses | no | yes | yes |
| the Admin schema builder writes code | yes | no | no |
| destructive schema push | with `--approve` per operation | with `--approve` per operation | refused |
| `tangen purge` (guarded drops, extension purge) | with approval | with approval | refused |
| seed and demo content | allowed | allowed | refused |
| developer tooling in the Admin | yes | no | no |
| config keys marked `required: 'production'` enforced | no | no | yes |

A drop on development or staging becomes a **guarded table** rather than a
deletion, kept aside until something explicitly purges it. On production a
destructive schema change is a reviewed migration outside `tangen push`.

## What the deployment supplies

A config file quotes no `process.env`. The URLs, Redis, storage, mail and
every key are the deployment's, read by one resolver at boot:

| the deployment sets | the resolver answers |
|---|---|
| `SERVER_URL`, `ADMIN_URL`, `FRONTEND_URL`, `FRONTEND_PREVIEW_URL` | `server.url`, `admin.url`, `frontend.url`, `frontend.previewUrl`; a development deployment defaults to localhost from `PORT` / `ADMIN_PORT` / `FRONTEND_PORT` |
| `REDIS_URL`, or `REDIS_ENABLED=false` | `redis.url` (missing is reported), `redis.enabled` (off on purpose is not) |
| `STORAGE_ADAPTER`, `AWS_S3_BUCKET`, `AWS_S3_REGION`, `AWS_S3_ENDPOINT`, `MEDIA_DIR`, `MEDIA_PUBLIC_BASE_URL` | `storage.*` |
| `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT` | `mail.*` |
| `JWT_SECRET`, `SMTP_USER`, `SMTP_PASS`, `AWS_ACCESS_KEY_ID`, the provider keys | secret **references** the deployment's provider resolves; a config file only ever names one |

The order is fixed for every key: defaults, then the workspace config, then
the deployment's variables, then secrets. A site declares its own keys in
`app/config/site.ts` (`defineSiteConfig`) and reads them as
`ctx.config.site` / `ctx.secrets` in routes and jobs; the Admin receives only
the keys marked `clientSafe`. `tangen doctor --deployment` explains every
key: value or reference, the layer that set it, and whether a reference
resolved. See [Configuration](/reference/configuration).

## One process, one database

**An API process has exactly one database**, resolved at boot from
`DATABASE_URL`. A deployed process with no URL refuses to start rather than
opening the local default. Every workspace of the project lives in that
database, isolated by `workspace_id`; a workspace that must live elsewhere
is its own deployment.

The CLI resolves the same variable: `tangen push` reaches the database of
the `.env` it runs with, and nothing on the command line points it
elsewhere (`--env` and `--prod` are refused with the reason).

## Admin accounts follow the database

`members` is an ordinary table, so it lives in the deployment's database.
Each deployment reconciles `app/config/members.ts` into its own members
table at boot (never a password), and runs its own `/setup` once to create
its first owner. A production database that does not contain your laptop's
login is the point.

## Coming from environments

Databases created before September 2026 held several environments side by
side. Migration `0051_remove_environments` keeps one environment's rows per
workspace and drops the rest; when a workspace holds data in more than one
it refuses and changes nothing until `TANGEN_KEEP_ENVIRONMENT=<slug>` names
the survivor. Export the others with Porter first; after the migration they
are deployments of their own.

## Related

- [Configuration](/reference/configuration) ·
  [Environment variables](/reference/environment-variables) ·
  [CLI](/reference/cli) · [Permissions](/reference/permissions)
