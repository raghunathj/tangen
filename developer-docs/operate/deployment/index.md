---
title: Deploying Tangen
description: "Deploying Tangen to production: what runs, what to configure, the secrets you need, and the `tangen start` command that serves the API."
audience: operator
type: guide
status: stable
lastVerified: 2026-09-04
verification: executable
verifiedBy: stage-g8/deployment + docs-pass/deployments
---

# Deploying Tangen

A Tangen deployment is **one API process**, **one PostgreSQL database**, and
somewhere to keep **media**. Redis is optional and enables several capabilities.

## Your laptop and your server are two deployments

The most common misreading is that one running Tangen holds development,
staging and production and you switch between them. It does not, and the
distinction decides how you deploy.

**An API process has exactly one database**, the one in its `DATABASE_URL`,
and one role, from `TANGEN_DEPLOYMENT_ROLE`. Nothing on a request selects a
database. So:

```text
your laptop                          your server
├── tangen dev                       ├── tangen start
├── DATABASE_URL=…/site_dev          ├── DATABASE_URL=…/site_prod
├── role: development (unset)        ├── TANGEN_DEPLOYMENT_ROLE=production
└── its own admin account            └── its own admin account
```

Two consequences worth knowing before your first deploy:

**You create an admin account once per database.** `members` is an ordinary
table, so the login you use locally does not exist on the server. The first
visit to a freshly provisioned deployment runs `/setup` and creates its owner.
That is intended: a production database that contains your laptop's password is
worse, not better.

**Content does not travel by itself.** Porter moves it: **export** a bundle
and **import** it, or an **instance-to-instance transfer**, where the sending
server streams the bundle to the receiving server's API over HTTP, because
nothing can open the other database for you. A Release publishes reviewed
drafts on the deployment where they live; it never crosses a database.

Schema is different from content and always travels the same way: `tangen
push`, run from a machine that can reach that deployment's database, with
that deployment's `.env`.

> A deployed process with no `DATABASE_URL` refuses to start rather than
> opening the local default, and a production role refuses destructive
> pushes, purges and seeds whatever is approved. See
> [Deployments](/reference/deployments).

## What runs

| piece | required | notes |
|---|---|---|
| the API process | **yes** | `tangen start`. Serves the REST API. **Not the Admin** - see below |
| PostgreSQL | **yes** | one database per deployment |
| media storage | **yes** | a persistent volume, or an S3-compatible bucket |
| Redis | no | queue, cache, realtime fan-out, and **preview tokens** |

Without Redis the queue, cache and fan-out fall back to PostgreSQL. Preview
still works: a token minted and spent against a server reporting
`capability redis: unavailable` returns the draft, so Redis is a performance and
fan-out dependency, not a correctness one for preview.

Several processes without Redis must set `REALTIME_FANOUT=postgres`, and
tell the platform how many there are (`TANGEN_REPLICAS`).

## Admin URLs and sessions across deployments

The Admin's URL path is `/{workspace}/…`; the session is a member token that
carries the workspace, the member and their role, and nothing else:

```json
{ "workspaceId": "wsp_acme", "role": "owner", "email": "…", "sub": "mem_…" }
```

One login covers the server it logged into. It does not cross to a different
server, because the account lives in that server's database.

The refresh token is an `HttpOnly` cookie with **no `Domain` attribute**, so it
is host-only: it is never shared with a sibling subdomain.

| arrangement | sessions | why |
|---|---|---|
| `admin.example.com` and `staging-admin.example.com` | **separate** | different hosts are different cookie jars, and the cookie has no `Domain`, so it never leaks to a sibling subdomain |
| localhost, several development instances | **separate** | on a development deployment the cookie is named `refresh_token_<PORT>` |
| **staging and production behind one host name**, on two ports | need `TANGEN_COOKIE_NAME` | browsers key cookies by host and ignore the port, so two deployed processes on one host would share `refresh_token`; set a name per deployment |

`Secure` is applied on staging and production roles; `TANGEN_COOKIE_SECURE`
overrides it in both directions, which is what a plain HTTP internal load
balancer that terminates TLS upstream needs.

### Pointing the Admin at its API

In development the Admin's Vite server proxies `/api` to the API process, so
the browser sees one origin and cookies simply work. Hosting the Admin
separately makes them two origins, and two things follow: the served
`index.html` names the API in its `tangen:config` meta tag, and the
deployment sets `ADMIN_URL` so the Admin's origin is allow-listed for CORS -
nothing is built in, nothing is repeated.

## Building and serving the Admin

`tangen start` runs the **API only**. `tangen dev` is what also runs the Admin,
by starting Vite inside the installed `@tangen/admin` against your project. For
a deployment you build the Admin once and serve the output as static files:

```bash
bun run tangen build          # writes dist/admin
```

Serve `dist/admin` from any static host - a CDN, an object store, nginx, or the
same reverse proxy that fronts the API. `--out <dir>` puts it somewhere else,
inside the project.

### One build, any host

The Admin reads its configuration at **runtime** from one public object,
`tangen:config`, so the same `dist/` works for staging and production and
behind any domain - and production needs no Admin server and no port of
its own. It looks in this order:

