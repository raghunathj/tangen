---
title: Links and navigation
description: Modeling destinations that survive a slug change, and resolving them to URLs in your app.
audience: site-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch8
---

# Links and navigation

A `link` field holds a destination an editor chose: either your own content or
an external URL.

**An internal link stores identity, not a URL.** That is the whole point. An
editor renames `/about-us` to `/about`, and every menu item, button and inline
link still resolves - because none of them stored the old path.

## Model it

```ts app/globals/index.ts
import { defineGlobals } from '@tangen/cms'

export default defineGlobals([
  {
    name: 'navigation',
    label: 'Navigation',
    fields: [
      {
        name: 'primary', label: 'Primary menu', fieldType: 'repeater',
        config: {
          fields: [
            { name: 'label', label: 'Label', fieldType: 'text', required: true },
            {
              name: 'target', label: 'Target', fieldType: 'link',
              config: { allowedTargets: ['page', 'article'] },
            },
          ],
        },
      },
    ],
  },
])
```

Globals and container fields both take their sub-fields as an **array** whose
entries name themselves - the keyed `field.*` map is for a content type's
top-level fields. See [Globals](/build/globals).

`allowedKinds` restricts to internal or external; `allowedTargets` restricts
which content types an internal link may point at; `anchor` and `query` toggle
those inputs.

## Resolve it in your app

Tangen gives you identity and the target's current facts. **Your router builds
the URL** - Tangen does not know your routes, and inventing one is the thing it
refuses to do.

```ts app/lib/link.ts
import { isInternalLink, isExternalLink, isLinkResolved, linkSuffix } from '@tangen/sdk'
import type { ResolvedLink } from '@tangen/sdk'

export function hrefFor(link: ResolvedLink): string | null {
  if (!isLinkResolved(link)) return null
  if (isExternalLink(link)) return link.href
  if (isInternalLink(link) && link.target) {
    const path = link.target.type === 'page'
      ? `/${link.target.slug}`
      : `/${link.target.type}/${link.target.slug}`
    return `${path}${linkSuffix(link)}`
  }
  return null
}
```

`linkSuffix()` returns the `?query#anchor` part, or `''`. There is no
`hrefOf()` that handles both branches, and there will not be.

## Render an unresolved link as text

`target` is `null` when the destination is missing, deleted, or not published in
this read. That is normal, not an error:

```tsx
const href = hrefFor(item.target)
return href
  ? <a href={href}>{item.label}</a>
  : <span>{item.label}</span>
```

A link to nowhere is worse than no link. `targetRef` survives even then, so an
editor can see and repair it in the Admin.

## Anchors, query and locale

- `anchor` is stored without the `#` and appended by `linkSuffix()`.
- `query` is structured, and merged into the href for external links.
- `locale` on an internal link says **which locale of the target to resolve**.
  It is metadata about the destination, not a routing instruction - your app
  still decides what a French URL looks like.

## Common mistakes

- **Storing a URL in a `text` field** for internal content. It breaks silently
  on the first rename.
- **Treating `target === null` as an error.** Render text.
- **Building the URL from `targetRef`** instead of `target`. `targetRef` is the
  authored identity and carries no slug.
- **Expecting to filter on a link.** `link` is not filterable in v1.

## Related

- [Link reference](/reference/link) - the exact shapes and every edge case
- [Relations](/build/content-modeling/relations) - when a relation is the right
  answer instead
- [Frontend integration](/build/frontend)
