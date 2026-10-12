---
title: Content types
description: Defining a content type, what the system gives you, and what to put in it.
audience: site-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-f/northwind#content-model
---

# Content types

A content type is one file.

```bash
bun run tangen add object article
```

```ts app/content-objects/article/schema.ts
import { defineObjectType, field } from '@tangen/cms'

export default defineObjectType({
  name: 'article',
  label: 'Article',
  fields: {
    subtitle: field.text({ label: 'Subtitle', validation: { required: true } }),
    body: field.richtext({ label: 'Body' }),
    heroImage: field.media({ label: 'Hero image' }),
    publishedOn: field.date({ label: 'Publish date' }),
  },
})
```

Then:

```bash
bun run tangen push
```

## Fields are a map, not a list

The field's **name is the key**. Every builder takes exactly one object:

```ts
fields: {
  subtitle: field.text({ label: 'Subtitle' }),   // correct
}
```

`field.text('subtitle', { … })` is not the API.

## What you get without asking

Every type has `id`, `title`, `slug`, `status`, `publishedAt`, `scheduledAt`,
`createdAt`, `updatedAt`, `createdBy` and `updatedBy`. Do not declare them, and
do not model your own `published` boolean - `status` is the one Tangen and the
Admin both use.

## Naming

`name` is the identifier: lowercase, singular, and stable. It becomes the table
name, the SDK's `objects('article')` key and part of every URL. `label` is what
editors see and can change freely.

Renaming a type is a schema change. Declare `previousName` so the data moves
rather than being dropped.

## How big should a type be

One type per thing a person would call a thing. An article is a type; its
author is a different type reached by a [relation](/build/content-modeling/relations);
its SEO metadata is a [group](/build/content-modeling/structuring-content) on the
article.

Signs you have gone wrong:

- **Fields that are only ever set together and only for some rows.** That is a
  component or a second type.
- **A `type` or `kind` select that changes which other fields matter.** Usually
  two types.
- **Thirty fields.** Group them, or split them.

## Verify

```bash
bun run tangen check
bun run tangen push
```

Then open the Admin: the type appears under Content with its fields in the
order you declared them.

## Common mistakes

- **Using the wrong builder signature.** One object, name as the key.
- **Declaring `title` or `status`.** They already exist.
- **Deleting a field to rename it.** Use `previousName`.
- **Expecting a schema change to appear without a push.**

## Related

- [Fields reference](/reference/fields) · [Choosing a field](/build/content-modeling/choosing-fields)
  · [The schema workflow](/build/getting-started/schema-workflow)
