---
title: Project structure
description: What each directory in a Tangen project is for, and which files you edit.
audience: site-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-f/clean-room#create
---

# Project structure

```text
app/
├── tangen.config.ts          # the CLI anchor: project name and schema path
├── config/                   # how the server runs - never schema, never hooks
│   ├── extensions.ts         #   which extensions this project declares
│   ├── auth.ts               #   site-user authentication
│   ├── storage.ts            #   where media lives
│   ├── mail.ts               #   the mailer
│   └── localization.ts       #   locales and fallbacks
├── workspaces/
│   ├── index.ts              # the workspace registry
│   └── <slug>/
│       └── workspace.config.ts
├── content-objects/          # your content model, one folder per type
│   ├── index.ts              #   barrel, maintained by `tangen add object`
│   └── <name>/
│       ├── schema.ts         #     required - defineObjectType + field.*
│       ├── hooks.ts          #     optional - content hooks
│       └── access.ts         #     optional - field-level access
├── globals/index.ts          # workspace-level singletons
├── fields/                   # reusable field groups
├── forms/                    # code-first form definitions
├── hooks/                    # site-wide content hooks
├── jobs/                     # scheduled jobs
└── generated/                # written by the CLI - do not edit
```

## The line that matters

**`config/` is for how the server runs. `content-objects/` is what your content
looks like.** Putting a content type in `config/` or a database URL in a schema
file is the most common structural mistake, and the two are validated
separately.

## The files you edit most

| file | when |
|---|---|
| `content-objects/<name>/schema.ts` | adding or changing a content type |
| `globals/index.ts` | adding a site-wide singleton |
| the deployment's `.env` | a new database, or a changed URL |
| `config/extensions.ts` | declaring an extension |

## The files you do not edit

`app/generated/` is written by `tangen push` and `tangen types`. Editing it is
pointless - the next push overwrites it. See
[Generated types](/build/getting-started/generated-types).

## Where content types live

One folder per type, and `tangen add object <name>` creates it:

```bash
bun run tangen add object article
```

That writes `content-objects/article/schema.ts` and adds it to the barrel. It
does **not** touch the database - `tangen push` does that.

## Related

- [Configuration reference](/reference/configuration) - every key in every
  config file
- [Generated types](/build/getting-started/generated-types)
- [Your first content type](/build/content-modeling/content-types)
- [CLI reference](/reference/cli)
