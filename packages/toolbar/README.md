# @tangen/toolbar

Floating Tangen toolbar for site frontends built on the Tangen SDK: page
vitals (LCP, CLS, INP, TTFB), SDK request timings with the server's own
db/queue numbers, console capture, and an "Edit this page" jump into the
admin's live preview.

Optional: install only on sites that want the dev toolbar.

```tsx
// React (Next.js: keep it in a client component)
import { TangenToolbar } from '@tangen/toolbar/react'

<TangenToolbar adminUrl={process.env.NEXT_PUBLIC_TANGEN_ADMIN_URL} />
```

```ts
// Framework-agnostic
import { mountToolbar } from '@tangen/toolbar'
mountToolbar({ adminUrl: 'https://admin.example.com/wsp_x/production' })
```

Docs: docs/toolbar.md in the platform repo.
