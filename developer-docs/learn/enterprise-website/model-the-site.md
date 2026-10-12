---
title: Model the site
description: Eight content types that follow the information architecture, and why each one exists.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch2
---

# 2. Model the site

**Goal** eight content types in the database, generated types on disk.

**Prerequisites** [chapter 1](/learn/enterprise-website/create-the-project).

## What we are building

Northwind's information architecture:

```text
/
├── Products        Gridlock, Ledgerline
├── Solutions       Enterprise, Developers
├── Resources       Articles, Case studies, Downloads
├── Company         About, Careers, Contact
└── Legal
```

Three of those are marketing pages that an editor composes from blocks. The
rest are things with fields of their own, and that is the line the model draws:
**a page is a stack of blocks; everything that is not a page is a type.**

| type | exists because |
|---|---|
| `page` | marketing pages, composed not coded |
| `product` | a product has a tagline, a logo and a sort order a page does not |
| `solution` | the same products sold to a different audience, so it relates to products |
| `person` | an author is a record, so a name changes in one place |
| `category` | article taxonomy |
| `article` | prose with an author and categories |
| `caseStudy` | a client story with named metrics |
| `download` | a gated file |

## Steps

Write `app/content-objects/index.ts`. Two things to know before you do.

**Some fields already exist.** `title`, `slug`, `status`, `publishedAt`,
`createdAt`, `updatedAt`, `createdBy`, `updatedBy` and `id` are built in.
Declaring one is refused, with a message naming it. That is why no type below
has a title, and why `article` has no `publishedAt` even though it sorts by one.

**Top-level fields are a keyed map.** The key is the field name. Containers
(repeater, component) take the array form instead, which chapter 3 uses.

```ts app/content-objects/index.ts
import { defineSchema, defineObjectType, field } from '@tangen/cms'
import { PAGE_BLOCKS } from '../components'

/**
 * `path` is the routable URL and is authored, not derived: the IA nests
 * (/solutions/enterprise) and a slug alone cannot express that. Home is '/'.
 */
export const Page = defineObjectType({
  name: 'page',
  label: 'Page',
  plural: 'Pages',
  fields: {
    path: field.text({
      label: 'URL path',
      validation: { required: true, unique: true },
      admin: { helpText: 'Leading slash. The home page is "/".' },
    }),
    summary: field.textarea({ label: 'Summary', localized: true, admin: { helpText: 'Used as the meta description fallback.' } }),
    body: field.component({ label: 'Body', config: { components: PAGE_BLOCKS } }),
  },
})

export const Product = defineObjectType({
  name: 'product',
  label: 'Product',
  plural: 'Products',
  fields: {
    tagline: field.text({ label: 'Tagline', validation: { required: true }, localized: true }),
    summary: field.textarea({ label: 'Summary', validation: { required: true }, localized: true }),
    logo: field.media({ label: 'Logo', config: { accept: ['image'] } }),
    order: field.number({ label: 'Sort order', config: { default: 0 } }),
    body: field.component({ label: 'Body', config: { components: PAGE_BLOCKS } }),
  },
})
```

The remaining six follow the same shape. Take them from
`examples/enterprise-website/app/content-objects/index.ts`, which is the
complete file this tutorial is built from.

Note `localized: true` on `tagline` and `summary` and **not** on `order` or
`logo`. Localization is per field, and chapter 9 uses exactly these.

## Apply it

```bash
bun x tangen push
```

## Expected result

```text
✓  content tables → generated/content-tables.ts
✓  custom tables → generated/custom-tables.ts
✓  types → generated/tangen-types.d.ts (8 content types)
✓  Schema applied to "development"
```

Run it twice. The second run says `No schema changes`, because push compares
rather than replays.

## Verification

- push reports **8 content types**
- `app/generated/tangen-types.d.ts` exists and names your types
- the admin shows all eight in its sidebar

## Why this matters

`tangen push` writes three things: the database, the generated table map, and
your TypeScript types. They cannot disagree, which is what makes a typo in a
field name a compile error later rather than an empty page.

## Common mistake

**Declaring `title` or `slug`.** They exist already. The refusal names the
field, so read it rather than renaming around it.

## Relevant canonical docs

- [Content modeling](/build/content-modeling) - the full modelling guide
- [Fields reference](/reference/fields) - every field type and its config
- [Type safety](/build/getting-started) - what the generated types give you
- [CLI: push](/reference/cli)
