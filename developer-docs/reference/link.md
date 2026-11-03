---
title: Link
description: "The link field: its three branches, stored and resolved shapes, the routing boundary, and what it deliberately does not do."
audience: site-developer
type: reference
status: stable
package: "@tangen/cms"
lastVerified: 2026-10-14
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Link

A `link` field holds a destination: **Tangen content** held by identity, an
**external URL**, or a **path** on your own site.

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

Path (2026-10-14):

```json
{
  "type": "path",
  "path": "/pricing",
  "anchor": "plans",
  "query": { "ref": "docs" }
}
```

`anchor` is stored without the `#`; `#team`, ` team ` and `team` all store as
`team`. `query` is structured, never a raw string, and its keys are stored
sorted so two links that mean the same thing compare equal. A `path` is stored
with exactly one leading slash and no trailing one, and never carries its own
query or anchor, so every value has one home.

## Resolved shape

A read returns a different shape from the one you store.

Internal - **identity plus current facts**:

```json
{
  "type": "internal",
  "targetRef": { "type": "page", "id": "obj_01H..." },
  "target": {
    "type": "page", "id": "obj_01H...",
    "slug": "about", "title": "About us", "status": "published",
    "path": "/about"
  },
  "href": "/about?source=footer#team",
  "locale": "fr",
  "anchor": "team",
  "query": { "source": "footer" }
}
```

`targetRef` is **always present**, so a broken link stays repairable in the
editor. `target` is `null` when the target cannot be resolved for this read -
missing, deleted, or not published in this status. It carries exactly six keys:
`type`, `id`, `slug`, `title`, `status`, and `path` - the target's composed
address when its type declares one, `null` when it does not. No relations, no
media, and no links of its own, so a link can never start an expansion chain.

`href` is `path` with the query and anchor appended, and is **absent** when
there is no address to build it from.

External - **one derived href**:

```json
{ "type": "external", "href": "https://example.com/pricing?ref=docs#plans" }
```

`href` is `url` with the query merged and the anchor appended. Deterministic,
and the only field.

Path - **one derived href, no target read**:

```json
{ "type": "path", "href": "/pricing?ref=docs#plans" }
```

Built by appending rather than through `new URL()`, which would need a base and
would invent an origin this link deliberately does not have. Nothing is loaded
to produce it: the application owns this route, so no target fact is consulted.

## Page paths: the third branch and why it exists

A `path` holds a route on YOUR site that is not a content object here. The
other two branches leave a hole without it:

| Destination | internal | external | path |
|---|---|---|---|
| An entry in this workspace | yes | no | no |
| Another site, an email, a phone number | no | yes | no |
| `/pricing`, rendered by your app from code | **no object to point at** | **hard-codes your domain** | yes |

That last row is the case. An internal link stores `{ type, id }` and there is
no object for a hand-built route; an external link stores an absolute URL, so
`https://acme.com/pricing` in content makes staging link to production.

It does not bend this page's boundary, it reads it from the other side.
"Tangen resolves content identity; your application resolves site routing" - and
a path IS site routing, stored verbatim and returned untouched, so Tangen
resolves nothing about it and can be wrong about nothing.

The usual objection, that a stored path breaks when a route moves, is a
**content** objection: a slug rename is a content action nobody tracks, while
`/pricing` is a route its own developer moves in code and knows they moved.
Where the destination genuinely IS an entry, use `internal` and get exactly
that protection.

**One value is refused:** a path beginning `//`, such as `//example.com/x`. It
reads as a path and is protocol-relative, so it leaves your site. That is what
makes this branch more than "a string starting with a slash".

An absolute URL in the path box answers `absolute` with the scheme, and a path
in the URL box answers `relative`. They are each other's mirror and both mean
"right value, wrong branch"; each message names the branch that would take it.

## The routing boundary

**Tangen owns the destination. A declared `path` is what makes it a URL.**

Tangen never invents a route. It composes one only from a pattern the type
itself declares, which is why an internal `href` is read rather than guessed:

```ts app/lib/link.ts
import { isInternalLink, isLinkResolved, linkHref, linkSuffix } from '@tangen/sdk'
import type { ResolvedLink } from '@tangen/sdk'

export function hrefFor(link: ResolvedLink): string | null {
  if (!isLinkResolved(link)) return null            // render as plain text
  const href = linkHref(link)                        // every branch with an address
  if (href) return href
  // A target type that declares no path: your router owns this one.
  if (isInternalLink(link) && link.target) {
    return `/${link.target.type}/${link.target.slug}${linkSuffix(link)}`
  }
  return null
}
```

`linkHref(link)` returns the finished string for an external link, a path link,
and an internal link whose target type declares a `path`. It is `null` only
where there is genuinely no address: an unresolved link of any kind, or an
internal link into a type with no declared path. `linkSuffix()` returns the
`?query#anchor` part, or `''`, for building that remaining case yourself.

There is still no `hrefOf()` that promises an address for every link: a type
that declares no path has none, and a guess would be worse than a null.

An unresolved link is not an error. It means the target is not available for
this read, and the right rendering is plain text rather than a link to nowhere.

## The external scheme policy

Three separate rules, in the order the validator applies them.

**1. Denied, whatever the schema says.** `javascript`, `vbscript`, `data`,
`blob`, `filesystem` and `file` name code or a local handle rather than a
destination. Listing one in `allowedSchemes` does not accept it; the error says
`the javascript scheme cannot be a link destination`, and a custom
`validation.messages` entry cannot replace that wording.

This is a floor rather than part of the allow-list because a hostname check
alone does not hold: `javascript://example.com/%0aalert(1)` parses with a
hostname and still executes in a browser.

**2. The allow-list is yours.** It defaults to `https`, `http`, `mailto` and
`tel`. Anything else is refused with `the ftp scheme is not allowed`, which is
a schema decision you can change:

```ts
validation: { allowedSchemes: ['https', 'whatsapp', 'sms'] }
```

`httpsOnly: true` narrows to `https` alone rather than competing with the
list, so the rule means the same thing as it does on a `url` field.

**3. A host is required where the URL has one.** An authority scheme
(`http`, `https`, `ws`, `wss`, `ftp`) always has one, even without the
slashes, because the URL parser reads `https:example.com` as that host. Any
other scheme has one only when `//` actually follows the colon. So, with the
three schemes above declared:

| Value | | Why |
|---|---|---|
| `whatsapp://send?text=hi` | accepted | authority form; `send` is the host |
| `sms:+15551234` | accepted | opaque; something follows the colon |
| `myapp://` | `malformed` | authority form with no host |
| `sms:` | `malformed` | opaque with nothing after the colon |

**An opaque URL is delivered verbatim.** `resolved.href` merges the stored
query and anchor into an authority URL, but returns an opaque one untouched,
because merging into it rewrites rather than appends: the parser reads
`intent:#Intent;package=com.x;end` as an empty path plus a fragment, so setting
a hash yields `intent:#x` and the destination is gone. Put everything an opaque
deep link needs in `url` itself, not in `anchor` or `query`.

A **relative URL** is refused on either branch of this policy, as routing
rather than as a destination: see [The routing boundary](#the-routing-boundary).

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

The scheme codes are distinct on purpose: `the <x> scheme is not allowed`
means this field does not allow it, which `allowedSchemes` fixes, while
`the <x> scheme cannot be a link destination` means nothing does. See
[The external scheme policy](#the-external-scheme-policy).

## Related

- [Fields](/reference/fields) · [TangenQL](/reference/tangenql) ·
  [SDK](/reference/sdk) · [Errors](/reference/errors)
