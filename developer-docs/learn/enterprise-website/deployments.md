---
title: Deployments and permissions
description: A staging deployment with the same schema and none of the data, and which credential each actor uses.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-04
verification: executable
verifiedBy: stage-g6/ch12
---

# 12. Deployments and permissions

**Goal** a staging deployment with the same schema and none of the data, and a
clear answer to who holds which credential.

**Prerequisites** [chapter 11](/learn/enterprise-website/flow).

## Four words that are not synonyms

| word | is |
|---|---|
| **project** | the directory on disk |
| **workspace** | one site's content and configuration (`wsp_northwind_systems`) |
| **deployment** | one process with one database and one role: development, staging, production |
| **process environment** | the variables the server process reads (`.env`) |

The confusion that costs time is the last two. `DATABASE_URL` is a process
variable that tells one deployment where **its** database lives; the staging
deployment has its own `.env` with its own `DATABASE_URL`.

## Three roles, not arbitrary names

Tangen has exactly three deployment roles, set by `TANGEN_DEPLOYMENT_ROLE`.
They are roles of the process, not labels on a database, and things behave
differently by role: chapter 14's robots policy is the clearest example.

## Add staging

```bash
createdb northwind_staging
```

The scaffold's `.env` is the development deployment. Staging is a second
`.env`, used by the commands that act on it:

```bash .env.staging
DATABASE_URL=postgres://localhost:5432/northwind_staging
TANGEN_DEPLOYMENT_ROLE=staging
JWT_SECRET=<a different secret>
PORT=3100
```

Then the same two commands, in the same order, against that file:

```bash
bun --env-file=.env.staging x tangen bootstrap
bun --env-file=.env.staging x tangen push
```

## Expected result

Same schema, no content:

```text
northwind_dev       tables=72   pages=6
northwind_staging   tables=72   pages=0
```

That is the entire point. Staging is a real deployment, not a copy, and
content gets there by being moved with Porter rather than by being shared.

Extensions are per deployment too, so staging needs its own:

```bash
bun --env-file=.env.staging x tangen extension install seo
bun --env-file=.env.staging x tangen extension install flows
```

## Who holds what

| actor | credential | can |
|---|---|---|
| your server process | an API key, `Authorization: Bearer tgn_…` | read published content it is scoped to |
| an editor | an admin session from `/api/auth/login` | everything their role allows |
| a visitor | none | read a public form schema, submit a form, load a media transform |

Northwind's key is read-only on objects, globals, media and forms. A website
never writes.

**The key never reaches a browser.** It is read by your server, and data goes
down to the page. A key in a bundle is a public key, and it is scoped to the
whole workspace on that deployment. A key issued on staging does not exist on
production: each deployment issues its own.

## Verification

- both databases report the same table count
- staging returns no content
- `bun --env-file=.env.staging x tangen extension list` shows both
  extensions installed

## Common mistake

**Assuming one `.env` covers every deployment.** Each deployment has its own
`DATABASE_URL` and its own role; a command run with the wrong file acts on
the wrong database, and a production role refuses destructive work whatever
you approve.

## Relevant canonical docs

- [Deployments](/build/deployments) - the model, Porter and Releases
- [Deployments reference](/reference/deployments) · [Environment
  variables](/reference/environment-variables)
- [Permissions](/reference/permissions) - key scopes and roles
- [Authentication](/reference/authentication)
