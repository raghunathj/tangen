---
title: Admin contributions
description: Every supported way an extension adds UI to the Admin - pages, panels, navigation and dashboard widgets.
audience: extension-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g7/admin-panel
---

# Admin contributions

Four supported ways to put UI in the Admin. Each is **declared in the manifest**
and implemented as a **named export of your browser entry**.

| contribution | manifest key | appears |
|---|---|---|
| **Page** | `pages` | a full page at `/:workspaceId/:env/extensions/<id>/<path>` |
| **Sidebar panel** | `sidebarPanels` | a card in the content editor, per content type |
| **Navigation entry** | `pages[].nav` | a sidebar item pointing at one of your pages |
| **Dashboard widget** | `dashboardWidgets` | a card on the workspace dashboard |

Custom field editors are a fifth surface with its own contract - see
[Custom field types](/extend/contributions/fields).

> **`adminRoutes` is not an Admin UI contribution.** Despite the name it
> declares **server** HTTP routes. See
> [Server routes](/extend/contributions/routes).

## Components are names

```ts tangen.extension.ts
pages: [{ path: '', component: 'ReviewsPage' }],
sidebarPanels: [{ id: 'reviews', label: 'Reviews', component: 'ReviewPanel', types: ['product'] }],
```

```ts src/index.ts
export { ReviewsPage } from './pages/ReviewsPage'
export { ReviewPanel } from './components/ReviewPanel'
```

The manifest holds the **name** of a named export; the Admin build resolves it
statically from your resolve path. The manifest never holds a function.

Your browser entry must be **browser-safe**: no `node:` imports, no database, no
secrets. It ships to every editor's browser.

## Pages

```ts
pages: [
  {
    path: '',                       // '' mounts at /extensions/acme.reviews
    component: 'ReviewsPage',
    nav: { label: 'Reviews', icon: 'IconStar', section: 'extensions', order: 100 },
    access: { capability: 'reviews:read' },
  },
  {
    path: 'records/:id',            // React Router params are allowed
    component: 'ReviewDetailPage',
  },
],
```

| field | means |
|---|---|
| `path` | relative to your extension root. `''` is the root itself. **Must not start with `/`** |
| `component` | the named export that renders it |
| `nav` | present: a sidebar entry appears. Absent: the page exists but is not linked |
| `access` | who may open it |

A page **only exists while the extension is installed and active** in that
workspace. Otherwise the route is not there.

## Navigation

```ts
nav: { label: 'Reviews', icon: 'IconStar', section: 'extensions', order: 100 }
```

| field | default | means |
|---|---|---|
| `label` | required | the sidebar text |
| `icon` | - | an `@tangen/icons` name such as `'IconStar'`, or `{ src }` |
| `section` | `'extensions'` | `content`, `extensions`, `workspace`, `ai`, `devspace`, or `root` |
| `order` | `100` | lower sorts higher |

Use `'extensions'` unless your feature genuinely belongs beside Content. `root`
puts an item at the top level, outside any section - reserve it for something an
editor uses constantly.

## Access

```ts
access: { capability: 'reviews:moderate' }
access: { roles: ['editor'] }
```

Owner and admin sessions always pass. Other members pass when their effective
role matches `roles`, or they hold `capability`.

A member who fails the rule gets the **No-permission state and loses the nav
item** - the page does not appear as a broken link.

Declare the capability in your manifest's `capabilities` so an operator can
grant it in the roles editor.

## Sidebar panels

```ts
sidebarPanels: [
  {
    id: 'reviews',
    label: 'Reviews',
    component: 'ReviewPanel',
    icon: 'IconStar',
    types: ['product', 'article'],
    placement: 'sidebar',
    renderMode: 'inline',
  },
],
```

| field | default | means |
|---|---|---|
| `id` | required | unique within your extension |
| `types` | **every type** | which content types it appears on |
| `placement` | `'main'` | `'main'` is a card below the fields; `'sidebar'` is the right rail |
| `renderMode` | `'inline'` | `'modal'` renders a button that opens it. Ignored in the sidebar |
| `buttonLabel` | `'Open'` | the modal's button |

**Always list `types`.** Omitting it shows your panel on every content type,
including the ones it makes no sense for.

## Inside a page

A page gets **no injected props**. Read identity from the route:

