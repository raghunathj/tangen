---
title: Fields
description: All 28 built-in field types, their configuration, storage, localization and query behaviour.
audience: site-developer
type: reference
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-01
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Fields

A content type declares its fields as an **object map**: the key is the field
name, the value is a `field.*` builder.

```ts app/content-objects/article/schema.ts
import { defineObjectType, field } from '@tangen/cms'

export default defineObjectType({
  name: 'article',
  label: 'Article',
  fields: {
    subtitle: field.text({ label: 'Subtitle', validation: { required: true }, localized: true }),
    body: field.richtext({ label: 'Body', localized: true }),
    heroImage: field.media({ label: 'Hero image', config: { mimeTypes: ['image/jpeg', 'image/webp'] } }),
    publishedAt: field.date({ label: 'Publish date' }),
  },
})
```

`title`, `slug`, `status`, `createdAt`, `updatedAt` and `publishedAt` are
system fields - you do not declare them.

## Every builder takes one object

```ts
field.text({ label: 'Subtitle', validation: { required: true } })
```

The field's **name is the key**, never an argument.

A field may also be written as a **plain object**, which is what the Admin's
schema builder emits and the only form available for an extension-contributed
custom type, since `field.*` covers the built-ins only:

```ts
fields: {
  bio: { label: 'Short bio', fieldType: 'text', config: {}, required: false },
},
```

Options common to every builder:

| option | type | means |
|---|---|---|
| `label` | `string` | **required.** What the editor shows |
| `localized` | `boolean` | this field's value may differ per locale |
| `index` | `boolean` | give this field's column a database index. See below |
| `disabled` | `boolean` | soft-disable: keep the column and the data, hide the field from the Admin, REST, TangenQL and GraphQL. Reversible; `push` keeps the column |
| `previousName` | `string[]` | former names, so a rename moves data instead of dropping it |
| `validation` | rules | per-type validation |
| `admin` | object | editor presentation: `helpText`, `width`, and so on |
| `config` | object | the type's own options (`default`, `options`, `accept`, `targetType`, `min`, `max`, `fields`, `components`, `ai`, …). They live here and only here; writing one at the top level is a compile error, and `tangen check` names the place |
| `hooks`, `validate` | functions | per-field lifecycle and custom validation |

## The 28 types

### Text

| type | stores | notable options |
|---|---|---|
| `text` | a single line | `minLength`, `maxLength`, `pattern` |
| `textarea` | multiple lines | `maxLength` |
| `richtext` | structured rich text | - |
| `slug` | a URL-safe identifier, **unique per type** | `source` names the sibling field the Generate button derives from |
| `email` | an address, format-validated | - |
| `url` | a URL | - |
| `phone` | a phone number | - |
| `code` | source code | `language` |

### Numeric

| type | stores |
|---|---|
| `number` | an integer or decimal |
| `range` | **two** numbers, `min` ≤ `max`, in one `numrange` column |
| `currency` | an amount with a currency |
| `rating` | a bounded score |

### Choice

| type | stores |
|---|---|
| `boolean` | true or false |
| `select` | one of a fixed option list |
| `multiselect` | several of a fixed option list, as an array |
| `tags` | free-form strings |

### Time

| type | stores |
|---|---|
| `date` | a date, or a date and time |
| `time` | a time of day |

### Structure

| type | stores |
|---|---|
| `group` | named sub-fields, **flattened into columns** on the same row |
| `component` | one or more instances of a reusable component definition |
| `repeater` | an ordered list of rows, each with the same sub-fields |
| `object` | a reference to another content object, selectable across types |
| `json` | arbitrary JSON |

### References

| type | stores |
|---|---|
| `relation` | a reference to one or many objects of a target type |
| `link` | a destination: content identity, or an external URL. See [Link](/reference/link) |
| `media` | one media asset |

### Other

| type | stores |
|---|---|
| `color` | a colour value |
| `geopoint` | a latitude and longitude |

## Content AI

A field can say whether Content AI may write it, and what good output looks
like. It goes under `config.ai`, not at the top level:

```ts
excerpt: field.textarea({
  label: 'Excerpt',
  config: { ai: { hint: 'One sentence, under 160 characters, no headline repetition.' } },
}),
sku: field.text({ label: 'SKU', config: { ai: { enabled: false } } }),
```

| key | default | does |
|---|---|---|
| `enabled` | `true` | whether AI may fill or suggest this field |
| `hint` | - | what the field holds and how to write it |

Turn `enabled` off for identifiers, codes and anything another system owns: a
generated SKU is worse than an empty one.

## Localization

`localized: true` puts the field's values in a per-locale side table. It is
per-field and opt-in: a type can have localized and non-localized fields side by
side.

**Media localizes at the asset level** - per-locale variants - so a media field
needs no flag.

## `index`

A field you filter or sort on repeatedly should carry `index: true`:

```ts
section: field.text({ label: 'Section', index: true }),
topics: field.tags({ label: 'Topics', index: true }),
```

`tangen push` creates `<type>_<field>_idx` for it - a B-tree, or a GIN index for
an array-backed type such as `tags` or `multiselect` so containment queries use
it. `push --plan` names the index before it creates it, and `tangen doctor`
reports a declared index the database does not have.

Not every type can carry one: `richtext`, `group` and the other container types
have no single column to index, and `index: true` on one is ignored rather than
refused. `slug` already has a unique index of its own, per workspace.

Setting `index: false` later drops the index; the column and its data stay.

## Query behaviour

Not every type participates in every operation.

| | |
|---|---|
| **filterable** | most scalar types. `link` is **not** filterable in v1 |
| **unique** | `slug` is unique per type. `link` cannot be unique |
| **listable** | most types appear as list columns; `link` does not |
| **expanded by depth** | `relation` only. `media` resolves at every depth including `0`; `object` fields are values on the row; `link` consumes no depth |
| **backlinks** | `_referencedBy` works through **many relations** only, and refuses `link` |

See [TangenQL](/reference/tangenql).

## Custom field types

An extension can contribute a field type by **inheriting a built-in
primitive** - it gets that primitive's storage and baseline validation, and adds
its own validation and editor. See the Extend section.

## Related

- [Link](/reference/link) · [TangenQL](/reference/tangenql) ·
  [Configuration](/reference/configuration) · [CLI](/reference/cli)
