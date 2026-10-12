---
title: Deployments in practice
description: Developing on one deployment, taking schema and content to the next, and staying safe in production.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-04
verification: executable
verifiedBy: stage-g6/ch12
---

# Deployments in practice

Three roles - `development`, `staging`, `production` - and each is a
deployment of its own: one process, one database (`DATABASE_URL`), one
role (`TANGEN_DEPLOYMENT_ROLE`), one `.env`. Nothing is shared implicitly,
and nothing on a request or a command line selects between them.

## Day to day

You work on the development deployment. Your model changes there, your test
content lives there, and your local frontend points at it.

```bash
bun run tangen push
```

## Taking a schema change forward

Each deployment has its own database, so the same code is applied three
times - from wherever can reach each database:

```bash
bun run tangen push                    # on your laptop: the development database
# in CI, with staging's .env:          tangen push
# on a host inside the network:        tangen push   (production's .env)
```

Read the plan each time. The plan for production is not the plan for
development, because the two databases are in different states.

**Production refuses destructive operations.** Remove a field on
development, verify on staging, and take the removal to production as a
reviewed migration - there is no flag that skips this.

## Taking content forward

Schema and content move by different mechanisms, and conflating them is the
usual confusion:

| moving | mechanism |
|---|---|
| **schema** - types, fields, tables | `tangen push` on each deployment |
| **content, media, extension data** between deployments | **Porter**: export a bundle and import it, or an instance-to-instance transfer |
| **a reviewed set of drafts**, published together on one deployment | a **Release** |

A push never moves content. A Release never crosses a database.

### Porter

Porter moves data as a bundle: export, import, and instance-to-instance
transfer. Ids are stable across deployments and a slug match updates in
place, so a re-import is idempotent. Credentials, sessions and API keys
never travel.

### Releases

A Release is a reviewed, frozen set of drafts of one workspace that
publishes together, in place. **Releases are created, approved and applied
in the Admin or over the API.** The CLI is read-only on them:

```bash
bun run tangen release list                      # status, approval, schedule
bun run tangen release status <id>               # items in apply order, outcomes
```

That split is deliberate: applying a release is an approval-gated act, not
something a script should be able to do because it had a terminal.

The properties that matter to you:

- **The approved payload is frozen.** What was reviewed is what publishes;
  the drafts cannot drift between approval and application.
- **One object belongs to at most one open Release.**
- **Preflight runs first**, and reports what would block.
- **There is no force apply.** A release that cannot apply is fixed and
  retried, not overridden.
- **History is kept**, so what was published when is answerable.

Releases can be scheduled and retried.

## Configuration that differs

The workspace config says what the site is; the deployment's variables say
where it runs:

```bash .env  (the production deployment)
DATABASE_URL=postgres://.../northwind_prod
TANGEN_DEPLOYMENT_ROLE=production
SERVER_URL=https://cms.example.com
FRONTEND_URL=https://example.com
ADMIN_URL=https://admin.example.com
```

Keys, media storage, cache and extension installation state are all per
deployment. An extension enabled on development is not enabled on production
until someone enables it there.

## Capabilities differ too

A capability can be `on` on one deployment and `off` or `unavailable` on
another. Code that assumes search exists will fail where it does not -
check, and degrade.

## Testing on staging

Staging exists to rehearse. Push the schema there first, import the content
there first, and look. A production incident that staging would have caught
is the most expensive kind.

## Common mistakes

- **`--env` anything.** There is no such flag; run the command from the
  deployment you mean.
- **Expecting a push to bring content with it.**
- **Approving a destructive operation to "force" production.** It refuses
  regardless.
- **Assuming extension state travels.** Install and enable are per
  deployment.

## Related

- [Deployments reference](/reference/deployments) ·
  [The schema workflow](/build/getting-started/schema-workflow) ·
  [CLI reference](/reference/cli) · [Deploying](/operate/deployment)
