# @tangen/db

Database client and system schema for the Tangen headless CMS — a typed
Drizzle ORM client over postgres.js plus the platform's system table
definitions (workspaces, environments, object types, fields, members, …).

## Install

```sh
bun add @tangen/db
```

## Usage

```ts
import { createDb, objectTypes, environments } from '@tangen/db'

const db = createDb(process.env.DATABASE_URL!, {
  max: 10,            // pool size (optional)
  prepare: false,     // opt out of prepared execution (optional; default true)
})

const types = await db.select().from(objectTypes)
await db.end()
```

Pool options may also come from environment variables:
`TANGEN_DB_POOL_MAX`, `TANGEN_DB_IDLE_TIMEOUT`, `TANGEN_DB_CONNECT_TIMEOUT`,
`TANGEN_DB_PREPARE`.

### `TANGEN_DB_PREPARE`

**Defaults to `true`.** Tangen owns this contract rather than inheriting the
driver's, so an unset variable has one documented meaning. Precedence is
`createDb`'s `prepare` option, then `TANGEN_DB_PREPARE`, then the default; only
the exact strings `true` and `false` are recognised, and `tangen doctor` prints
the effective value with its source so a typo is visible.

Prepared execution reuses a named statement per SQL shape per connection, which
removes one PostgreSQL protocol round trip from every repeated parameterized
query. On a remote database that is roughly half of each statement.

`resolvePrepare(opts, env)` returns `{ prepare, source }` for anything that
needs to report the decision.

postgres.js does not honour a pool-level `prepare` for the queries Drizzle
issues, so `prepare-policy.ts` threads the option through by hand. Read that
file before changing anything here; it also carries the removal condition for
when Drizzle fixes this upstream.

Set `TANGEN_DB_PREPARE=false` for a pooler or proxy that cannot carry named
statements - PgBouncer in transaction mode with `max_prepared_statements = 0`,
or anything whose support you have not verified. Direct PostgreSQL, session
pooling, and PgBouncer 1.21+ transaction pooling with prepared statements
enabled all want the default. `false` is permanent: nothing overrides it.

One thing to know if you write SQL against this client: a named statement is
cached per distinct SQL string, per connection, until that connection closes.
Code that inlines a value into the SQL text instead of binding it as a
parameter mints a new prepared statement on every call. Tangen's own write
paths bind their values; extension or application code that concatenates would
accumulate.

## What's included

- `createDb(url, poolOptions?)` — Drizzle client with an `end()` helper
- All Tangen system table definitions (drizzle `pgTable` objects)

Project-specific generated content tables are **not** part of this package —
they are generated into your project by `tangen push`.

## License

MIT
