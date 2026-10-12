# Northwind Systems - the Enterprise Website

A fictional B2B technology company, built against Tangen's **public** surfaces
only. It is the executable half of the
[Build the Enterprise Website](../../developer-docs/learn/enterprise-website/index.md)
tutorial: every snippet in those fourteen chapters comes from this project, and
`bun run docs:check` fails if the two drift apart.

It was developed from **outside** this repository, installed from a registry,
with no workspace resolution and no path into `packages/`. Everything it uses is
`@tangen/cms`, `@tangen/sdk` and `@tangen/cli`.

## What it exercises

| | |
|---|---|
| Content model | 8 types - page, product, solution, person, category, article, caseStudy, download |
| Blocks | 6 reusable components a marketer stacks into a page |
| Globals | site settings, navigation, footer, SEO defaults |
| Media | 5 committed assets, uploaded, referenced, transformed and rendered |
| TangenQL | filter, props, relation depth, sort, pagination, not-found |
| Localization | en / fr / de, per-field fallback, locale routing |
| Forms | Contact Us and Request a Demo, rendered from the public schema |
| Flows | a demo request branching on the submitted company size |
| Deployments | development, staging and production, one database each, same schema |
| Cache | read, publish, invalidate, read again |
| SEO | sitemap with hreflang alternates, canonical tags, robots by deployment role |

## Running it

```sh
createdb northwind_dev
bun install
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
bun x tangen bootstrap
bun x tangen push
bun x tangen enable localization
bun x tangen enable forms
bun x tangen extension install seo
bun x tangen extension install flows
bun run dev                   # API on :3000, admin on :3001
```

Create an admin account at `http://localhost:3001`, then seed and start the site:

```sh
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"workspaceId":"wsp_northwind_systems","email":"…","password":"…"}' | jq -r .accessToken)

API=http://localhost:3000/api/v1 TOKEN=$TOKEN bun scripts/seed.ts
API=http://localhost:3000/api/v1 TOKEN=$TOKEN bun scripts/translate.ts
API=http://localhost:3000/api/v1 TOKEN=$TOKEN bun scripts/forms.ts
API=http://localhost:3000/api/v1 TOKEN=$TOKEN bun scripts/flow.ts

TANGEN_API_URL=http://localhost:3000 TANGEN_API_KEY=<delivery key> bun web/server.ts
```

The site is on `:4321`. It reads `WEB_PORT`, not `PORT`, because Bun auto-loads
this project's `.env` where `PORT` belongs to the API.

## Checks

```sh
bunx tsc --noEmit -p tsconfig.json    # app/, web/ and scripts/ are all covered
```

`assets/` holds five small generated files (four PNGs and a one-page PDF)
committed with the project, so the seed never depends on a URL that can
disappear.

## What it is not

It is not a design showcase. The stylesheet is 30 lines and deliberately boring:
every judgement in this example is about the content model and the queries,
because those are what a real project has to get right.
