---
title: Build reusable page blocks
description: Six components an editor stacks into a page, and the difference between a component and a block.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch3
---

# 3. Build reusable page blocks

**Goal** six reusable sections a marketer can stack into any page without a
developer.

**Prerequisites** [chapter 2](/learn/enterprise-website/model-the-site).

## What we are building

Northwind's marketing pages are all the same three or four shapes in different
orders. If each were a frontend template, every new landing page would be a
deploy. So the shapes become content.

| block | what it is |
|---|---|
| `hero` | headline, supporting line, image, up to two calls to action |
| `richText` | a prose section |
| `featureGrid` | a heading and a repeater of features |
| `statsBand` | a row of numbers |
| `ctaBanner` | a heading and one call to action |
| `faq` | question and answer pairs |

## Component and block are not synonyms

A **component** is the reusable definition you write with `defineComponent`. A
**block** is one instance of a component sitting in a content field. You define
components; an editor arranges blocks. The distinction matters the moment you
render, because a block carries a `_type` naming the component that produced it.

## Steps

Sub-fields of a component use the **array form**, not the keyed `field.*` map
that top-level type fields use. This is the single most common shape error.

```ts app/components/index.ts
import { defineComponent } from '@tangen/cms'

export const Hero = defineComponent({
  name: 'hero',
  label: 'Hero',
  description: 'Headline, supporting line, one or two calls to action.',
  fields: [
    { name: 'heading', label: 'Heading', fieldType: 'text', required: true },
    { name: 'subheading', label: 'Subheading', fieldType: 'textarea' },
    { name: 'image', label: 'Image', fieldType: 'media', config: { accept: ['image'] } },
    { name: 'primaryCta', label: 'Primary call to action', fieldType: 'link' },
    { name: 'secondaryCta', label: 'Secondary call to action', fieldType: 'link' },
  ],
})

export const FeatureGrid = defineComponent({
  name: 'featureGrid',
  label: 'Feature grid',
  fields: [
    { name: 'heading', label: 'Heading', fieldType: 'text' },
    {
      name: 'features', label: 'Features', fieldType: 'repeater',
      config: { fields: [
        { name: 'title', label: 'Title', fieldType: 'text', required: true },
        { name: 'body', label: 'Body', fieldType: 'textarea' },
      ] },
    },
  ],
})
```

The other four are in `examples/enterprise-website/app/components/index.ts`.

Then export the list the page field references. Chapter 2's `page` and `product`
both used `PAGE_BLOCKS`:

```ts app/components/index.ts
export const PAGE_BLOCKS = ['hero', 'richText', 'featureGrid', 'statsBand', 'ctaBanner', 'faq']

export default [Hero, RichText, FeatureGrid, StatsBand, CtaBanner, Faq]
```

Apply it:

```bash
bun x tangen push
```

## Expected result

Push reports no new tables. Blocks are stored inside the object's own column,
not in tables of their own, so adding a component changes what an editor can
put in a page without changing the database shape.

In the admin, opening a Page now offers an **Add block** control listing all
six.

## Verification

- the admin's Page editor offers six block types
- `bun x tangen push` reports `No schema changes` on a
  second run

## Why this matters

The `_type` on each stored block is the contract between the editor and your
frontend. Chapter 8 renders these with a function that switches on it, and an
unknown `_type` renders nothing rather than crashing, so adding a component
never takes the site down before the frontend knows about it.

## Common mistake

**Using the keyed `field.*` map inside a component.** Component sub-fields are
`{ name, label, fieldType, config }` objects in an array. The keyed builder is
for a content type's top-level fields.

## Relevant canonical docs

- [Structuring content](/build/content-modeling/structuring-content) - the full contract
- [Fields reference](/reference/fields) - `fieldType` values for sub-fields
- [Repeaters](/build/content-modeling)
