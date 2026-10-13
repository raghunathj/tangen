# @tangen/cms

A code-first headless CMS. Define content types as TypeScript, push them to
Postgres, and read them back through a typed SDK. The schema lives in your
repository, not in a dashboard, so it reviews like code and deploys like code.

[![npm](https://img.shields.io/npm/v/@tangen/cms.svg)](https://www.npmjs.com/package/@tangen/cms)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/raghunathj/tangen/blob/main/LICENSE)

This package is the **single import for site developers**: a facade over
`@tangen/types`, `@tangen/schema` and `@tangen/helpers`. It is what you write
schemas and routes against. The server is `@tangen/api`, the editor is
`@tangen/admin`, and reading content from a frontend is `@tangen/sdk`.

Pre-1.0: the published line is `0.2.x` and the public surface is still moving.

## Start a project

You need **Bun** and a reachable **PostgreSQL** database. Content lives in
Postgres; there is no file-backed mode.

```sh
createdb my_blog

bunx @tangen/cli create my-blog \
  --name "My Blog" \
  --db "postgres://localhost:5432/my_blog"

cd my-blog
bun install
bun run tangen bootstrap
```

`--db` is checked before any file is written, so a wrong connection string
fails immediately rather than three steps later.

## Define a content type

```ts
// app/content-objects/article/schema.ts
import { defineObjectType, field } from '@tangen/cms'

export default defineObjectType({
  name: 'article',
  label: 'Article',
  fields: {
    summary: field.textarea({ label: 'Summary' }),
    body: field.richtext({ label: 'Body' }),
  },
})
```

Every content type already has `title`, `slug`, `status` and timestamps, so
you do not declare them. Then check it and apply it:

```sh
bun run tangen check
bun run tangen push
```

`push` prints its plan before it applies anything, needs explicit approval to
drop a field, and refuses destructive changes in production. It also writes a
declaration file, which is why queries are typed without a generic.

Start the API on `:3000` and the Admin on `:3001`:

```sh
bun run dev
```

## Custom routes

```ts
import { v, parseBody, ok } from '@tangen/cms'

export default {
  method: 'POST',
  path: '/api/subscribers',
  auth: 'key',
  handler: async (ctx) => {
    const body = parseBody(ctx, v.object({ email: v.pipe(v.string(), v.email()) }))
    return ok({ subscribed: body.email })
  },
}
```

## Reading content

Querying is a separate package, so a frontend never pulls in the server's
dependencies:

```sh
bun add @tangen/sdk
```

```ts
import { createClient } from '@tangen/sdk'

const tangen = createClient({
  apiUrl: process.env.TANGEN_API_URL!,
  apiKey: process.env.TANGEN_API_KEY!,
})

const { data } = await tangen
  .objects('article')
  .props(['id', 'title', 'slug', 'summary'])
  .limit(10)
  .get()
```

`data` is `Article[]`, typed from the file `push` generated. REST, GraphQL and
MCP read the same content.

## The other packages

| package | what it is |
|---|---|
| `@tangen/cli` | `create`, `bootstrap`, `add`, `check`, `push`, `dev` |
| `@tangen/api` | the server: REST, GraphQL, media, jobs, webhooks, realtime |
| `@tangen/admin` | the Admin application |
| `@tangen/sdk` | the typed read and write client |
| `@tangen/nextjs`, `@tangen/astro` | framework adapters |

Forms, flows, SEO, auth and site users ship as extensions (`@tangen/ext-*`),
each declaring the capabilities it is granted.

The granular packages behind this facade (`@tangen/types`, `@tangen/schema`,
`@tangen/helpers`) remain available if you prefer them directly.

## Documentation

Source, guides and reference: [github.com/raghunathj/tangen](https://github.com/raghunathj/tangen)

## License

MIT
