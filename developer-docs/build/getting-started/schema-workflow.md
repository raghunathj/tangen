---
title: The schema workflow
description: check, diff, push - and how to read the plan before you apply it.
audience: site-developer
type: guide
status: stable
package: "@tangen/cli"
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-f/clean-room#push
---

# The schema workflow

Your content model is code. The database catches up when you tell it to.

```bash
bun run tangen check     # is the model valid?
bun run tangen diff      # what would change?
bun run tangen push      # apply it
```

## Read the plan

`push` prints its plan and then applies it. The plan names every statement in
order, and marks anything destructive.

```text
Plan for development
  + CREATE TABLE "article"
  + ADD COLUMN  "article"."subtitle" TEXT
  - DROP COLUMN "article"."teaser"   [guarded: recoverable until purged]
```

**Read it.** It is the last point at which a mistake is cheap.

To see the plan without applying:

```bash
bun run tangen push --plan
bun run tangen push --plan --json    # for a script
```

## Destructive changes

Removing a field or a type can lose data, so it needs an explicit approval that
names the operation:

```bash
bun run tangen push --approve drop-field:article.teaser
```

Four rules, and none of them has an override:

1. **Every destructive operation needs its own token.** Approving one never
   approves another.
2. **Production refuses destructive operations**, whatever you approve.
3. **A drop is guarded** - renamed aside and recoverable until an approved
   purge, not deleted.
4. **Ambiguous operations never apply.** Safe operations in the same plan still
   do.

Push tells you the exact tokens it wants.

## Renaming without losing data

Do not delete and recreate. Declare the old name:

```ts
subtitle: field.text({ label: 'Subtitle', previousName: ['teaser'] }),
```

The plan then shows a rename, and the data moves with it.

## After a push

`push` regenerates the types and the table artifacts as its final step, so your
editor is correct the moment it finishes. If it disagrees, run `tangen types`.

## Taking a change forward

Each deployment has its own database. Push on development, then on staging,
then on production - the same code, applied three times from wherever can
reach each database, with the plan read each time.

## Common mistakes

- **Approving a drop to "get past" a refusal in production.** It will not work,
  and it is not meant to.
- **Editing `app/generated/`** instead of the model.
- **Assuming a push moved content.** It moves *schema*. Content moves through a
  [Release](/build/deployments).

## Related

- [CLI reference](/reference/cli) · [Deployments](/reference/deployments) ·
  [Fields reference](/reference/fields) ·
  [Generated types](/build/getting-started/generated-types)
