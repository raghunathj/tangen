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
bunx @tangen/cli create northwind \
  --name "Northwind Systems" \
  --db postgres://localhost:5432/northwind_dev
cd northwind
```

Create the tables. **Bootstrap comes before push**: bootstrap creates the system
tables that everything else needs, and `tangen push` on a database without them
stops and names this command.

```bash
bun x tangen bootstrap development
```

Start the API and the admin panel together:

```bash
bun run dev
```

Then open `http://localhost:3001` and create your admin account. You need it in
chapter 6.

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
