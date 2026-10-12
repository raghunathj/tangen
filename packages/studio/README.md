# @tangen/studio

The framework-agnostic client core for [Tangen Studio](../../docs/studio.md):
the visual-edit overlay, and the message protocol the admin and your site
speak to each other.

It depends on no framework at all. The overlay is DOM plus `postMessage`, so
a Vue, Svelte or Astro site can support click-in-preview without pulling in a
React renderer.

**Using React?** Install `@tangen/studio-react` instead - it re-exports
everything here alongside `<StudioBlocks/>`, so you need one package.

```ts
import { enableStudioOverlay, tangenBlockAttrs } from '@tangen/studio'

// 1. Stamp each block's root element
<section {...tangenBlockAttrs(block._key)}>…</section>

// 2. Activate the overlay once, in a preview-capable layout
useEffect(() => enableStudioOverlay({ adminOrigin: 'https://admin.example.com' }), [])
```

`enableStudioOverlay` is a no-op outside a real Tangen preview (it needs the
framing iframe *and* the `preview_token` param), so it is safe to call
unconditionally - zero cost in production. It returns a disposer.

## The protocol

| Message | Direction | Meaning |
|---|---|---|
| `studio:ready` | site → admin | The overlay is active, and what it supports |
| `studio:select` | site → admin | A block was clicked |
| `studio:highlight` | admin → site | Flash and scroll to a block |
| `studio:overlay` | admin → site | Suspend or resume selection (preview mode) |

Suspending is what makes Studio's preview honest: while suspended the
overlay stops intercepting clicks, so links behave and the page reads as a
visitor sees it.
