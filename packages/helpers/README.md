# @tangen/helpers

Request, response, and validation helpers for Tangen custom routes.

## Install

```sh
bun add @tangen/helpers
```

## Usage

```ts
import { v, parseBody, ok, created, paginate, bearerToken } from '@tangen/helpers'

export default {
  method: 'POST',
  path: '/api/subscribers',
  auth: 'key',
  handler: async (ctx) => {
    // Validated body — throws a 422 RouteError with fieldErrors on failure
    const body = parseBody(ctx, v.object({
      email: v.pipe(v.string(), v.email()),
      name: v.optional(v.string()),
    }))

    const row = await ctx.db.insert(/* ... */)
    return created(row) // 201 with { data: row }
  },
}
```

Exports:

- `v` — re-exported [valibot](https://valibot.dev) for schema definitions
- `parseBody(ctx, schema)` / `parseQuery(ctx, schema)` — validated input or 422
- `ok`, `created`, `paginated`, `noContent` — consistent response envelopes
- `paginate`, `requireParam`, `requireQuery`, `bearerToken` — request utilities

## License

MIT
