---
title: Seed and publish content
description: Enough content to render the whole site, and the draft-to-published rule that explains an empty frontend.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch6
---

# 6. Seed and publish content

**Goal** the site's content in the database, published, and the publishing rule
understood before it confuses you.

**Prerequisites** [chapter 5](/learn/enterprise-website/media-and-relations),
and an admin account from chapter 1.

## The rule that explains everything later

**A read returns published content only.** A draft is invisible to the Delivery
API. When chapter 8's frontend returns nothing, this is almost always why.

So the seed script creates *and* publishes:

```ts scripts/seed.ts
async function create(type: string, values: Record<string, unknown>, title: string, slug: string) {
  const found = await call('POST', `/objects/${type}/query`, { query: { slug: { eq: slug } }, limit: 1 })
  // Update, do not skip. A seed that only creates looks idempotent and is not:
  // edit a value here, re-run, and the old record silently survives.
  const id: string = found?.data?.length
    ? ((await call('PATCH', `/objects/${type}/${found.data[0].id}`, { title, ...values })).data.id as string)
    : ((await call('POST', `/objects/${type}`, { title, slug, ...values })).data.id as string)
  // Publishing is what makes it visible to the Delivery API, and a republish
  // is also what makes an edited translation visible.
  await call('POST', `/objects/${type}/${id}/publish`, {})
  return id
}
```

## Getting a token

The seed writes as a member, so it needs an admin token:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"workspaceId":"wsp_northwind_systems","email":"you@example.com","password":"…"}' \
  | jq -r .accessToken)
```

Two things about that URL. The admin login is `/api/auth/login`, **not** under
`/api/v1` like everything else. And the response key is `accessToken`.
`/api/v1/ext/auth/login` is site-user authentication (the Site users
extension), a different system, and it fails with a message about a missing
API key that reads like a bug when you are looking for the admin login.

## Run it

```bash
API=http://localhost:3000/api/v1 TOKEN=$TOKEN bun scripts/seed.ts
```

Take `scripts/seed.ts` from `examples/enterprise-website`. It creates two
products, two solutions, two people, two categories, two articles, one case
study, one download, six pages and all four Globals.

## Expected result

```text
seeded
```

and, counted through the API:

```text
page 6 · product 2 · solution 2 · article 2 · caseStudy 1 · download 1 · person 2 · category 2
```

## Verification

- the admin lists content under every type
- a published page is readable with a delivery key (chapter 7 makes one)
- re-running the seed changes nothing and fails nothing

## Why this matters

The seed is the deterministic equivalent of an editor's afternoon. You would not
ship one, but you want the site's data reproducible while you are building it,
and you want it to survive being run twice.

## Common mistake

**Creating without publishing.** The object exists, the admin shows it, and the
site cannot see it. Nothing warns you, because a draft is a legitimate state.

## Relevant canonical docs

- [Publishing and visibility](/build/content/publishing) - the full contract
- [Content API](/reference/delivery-api) - create, update, publish, delete
- [Authentication](/reference/authentication) - which login is which
