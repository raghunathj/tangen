---
title: Cache and production
description: What caching does to a read, and running the site in production mode with no build step.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch13
---

# 13. Cache and production

**Goal** understand the cache lifecycle, and boot the site in production.

**Prerequisites** [chapter 12](/learn/enterprise-website/deployments).

## The cache, in four reads

You configured nothing. Reads are cached, and a publish invalidates:

```text
cold read            620 ms   'About'
warm read             13 ms   'About'
edit, then publish
next read              5 ms   'About Northwind'      ← the NEW value
warm again             3 ms   'About Northwind'
```

Those numbers are one laptop with no Redis, on the Postgres fallback. **The
numbers are not the contract; the lifecycle is.** What you can rely on is that a
publish makes the next read return the new value, without you clearing anything.

That is the whole story for a site developer. Redis makes it faster and shared
across processes; it does not change the behaviour above.

## Production

Create the database, then provision it exactly like staging - with its own
`.env`:

```bash .env.production
DATABASE_URL=postgres://localhost:5432/northwind_prod
TANGEN_DEPLOYMENT_ROLE=production
JWT_SECRET=<32+ random characters>
SERVER_URL=https://cms.northwind.example
FRONTEND_URL=https://northwind.example
ADMIN_URL=https://admin.northwind.example
```

```bash
createdb northwind_prod
bun --env-file=.env.production x tangen bootstrap
bun --env-file=.env.production x tangen push
bun --env-file=.env.production x tangen extension install seo
bun --env-file=.env.production x tangen extension install flows
```

## There is no build step

`tangen start` runs the server from your TypeScript under Bun. There is no
bundle, no `dist/`, no compile stage to get wrong in CI.

```bash
bun --env-file=.env.production x tangen start
```

`TANGEN_DEPLOYMENT_ROLE=production` makes this a **production deployment**:
secure cookies, a required `JWT_SECRET`, redacted errors, and no destructive
push, purge or seed. The process holds the one database in its
`DATABASE_URL` and nothing else, so serving the wrong data is impossible
rather than unlikely.

## Expected result

```text
deployment role: production
```

```bash
curl 'http://localhost:3000/api/health?deep=1'
{"status":"ok","version":"0.1.x","checks":{"postgres":{"ok":true}}}
```

Use `/api/health` as a liveness probe and `?deep=1` as readiness: the deep
variant actually queries the database, so it fails when Postgres is unreachable
rather than reporting a healthy process in front of a dead one.

## What production needs

- `DATABASE_URL`, production's own
- `JWT_SECRET`, at least 32 characters
- `TANGEN_DEPLOYMENT_ROLE=production`
- `SERVER_URL`, `FRONTEND_URL` and `ADMIN_URL`, the real domains
- an API key created **on the production deployment**; keys do not cross

## Where this tutorial stops

At a production-ready, host-neutral runtime. Which container platform or VM you
put it on is your decision and does not change anything above.

## Verification

- the boot log says `deployment role: production`
- `?deep=1` reports `postgres: ok`
- a read against production returns no content until you move some there with Porter

## Common mistake

**Reusing the development API key in production.** A key belongs to one
deployment's database. It does not exist on the other one, and the failure is
an auth error.

## Relevant canonical docs

- [Deployment](/operate/deployment) - hosts, probes, secrets
- [Running Tangen](/operate) · [Caching](/build/performance)
- [Environment variables](/reference/environment-variables)