```tsx src/pages/ReviewsPage.tsx
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'

export function ReviewsPage() {
  const { workspaceId, env } = useParams<{ workspaceId: string; env: string }>()
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; rows?: Review[] }>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    fetch(`/api/v1/admin/ext/acme.reviews/list`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((json) => alive && setState({ status: 'ready', rows: json.data }))
      .catch(() => alive && setState({ status: 'error' }))
    return () => { alive = false }
  }, [workspaceId, env])          // BOTH, always

  if (state.status === 'loading') return <Spinner />
  if (state.status === 'error') return <ErrorState onRetry={…} />
  if (!state.rows?.length) return <EmptyState />
  return <ReviewTable rows={state.rows} />
}
```

Four rules in that snippet, and each one is a bug that has been shipped before:

1. **Key every fetch and every cache on `workspaceId`.** A cache keyed on
   nothing serves one workspace's data to another. This exact defect has been
   found three times in this codebase.
2. **Loading is not empty.** A spinner and "no reviews yet" are different
   states, and showing the second while the first is true is a lie.
3. **An error is not empty either.** A failed fetch gets an error state with a
   retry, never a blank page implying there is no data.
4. **A filtered empty is not an empty.** "No results for that filter" offers to
   clear the filter; "nothing here yet" offers to create something.

## Dashboard widgets

```ts
dashboardWidgets: [ /* … */ ]
```

Declared in the manifest and rendered on the workspace dashboard. Use them for
a number or a short list an operator wants at a glance, not for a second copy
of your page.

## Slots

`slots` in the manifest fills a core screen with your component:
`{ slot, id, component, priority?, access? }`, where `slot` is
`admin.settings.sections@1` (Settings → General) or
`admin.extension.overview@1` (your overview page) and `component` names an
export of your client module that receives `{ context }` (`workspaceId`,
`extensionId`, `slot`). Higher `priority` renders first; `access` is the
page rule; every item has its own error boundary. A manifest that declares
`grants` needs `admin:contribute` to fill a slot. Typed `settings` get a
generated form on the settings slot without declaring one.

## How your UI reaches the Admin

The Admin is compiled **per project**. `tangen dev` runs Vite inside the
installed `@tangen/admin`, pointed at your project, and a build step
scans the `resolve:` literals in `app/config/extensions.ts`, resolves each to
`node_modules/<package>/tangen.extension.ts`, and lazily imports the named
exports your manifest asks for.

Three consequences, all proven from a registry-installed package in Stage G7:

1. **A published package's Admin UI works.** Nothing about panels or pages is
   first-party only.
2. **Ship TypeScript and TSX source, not a bundle.** That step looks for
   `tangen.extension.ts` at your package root and imports your `src/index.ts`
   directly; a package that ships only compiled `dist/` is not found at all.
   Your consumer's Vite compiles your source, which is also why `react` belongs
   in `peerDependencies`.
3. **`resolve` must be a static string literal.** A computed specifier is
   skipped, because that scan reads the config as text rather than
   importing it (that file reads secrets).

`tangen start` runs the API only. Serving the Admin in production is not part of
the consumer CLI today, so treat Admin contributions as a development and
operations surface until that changes.

## Runtime bundles

Add `ui: './dist/admin.js'` to the manifest and run `tangen extension
bundle` in the extension: your client module becomes one ES module the
Admin loads at runtime from `GET /admin/ext/<id>/ui.js`, listed by
`GET /admin/ui-manifest` with your pages, panels, slots and commands. React,
react-dom, react-router-dom, `@tangen/ui` and `@tangen/icons` are read from
the Admin's shared runtime, never bundled; import anything else freely. A
site then installs the extension without rebuilding its Admin. Local
extensions compiled into the build keep working as before.

## What is not a contribution slot

Do not build against anything not listed above. In particular, the Admin's
capability descriptor carries navigation metadata for ids that are **not
registered capabilities** and settings hrefs for pages that **do not exist** -
that metadata is a known dead entry, not a slot to fill.

## Testing

- **Render each component** with a router stub and assert the four states.
- **Assert the nav item disappears** when the extension is disabled.
- **Assert `access` refuses** a member without the capability.
- **Assert cache keys** include the workspace - the cheapest
  test that catches the most expensive bug here.

## Related

- [Server routes](/extend/contributions/routes) - what your page calls ·
  [Permissions and security](/extend/contributions/permissions) ·
  [Custom field types](/extend/contributions/fields) ·
  [Extension manifest reference](/reference/extension-manifest)
