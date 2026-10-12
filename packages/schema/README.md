# @tangen/schema

Schema definition helpers for Tangen content models — content types, fields,
and custom tables, all as code.

## Install

```sh
bun add @tangen/schema
```

## Usage

```ts
import { defineObjectType, defineSchema, field } from '@tangen/schema'

export const post = defineObjectType({
  name: 'post',
  label: 'Post',
  fields: {
    title: field.text({ validation: { required: true } }),
    slug: field.slug({ label: 'Slug', config: { source: 'title' } }),
    body: field.richtext(),
    publishedAt: field.datetime(),
  },
})

export default defineSchema({ types: [post] })
```

Push schema changes with the CLI: `tangen push`.

Custom SQL tables are also supported via `defineTable` and the `col` column
builders.

## License

MIT