1. `window.__TANGEN_CONFIG__`, if a hosting page sets it before the bundle loads
2. the `tangen:config` meta tag in `index.html` (JSON)
3. **the Admin's own origin** - the default

Nothing is baked in at build time. Most requests already go to a relative
`/api/v1`, so if your proxy routes `/api` to the API from the same origin as
the Admin, **you configure nothing**. That is the arrangement to prefer.

To point a built Admin somewhere else, rewrite one line of the served
`index.html` - no rebuild:

```html
<meta name="tangen:config" content='{"apiUrl":"https://api.acme.com"}' />
```

The object never carries a secret or a server-only value: every field is
public by construction (`apiUrl` today). Both arrangements - same origin
behind one proxy, and split domains with one build - are proven in a real
browser against a real API by `test/browser/deployment.browser.ts`.

### CORS, when they are separate origins

An Admin on its own domain is a second origin, so the deployment must name
it. It is one variable, and its origin is allow-listed automatically:

```bash .env
ADMIN_URL=https://admin.example.com
```

You do **not** repeat it under `server.cors.origins`.

## What gets built

```bash
bun install
bun run tangen push       # schema, from a machine that can reach the database, with this deployment's .env
bun run tangen start      # the server
```

The generated artifacts in `app/generated/` are committed, so a build does not
need to reach the database to type-check.

**Which content tables a process serves.** A process builds its table
objects at boot from the schema registry of its database and refreshes them
when a push notifies it. The generated `content-tables.ts` is codegen and
type support; nothing at runtime depends on it.

## Required configuration

The minimum for a production process:

```bash
TANGEN_DEPLOYMENT_ROLE=production
DATABASE_URL=postgres://…
JWT_SECRET=…                      # required: the server refuses to boot without it
SERVER_URL=https://cms.example.com
FRONTEND_URL=https://example.com
ADMIN_URL=https://admin.example.com
MEDIA_DIR=/var/lib/tangen/media   # or STORAGE_ADAPTER=s3 with the bucket variables
```

The production role also keeps exception text out of 500 responses, makes the
refresh cookie `Secure`, and refuses destructive pushes, purges and seeds;
`NODE_ENV=production` derives the role when it is unset and switches to JSON
logs.

Every variable, with defaults and which are secret, is in
[Reference → Environment variables](/reference/environment-variables).

## Order

1. **Database reachable**, and empty or already migrated.
2. **Schema applied** - `tangen push` with this deployment's `.env`, the plan read.
3. **Secrets in place** - `JWT_SECRET` above all.
4. **Storage mounted** or the bucket configured and credentialed.
5. **Start the process.**
6. **Check health.**

Boot runs the platform's own system migrations unless `TANGEN_SKIP_MIGRATE=1`,
which is for operators who run `db:migrate` themselves.

## Health

```http
GET /api/health
```

Unauthenticated, and suitable as a liveness and readiness probe.

## Media

`MEDIA_DIR` must be a **persistent volume**. A container's filesystem is not
one, and every uploaded asset disappears on the next deploy. For anything with
more than one process, use an S3-compatible adapter instead - local disk is not
shared, and a production role on local media refuses to boot above one
replica.

## Secrets

From your platform's secret store, not a `.env` in the image. `JWT_SECRET`
signs member sessions and derives the site-session and SSO-token keys, so
rotating it invalidates sessions and stored SSO tokens.

## Schema changes on deploy

Applying schema is a **deliberate step with a plan you read**, not something a
container does on boot. Run `tangen push` from a job or a machine with database
access, before the new process starts.

### When the database is not reachable from your laptop

The usual arrangement: you develop locally, production's Postgres is inside a
private network, and port 5432 is not open to you. There is **no HTTP path** for
this - the Admin's schema endpoints are gated to the development role and a
writable source, because they are the Schema Builder, not a deploy channel.

So the push has to run somewhere the database is reachable. Two halves:

**Review the plan where you are.** `--plan` needs no database it can write to,
and `--json` makes it an artifact you can attach to a change request. Run it
against a copy of production, or against staging:

```bash
bun --env-file=.env.staging run tangen push --plan --json > plan.json
```

**Apply it where the database is.** A release job, a one-shot container, or a
shell on the box - anything inside the network, running the same commit with
production's variables:

```bash
bun install --frozen-lockfile
bun run tangen push       # prints the plan again, then applies
bun run tangen start      # only after the schema is in place
```

Order matters: the new process should not start against a database the new code
expects and the old schema does not provide.

> Platform migrations are different. The API runs those at boot, so the system
> tables appear when the process starts. **Content tables do not** - they come
> only from `tangen push`.

If you cannot reach the database from anywhere you control, you cannot migrate
it, and no Tangen command changes that. A bastion, a temporary tunnel, or a job
inside the network is the answer, and it is an infrastructure decision rather
than a Tangen one.

Production refuses destructive operations regardless of approval - see
[the schema workflow](/build/getting-started/schema-workflow).

## Related

- [Deployment scenarios on one machine](/operate/deployment/scenarios): three
  developer mindsets rehearsed locally with hosts-file domains and a sample
  reverse proxy
- [Environment variables](/reference/environment-variables) ·
  [Deployments](/reference/deployments) ·
  [Configuration](/reference/configuration) ·
  [Deployments in practice](/build/deployments)
