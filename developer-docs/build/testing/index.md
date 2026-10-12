---
title: Testing your application
description: What to test around a Tangen site, and what not to.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g8/testing
---

# Testing your application

You are testing **your site**, not Tangen. The platform has its own suite; your
tests should fail when your code is wrong, not when Tangen changes an internal.

## What is worth testing

| test | because |
|---|---|
| your **queries** return what the page needs | a filter or a projection is easy to get subtly wrong |
| your **link resolution** builds the right href | it is your router, not Tangen's |
| your **routing** finds content by slug, and 404s when it should | the most common page bug |
| **locale** routing and fallbacks | quiet, intermittent failures otherwise |
| **form** submit and validation display | your markup against the server's answer |
| **preview** fails closed | a leak, if it does not |
| **auth-protected routes** actually redirect | verified on the server |

## What is not

- **That Tangen validates a required field.** It does; that is its test.
- **That `depth(1)` expands a relation.** Same.
- **Internal shapes** - the schema cache, the query compiler, the runtime
  registry. Those are not your contract and will change.

A test that breaks when Tangen changes something you never call is a test that
will be deleted in six months.

## Test data

Seed a **dedicated deployment** (its own database) and commit the seed. Deterministic data means
a failing assertion is a real failure rather than yesterday's content.

```bash
bun run tangen push
```

Then seed content the way your application writes it - through the SDK with a
key that has `objects: write`, from a script you can re-run. That keeps the
seed and your application on the same path, so a seed that works proves the
write path works.

Point tests at that deployment's key, and never at production.

## Querying tests

```ts
import { describe, it, expect } from 'bun:test'
import { tangen } from '../app/lib/tangen'

describe('article listing', () => {
  it('returns published articles, newest first', async () => {
    const { data } = await tangen.objects('article')
      .sort('publishedAt', 'desc')
      .limit(5)
      .get()

    expect(data.length).toBeGreaterThan(0)
    expect(data.every((a) => a.status === 'published')).toBe(true)
  })
})
```

Assert on **what your page needs**: the field is present, the order is right,
the draft is absent.

## Preview

The valuable preview test is the negative one:

```ts
it('renders not-found for a bad preview token, never the published page', async () => {
  const res = await fetchPage('/preview?id=obj_1&type=article&token=prev_bogus')
  expect(res.status).toBe(404)
})
```

Falling back to published is the failure mode that makes a leak look like a
success.

## Browser tests

Use a browser for the two things only a browser answers: **what the layout does
at a width**, and **where focus goes**. Everything else is cheaper as a unit
test.

Serve fixed content, so a layout assertion fails because the layout changed and
not because an editor did.

## Deployments

Run against the development deployment locally and staging in CI. Never
against production, and never with a key that can write there.

Test **that your app handles a deployment difference** - a capability off in
one place - rather than testing the deployments themselves.

## When you need a real database

Only if your application owns tables of its own through custom tables. Reading
Tangen content is an HTTP call, and a running Tangen against a seeded
database is the honest test double.

## Common mistakes

- **Testing against production.**
- **Asserting on generated internal shapes** instead of the fields you render.
- **A shared mutable database** where one test's write breaks another's read.
- **Mocking the SDK so thoroughly** that the test passes with a query that
  would 422.

## Related

- [Querying](/build/querying) · [Preview](/build/content/preview) ·
  [Deployments in practice](/build/deployments) · [Errors](/reference/errors)
