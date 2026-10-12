# Tangen

A code-first headless CMS. You define content types as TypeScript, push them to
Postgres, and read them back through a typed SDK. The schema lives in your
repository, not in a dashboard, so it reviews like code and deploys like code.

[![npm](https://img.shields.io/npm/v/@tangen/cms.svg)](https://www.npmjs.com/package/@tangen/cms)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Pre-1.0. The published packages are on the `0.1.x` line and the public surface
is still moving.

## What you get

- **Content types in TypeScript.** `defineObjectType` plus a `field` builder.
  Every type already has `title`, `slug`, `status` and timestamps.
- **A migration plan you read before it runs.** `tangen push` prints what it
  will do, needs explicit approval to drop a field, and refuses destructive
  changes in production.
- **Generated types.** Push writes a declaration file, so `objects('articel')`
  is a compile error and query results are typed without a generic.
- **An Admin you do not build.** Content editing, publishing, API keys, RBAC,
  localisation and media, served alongside the API.
- **Extensions.** Forms, flows, SEO, auth, review workflows and a visual studio
  ship as separate packages, each declaring the capabilities it is granted.

## Requirements

| you need | why |
|---|---|
| **Bun** | Tangen runs on Bun |
| **PostgreSQL**, reachable, and an empty database | content lives in Postgres. There is no file-backed mode |

## Getting started

```bash
createdb my_blog

bunx @tangen/cli create my-blog \
  --name "My Blog" \
  --db "postgres://localhost:5432/my_blog"

cd my-blog
bun install
```

`--db` is checked before any file is written, so a wrong connection string
fails immediately rather than three steps later.

Create Tangen's own tables, once per deployment:

```bash
bun run tangen bootstrap
```

Define a content type:

```bash
bun run tangen add object article
```

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

Check it, then apply it:

```bash
bun run tangen check
bun run tangen push
```

Start the API on `:3000` and the Admin on `:3001`:

```bash
bun run dev
```

Open `http://localhost:3001`, create the owner account, then add an article and
publish it. A read returns published content only, so a draft stays invisible to
your site until somebody publishes it.

## Reading content

Create an API key in the Admin under **Settings → API keys** with
**objects: read**.

```bash
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

`data` is `Article[]`, typed from the file push generated. REST, GraphQL and MCP
read the same content.

## Packages

| package | what it is |
|---|---|
| [`@tangen/cms`](https://www.npmjs.com/package/@tangen/cms) | the single import for site developers: `defineWorkspace`, `defineObjectType`, `field`, route helpers |
| `@tangen/cli` | `create`, `bootstrap`, `add`, `check`, `push`, `dev` |
| `@tangen/sdk` | the typed read and write client |
| `@tangen/api` | the server: REST, GraphQL, media, jobs, webhooks, realtime |
| `@tangen/admin` | the Admin application |
| `@tangen/nextjs`, `@tangen/astro` | framework adapters |

Extensions live under `extensions/` and publish as `@tangen/ext-*`.

## Documentation

Guides, reference and tutorials are in [`developer-docs/`](developer-docs).

## License

MIT. See [LICENSE](LICENSE).
