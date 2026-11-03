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
those inputs. `withLabel` is the one option that defaults OFF, so without it
the editor gets a destination and no words to click.

**Name `allowedTargets` when you can.** It is the rule the server enforces on
save, and it is also what the picker opens on: left absent, an internal link
may point at any type, so the picker offers a type selector over all of them
and the editor has one more decision to make before they can search. The picker
searches and pages one type at a time on the server, newest first, so the
narrower the rule the shorter the path to the entry they want.

**`allowedKinds` is what the editor is offered.** Naming `['internal',
'external']` means no **Page path** tab, so an author cannot type an arbitrary
route - which is the point when every destination should be a real entry or a
real URL. Add `'path'` back when the site has routes that are not entries here:
a search page, a route your app renders itself. All three are offered when the
option is omitted.

## Resolve it in your app

Tangen gives you identity and the target's current facts. Where the target's
type declares a `path`, it also gives you the finished URL: `target.path` is
the destination's address and `href` is that address with the query and anchor
appended. Where it declares none, **your router builds the URL** - Tangen will
not invent a route it was never told about.

```ts app/lib/link.ts
import { isInternalLink, isLinkResolved, linkHref, linkSuffix } from '@tangen/sdk'
import type { ResolvedLink } from '@tangen/sdk'

export function hrefFor(link: ResolvedLink): string | null {
  if (!isLinkResolved(link)) return null
  const href = linkHref(link)              // external, path, and any declared path
  if (href) return href
  if (isInternalLink(link) && link.target) {
    const path = link.target.type === 'page'
      ? `/${link.target.slug}`
      : `/${link.target.type}/${link.target.slug}`
    return `${path}${linkSuffix(link)}`
  }
  return null
}
```

Declare `path` on the types your links point at and the second branch stops
being reached at all - see [Addresses and routing](/build/content-modeling/addresses). `linkSuffix()` returns the `?query#anchor` part, or `''`,
for the types that have no declared address.

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
