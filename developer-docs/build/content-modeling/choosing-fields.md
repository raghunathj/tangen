---
title: Choosing a field
description: Which of the 28 field types fits, and the ones people reach for wrongly.
audience: site-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-01
verification: source
verifiedBy: packages/schema/src/fields.ts
---

# Choosing a field

The full list, with options and validation, is
[Reference → Fields](/reference/fields). This page is about picking.

## By what you are storing

| you want | use |
|---|---|
| a headline, a name, a short label | `text` |
| a paragraph of plain text | `textarea` |
| formatted body copy | `richtext` |
| a URL segment | `slug` |
| an email, a URL, a phone number | `email`, `url`, `phone` - they validate |
| a number | `number`; `currency` for money, `rating` for a score, `range` for a pair |
| yes or no | `boolean` |
| one of a fixed set | `select` |
| several of a fixed set | `multiselect` |
| open-ended keywords | `tags` |
| a date, or a date and time | `date` |
| an image, a PDF, a video | `media` |
| a link to another object | `relation` |
| a destination that might be internal **or** external | `link` |
| repeating rows of the same shape | `repeater` |
| a reusable block used across types | `component` |
| related fields shown together | `group` |

## The ones people get wrong

**`text` where `slug` belongs.** `slug` is unique per type, URL-safe, and can
derive itself: `field.slug({ label: 'Slug', config: { source: 'title' } })` - `source` names
the sibling field the editor's Generate button derives from.

**`text` holding a URL to another page.** If the destination is your own
content, that is a [`link`](/build/content-modeling/links) or a `relation`. A
stored URL breaks the moment a slug changes.

**`json` as an escape hatch.** It stores anything and validates nothing, cannot
be filtered meaningfully, and gives editors a textarea full of braces. Reach for
`repeater`, `component` or `group` first. `json` is right for data another
system owns.

**`multiselect` where a `relation` belongs.** If the options are content someone
edits - categories, authors, products - they are a type, not a list of strings.

**`boolean` for status.** Every type already has `status`.

## Required, and validation

```ts
subtitle: field.text({ label: 'Subtitle', validation: { required: true } }),
excerpt:  field.textarea({ label: 'Excerpt', validation: { maxLength: 200 } }),
```

`required: true` is shorthand for `validation: { required: true }`. Required
means required **to publish**: a draft may be incomplete, and publishing an
incomplete object is refused with a `422` naming the field.

Validate what actually matters. A `maxLength` that exists because a designer
guessed becomes an editor's problem at 5pm.

## Localizing

`localized: true` per field. Decide it when you model - see
[Modeling for localization](/build/content-modeling/localization).

## Related

- [Fields reference](/reference/fields) · [Relations](/build/content-modeling/relations)
  · [Links and navigation](/build/content-modeling/links) ·
  [Errors](/reference/errors)
