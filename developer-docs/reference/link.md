---
title: Link
description: "The link field: stored shape, resolved shape, routing boundary, and what it deliberately does not do."
audience: site-developer
type: reference
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-01
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Link

A `link` field holds a destination that is either **Tangen content**, held by
identity, or an **external URL**.

An internal link stores `{ type, id }` and nothing derived from it. Tangen does
not store a canonical href for internal content, because it does not know your
routes. **A slug is not identity**: rename a slug and every link to it still
points at the same object.

## Declaring one

```ts app/content-objects/page/schema.ts
import { defineObjectType, field } from '@tangen/cms'

export default defineObjectType({
  name: 'page',
  label: 'Page',
  fields: {
    cta: field.link({
      label: 'Call to action',
      config: {
        allowedKinds: ['internal', 'external'],
        allowedTargets: ['page', 'article'],
        anchor: true,
        query: true,
      },
    }),
  },
})
```

| option | type | default | means |
|---|---|---|---|
| `allowedKinds` | `('internal' \| 'external')[]` | both | which destinations the editor offers, and validation accepts |
| `allowedTargets` | `string[]` | any readable type | content types an internal link may point at |
| `anchor` | `boolean` | `true` | offer an anchor |
| `query` | `boolean` | `true` | offer query parameters |
| `validation` | rules | - | the ordinary common, domain, URL and link rules |

`localized: true` works like any field: the *authored destination* may differ
per locale. That is different from an internal link naming a locale of its own
target, which is `locale` below.

## Stored shape

Internal:

```json
{
  "type": "internal",
  "target": { "type": "page", "id": "obj_01H..." },
  "locale": "fr",
  "anchor": "team",
  "query": { "source": "footer" }
}
```

External:

```json
{
  "type": "external",
  "url": "https://example.com/pricing",
  "anchor": "plans",
  "query": { "ref": "docs" }
}
```

`anchor` is stored without the `#`; `#team`, ` team ` and `team` all store as
`team`. `query` is structured, never a raw string, and its keys are stored
sorted so two links that mean the same thing compare equal.

## Resolved shape

A read returns a different shape from the one you store.

Internal - **identity plus current facts**:

```json
{
  "type": "internal",
  "targetRef": { "type": "page", "id": "obj_01H..." },
  "target": {
    "type": "page", "id": "obj_01H...",
    "slug": "about", "title": "About us", "status": "published"
  },
  "locale": "fr",
  "anchor": "team",
  "query": { "source": "footer" }
}
```

`targetRef` is **always present**, so a broken link stays repairable in the
editor. `target` is `null` when the target cannot be resolved for this read -
missing, deleted, or not published in this status. It carries exactly five
keys: `type`, `id`, `slug`, `title`, `status`. No relations, no media, and no
links of its own, so a link can never start an expansion chain.

External - **one derived href**:

```json
{ "type": "external", "href": "https://example.com/pricing?ref=docs#plans" }
```

`href` is `url` with the query merged and the anchor appended. Deterministic,
and the only field.

## The routing boundary

**Tangen owns the destination. Your application owns the URL.**

There is deliberately no `hrefOf(link)` that covers both branches: for an
internal target it would have to invent a path, which is the thing v1 does not
do. Use the guards, and build the path with your own router:

```ts app/lib/link.ts
import { isInternalLink, isExternalLink, isLinkResolved, linkSuffix } from '@tangen/sdk'
import type { ResolvedLink } from '@tangen/sdk'

export function hrefFor(link: ResolvedLink): string | null {
  if (!isLinkResolved(link)) return null            // render as plain text
  if (isExternalLink(link)) return link.href
  if (isInternalLink(link) && link.target) {
    return `/${link.target.type}/${link.target.slug}${linkSuffix(link)}`
  }
  return null
}
```

`linkSuffix()` returns the `?query#anchor` part, or `''`.

An unresolved link is not an error. It means the target is not available for
this read, and the right rendering is plain text rather than a link to nowhere.

## What Link does not do

| | |
|---|---|
| **consume relation depth** | a link resolves the same at any `depth`, including `0` |
| **filter** | `link` is not a filterable type in v1. No operators over the destination |
| **enforce uniqueness** | not a unique type |
| **appear as a list column** | not listable |
| **have a default value** | a destination has no scalar default |
| **support backlinks** | `_referencedBy` **refuses** a link field loudly rather than returning nothing. Backlink discovery is relations only in v1 |

## Errors

An invalid link answers in the ordinary validation envelope: **422
`VALIDATION_ERROR`**, reported under the field's name. The rejected URL is
never echoed back.

External schemes default to `https`, `http`, `mailto` and `tel` unless the
field narrows them.

## Related

- [Fields](/reference/fields) · [TangenQL](/reference/tangenql) ·
  [SDK](/reference/sdk) · [Errors](/reference/errors)
