---
title: Running in production
description: What changes between a development server and a production one, and what has to be set before it starts.
audience: operator
type: guide
status: stable
package: "@tangen/cli"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-f/clean-room#production-boot
---

# Running in production

## There is no build step

A Tangen server runs its TypeScript directly under Bun. There is no bundle, no
`dist/`, no compile step to schedule. `tangen start` is the production entry
point:

```sh
TANGEN_DEPLOYMENT_ROLE=production tangen start
```
The banner reports what it resolved:

```text
◆ tangen  workspace: wsp_northwind_systems  env: production
  mode          production
  api           http://localhost:3000
```
`mode production` is how you know you are not accidentally serving a
development configuration.

## Before it starts

Production is one of the three deployment roles, and it needs its own
database:

```sh
DATABASE_URL_PRODUCTION=postgres://…
JWT_SECRET=…
```
`JWT_SECRET` is the one that bites. Unset, the server generates a development
secret and says so - which is fine locally and means every restart invalidates
every session in production.

Then, once per database:

```sh
tangen bootstrap                 # creates the schema (with production's .env)
tangen push                      # applies your content model
```
`bootstrap` before `push`. A push against a database nobody bootstrapped now
tells you so by name, but the order is still the order.

## What differs from development

| | development | production |
|---|---|---|
| schema changes | `tangen push` as you work | a deliberate, reviewed step |
| `JWT_SECRET` | generated if absent, with a warning | set it |
| database | its own | its own, never shared |
| content | whatever you seeded | moved with Porter, not copied by hand |

Deployments share the code and never share data. Pushing on production applies
the same content model to a different database; it moves no content.

## Related

- [Deployments](/build/deployments)
- [Deployment](/operate/deployment)
- [CLI reference](/reference/cli)
