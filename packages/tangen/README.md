# @tangen/cms

**Tangen** — a code-first headless CMS. This is the single-import package for
site developers: everything you need to define workspaces, content types, and
custom API routes.

## Install

```sh
bun add @tangen/cms
```

## Usage

One import for the whole developer surface:

```ts
import {
  defineWorkspace,
  defineSiteConfig,
  defineObjectType,
  field,
  v,
  parseBody,
  ok,
} from '@tangen/cms'

// Content type
export const post = defineObjectType({
  name: 'post',
  label: 'Post',
  fields: {
    title: field.text({ validation: { required: true } }),
    body: field.richtext(),
  },
})

// Custom route
export default {
  method: 'POST',
  path: '/api/subscribers',
  auth: 'key',
  handler: async (ctx) => {
    const body = parseBody(ctx, v.object({ email: v.pipe(v.string(), v.email()) }))
    return ok({ subscribed: body.email })
  },
}
```

`@tangen/cms` is a facade over `@tangen/types`, `@tangen/schema`, and
`@tangen/helpers` — the granular packages remain available if you prefer them.
Frontend content querying lives separately in `@tangen/sdk`.

## License

MIT
