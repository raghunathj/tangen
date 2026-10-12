# @tangen/nextjs

Next.js integration helpers for Tangen — draft-mode content preview.

## Install

```sh
bun add @tangen/nextjs
```

## Usage

Create the preview route handler (App Router):

```ts
// app/api/preview/route.ts
import { createPreviewHandler } from '@tangen/nextjs'

export const GET = createPreviewHandler({
  apiUrl: process.env.TANGEN_API_URL!,
})
```

And an exit route:

```ts
// app/api/preview/disable/route.ts
import { disablePreview } from '@tangen/nextjs'

export const GET = disablePreview()
```

The handler validates the preview token issued by the Tangen admin panel,
enables Next.js draft mode, and redirects to the previewed entry.

## License

MIT
