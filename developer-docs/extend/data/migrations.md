---
title: Migrations
description: Owning tables safely - when migrations run, and the rules that never bend.
audience: extension-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g9/packaged-migrations
---

# Migrations

An extension may own tables. It creates them **only** through declared
migrations, which run at INSTALL and UPGRADE - the same for an extension inside
your project and one installed from a registry.

One declaration is enough: the manifest names the file and `files` ships it.
You do **not** add an `exports` entry for it.

```ts tangen.extension.ts
migrations: './src/migrations.ts',
```

```ts src/migrations.ts
import type { ExtensionMigration } from '@tangen/cms'

export default [
  {
    id: '0001_create_reviews',
    sql: `
      CREATE TABLE IF NOT EXISTS acme_reviews (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL,
        object_id     TEXT NOT NULL,
        rating        INTEGER NOT NULL,
        body          TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS acme_reviews_scope
        ON acme_reviews (workspace_id, object_id);
    `,
  },
] satisfies ExtensionMigration[]
```

## No runtime DDL. Ever.

Not in a route, not in a hook, not in `onInstall`, not "just this once behind a
flag". `onInstall` does not even receive a database handle, which is the
contract making itself hard to break.

The reason is not tidiness: a table created at runtime has no ledger entry, no
checksum, and no plan anyone read. It is invisible to `tangen doctor`, to drift
detection and to the guarded-drop machinery that makes a mistake recoverable.

If you find yourself wanting runtime DDL, you want a **migration** (for
schema you evolve) or **`customTables`** in the manifest (for schema the
platform plans).

## When they run

| stage | runs |
|---|---|
| **INSTALL** | every migration, in declared order |
| **UPGRADE** | the ones whose ids the ledger has not seen |
| import, REGISTER, ENABLE, START | **never** |

Each runs in its own transaction, and is recorded with a **checksum of its
SQL**. An extension whose migrations are pending is **not active**, and
the reason says so.

## The rules

**Never edit one that has run.** The ledger holds its checksum; changing the SQL
is a corruption, not an update. To change what it created, write a new one.

**Never reorder or renumber.** Order is position, and ids are identity.

**Write them idempotently.** `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT
EXISTS`, `CREATE INDEX IF NOT EXISTS`. A migration may meet a partly-applied
database.

**Prefix your tables.** `acme_reviews`, not `reviews`. You share a database with
the platform, the site's content types and every other extension.

**Scope every row by `workspace_id`.** Several workspaces share one database,
and a query missing `workspace_id` reads one site's rows into another.

## Evolving

```ts
export default [
  { id: '0001_create_reviews', sql: `CREATE TABLE IF NOT EXISTS acme_reviews (…);` },
  { id: '0002_add_status',     sql: `ALTER TABLE acme_reviews ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';` },
]
```

Add with a default so existing rows stay valid. Bump your manifest `version`;
that is what makes UPGRADE apply it.

## Failure

A failing migration rolls back its own transaction and the extension does not
become active. Fix the SQL, bump the version, upgrade again.

Because ids are the identity, a migration that **never succeeded anywhere** may
be corrected in place. "Anywhere" includes a colleague's development database.

## Uninstall keeps your data

UNINSTALL does not drop your tables. Rows, ledger and content types are
retained, and a reinstall adopts them.

**PURGE** is the separate, approved deletion:

```bash
bun run tangen purge extension acme.reviews \
  --approve purge-extension:acme.reviews
```

It refuses in production. An owned table is kept aside as a guarded table once
no installation remains anywhere, and only `tangen purge guarded` drops it.

Design for adoption: on install, expect your tables to already exist and to have
rows.

## Migrations or `customTables`

| | use |
|---|---|
| a table shape you will evolve with SQL | `migrations` |
| a table the platform should plan, create and drift-check | `customTables` |
| content editors manage in the Admin | `contentTypes` |

Reach for `customTables` first. A declared table is planned, reported and
checked; a migration is yours to get right.

## Testing

```ts
import migrations from '../src/migrations'

it('has unique, ordered, non-empty ids', () => {
  const ids = migrations.map((m) => m.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect([...ids].sort()).toEqual(ids)
})

it('is idempotent and scopes rows', () => {
  for (const m of migrations) {
    if (/CREATE TABLE/i.test(m.sql)) {
      expect(m.sql).toMatch(/IF NOT EXISTS/i)
      expect(m.sql).toMatch(/workspace_id/)
    }
  }
})
```

Then apply them against a real PostgreSQL - twice, to prove the second run is a
no-op.

## Related

- [Extension data](/extend/data/extension-data) - storage without a table ·
  [The lifecycle in practice](/extend/contract/lifecycle) ·
  [Extension manifest reference](/reference/extension-manifest)
