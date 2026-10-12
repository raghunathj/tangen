# @tangen/studio-react

React rendering runtime for Tangen Studio's Builder Kit. Drop one component into any
React site - Next.js App Router works out of the box - and it server-renders the
`kit.*` block trees marketers compose in Studio, styled entirely through CSS custom
properties your stylesheet may override.

```tsx
import { StudioBlocks } from '@tangen/studio-react'
import '@tangen/studio-react/styles.css'

export default function Page({ page }) {
  return <StudioBlocks blocks={page.sections} />
}
```

## What renders

Every widget in the Builder Kit contract: `kit.section`, `kit.row`, `kit.loop`,
`kit.heading`, `kit.text`, `kit.image`, `kit.buttons`, `kit.spacer`, `kit.divider`,
`kit.video`, `kit.iconList`, `kit.accordion`, `kit.form`. Static widgets are pure server-safe
React (zero client JS); the interactive ones (accordion, video) are isolated
`'use client'` leaf islands so RSC boundaries stay clean.

Every block root is stamped with `data-tangen-block={_key}`, so the Studio
click-in-preview overlay works with no extra wiring.

## Props

```tsx
<StudioBlocks
  blocks={page.sections}            // the component field's value; nullish renders nothing
  components={{ 'hero': Hero }}     // override or extend renderers per _type
  formRenderer={(slug) => <MyForm slug={slug} />}  // renders kit.form; placeholder card when absent
  unknown="skip"                    // or 'placeholder' - a labeled outline (preview aid)
  loopData={data}                   // resolved kit.loop results - see Dynamic listings
/>
```

Site components in `components` receive only `{ block }` (serializable), so client
components cross the RSC boundary safely. Blocks with `_disabled: true` render
nothing.

## Dynamic listings (kit.loop)

`kit.loop` repeats its item template over records from your Tangen collections.
Resolution is **two-phase on purpose**: you await the queries in your own loader,
then render synchronously. That keeps this package free of credentials and free of
any RSC-only requirement - it works in a Next page, Astro frontmatter, a Remix
loader, or any React 18+ server renderer.

```tsx
import { StudioBlocks, resolveStudioData } from '@tangen/studio-react'

export default async function Page() {
  const page = await getPage()

  // One call resolves every loop on the page, concurrently.
  const loopData = await resolveStudioData(page.sections, async (spec) => {
    // `spec` is TangenQL: { source, query, sort?, limit? } - pass it straight through.
    const res = await tangen.objects(spec.source).query({
      query: spec.query, sort: spec.sort, limit: spec.limit, status: 'published',
    })
    return { data: res.data, meta: { total: res.meta.total } }
  })

  return <StudioBlocks blocks={page.sections} loopData={loopData} />
}
```

Inside an item template, a prop may carry a binding descriptor
(`{ $bind: 'item.title', fallback: 'Untitled' }`) instead of a fixed value; the
runtime substitutes it per record. Dotted paths read relations
(`item.author.name`) when you expand them with `depth`.

Failure is contained: a resolver that throws marks only **that** loop, which then
renders its `errorState` slot instead of taking the page down. An empty result
renders `emptyState`. A loop whose data was never resolved renders its container
and nothing else.

## Styling - design tokens, not CSS

`styles.css` ships defaults for every token variable the widgets reference:
`--tg-bg-<slot>` / `--tg-fg-<slot>` (palette: default, muted, brand, accent,
inverse), `--tg-space-<slot>`, `--tg-text-<slot>`, `--tg-radius-<slot>`,
`--tg-width-<slot>`. Re-brand by overriding the variables after the import:

```css
:root {
  --tg-bg-brand: #6d28d9;
  --tg-fg-brand: #ffffff;
  --tg-text-3xl: 3.5rem;
}
```

Workspaces that extend token slot lists (`studio.tokens` in the workspace config)
must define the variables for their extra slots the same way.

No Tailwind dependency, no external requests, no next/astro imports in the core
module graph.

See `docs/studio.md` in the platform repo for the full Builder Kit contract.
