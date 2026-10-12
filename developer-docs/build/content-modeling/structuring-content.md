---
title: Structuring content
description: "Groups, repeaters and components: which one to use for nested and repeating content, and how a component differs from a block on a page."
audience: site-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g8/groups
---

# Structuring content

Three ways to nest, and they are not interchangeable.

| | use when |
|---|---|
| **`group`** | related fields belong together **on this type**, once |
| **`repeater`** | rows of the same shape, many of them, on this type |
| **`component`** | a block reused **across types**, chosen from a palette |

## Group

Fields shown together, stored as ordinary columns on the same row.

```ts
seo: field.group({
  label: 'SEO',
  fields: {
    metaTitle: field.text({ label: 'Meta title' }),
    metaDescription: field.textarea({ label: 'Meta description' }),
  },
}),
```

A group is presentation and grouping. Because its children are flat columns,
they filter and sort like any other field.

**The column takes the child's own name, not a prefixed one.** The group above
adds `metaTitle` and `metaDescription` to the table - not `seo_metaTitle`. So a
child may collide with a top-level field, or with a child of another group on
the same type, and the group name will not save you. Name group children as if
they sat at the top level, because in the database they do.

## Repeater

An ordered list of rows.

```ts
faqs: field.repeater({
  label: 'FAQs',
  // Rows are plain sub-field objects under config.fields; the field.* builders describe top-level fields.
  config: { fields: [
    { name: 'question', label: 'Question', fieldType: 'text', required: true },
    { name: 'answer', label: 'Answer', fieldType: 'textarea' },
  ] },
}),
```

Rows keep their order and are addressed by a stable key, so reordering does not
rewrite them.

Use a repeater when the rows only make sense **inside this object**. If a row
is a thing in its own right - something you would list, link to, or reuse - it
is a content type and a [relation](/build/content-modeling/relations).

## Component

A reusable block, defined once and offered on any type that accepts it. This is
how page builders work: a page has a `blocks` field, and an editor picks Hero,
Feature Grid or Quote.

```ts
blocks: field.component({ label: 'Blocks', config: { components: ['hero', 'featureGrid', 'quote'] } }),
```

Components are the right answer when the **shape varies per row** and an editor
chooses which shape. A repeater is one shape repeated; a component field is
several shapes in a sequence.

## Choosing

```text
Does the shape vary per row, chosen by an editor?   → component
Same shape, many rows, only meaningful here?        → repeater
A few fields that belong together, once?            → group
A thing you would list or link to on its own?       → its own type + relation
```

## Common mistakes

- **A repeater of one row** because a group felt too plain.
- **A component used on exactly one type** and never reused - a repeater is
  simpler.
- **Nesting three levels deep.** Editors stop being able to see the page.
- **`json` instead of any of these**, which loses validation and the editor.

## Related

- [Fields reference](/reference/fields) · [Relations](/build/content-modeling/relations)
  · [Querying relations](/build/querying/relations)
