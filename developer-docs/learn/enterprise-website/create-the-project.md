---
title: Create the project
description: Scaffold Northwind Systems, create its database, and get the API, admin and a health check answering.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch1
---

# 1. Create the project

**Goal** a running Tangen project called Northwind Systems, with an admin
account and a health endpoint that answers.

**Prerequisites** Bun, and a PostgreSQL you can create databases in.

## What we are building

Nothing yet. This chapter gets the platform running so the next thirteen have
somewhere to put the site.

If you have already finished [Quick start](/learn/quick-start), this is the same
setup with a different workspace name, and you can move faster.

## Steps

Create the database first. Tangen will not create it for you, and the error if
it is missing is the first one people hit:

```bash
createdb northwind_dev
```

Scaffold the project. The `--name` and `--db` flags skip every prompt, which is
also the form to use in CI:

```bash
bunx @tangen/cms create northwind \
  --name "Northwind Systems" \
  --db postgres://localhost:5432/northwind_dev
cd northwind
```

`@tangen/cms` is the only package you name, and that one command scaffolds the
project, installs the dependencies and creates the tables - including the
**workspace row** the admin's setup page needs before you can make an account.

**The tables come before push**, and `create` has already made them. A
`tangen push` against a database without them stops and names
`tangen bootstrap`, which is what you run if you skipped the `--db` prompt, and
what staging and production always need because `tangen dev` never runs there.

Start the API and the admin panel together:

```bash
bun run dev
```

Then open `http://localhost:3001`. With no owner yet it sends you to
`/<workspace-id>/setup` (`wsp_northwind_systems`), which asks for your name, a
real email address and a password of at least 8 characters, and makes that
account the workspace owner. It is one-shot - once an owner exists the page
answers `410 Gone`. You need this account in chapter 6.

## Expected result

```bash
curl http://localhost:3000/api/health
{"status":"ok","version":"0.1.x"}
```

`?deep=1` adds a real database check, which is the one to use as a readiness
probe:

```bash
curl 'http://localhost:3000/api/health?deep=1'
{"status":"ok","version":"0.1.x","checks":{"postgres":{"ok":true}}}
```

## Verification

- `http://localhost:3000/api/health` answers `ok`
- `http://localhost:3001` shows the admin panel and accepts your new account
- `app/` exists, with `config/`, `content-objects/`, `components/` and
  `workspaces/northwind-systems/`

## Why this matters

Two ports, two things. `3000` is the API your site reads; `3001` is the admin
your editors use. They are separate processes started by one command, and
`bun run dev` runs both.

## Common mistake

**Running `tangen push` first.** Push applies your schema; bootstrap creates the
database structure push writes into. The order is bootstrap, then push, and the
error message says so.

## Relevant canonical docs

- [Quick start](/learn/quick-start) - the same ground, explained at length
- [CLI reference](/reference/cli) - every command and flag
- [Project structure](/build/getting-started) - what each directory is for
- [Environment variables](/reference/environment-variables)
