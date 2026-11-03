---
title: Addresses and routing
description: "Declare where a content type lives with `path`, read a composed address with `includePath`, and pin your catch-all route against the pattern so the two cannot drift apart."
audience: site-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-10-24
verification: source
verifiedBy: packages/api/src/__tests__/seo-paths-pglite.test.ts
---

A content type can say where its content lives. Declare `path` once, and link
fields, sitemaps, canonicals and the editor's URL preview all read the same
address.

```ts
defineObjectType({
  name: 'post',
  path: '/blog/:category*/:slug',
  fields: [relationOne('category', { targetType: 'category' })],
})
```

A post in Design under Creative is now at `/blog/creative/design/my-post`.
Nobody stores that string, and renaming Creative corrects every address under
it at once.

## Who does what

**Tangen composes an address. Your app parses one.**

Tangen holds the category tree and the slugs, so only it can build
`/blog/creative/design/my-post`. Your router already declares
`app/blog/[...path]/page.tsx`, so only it can turn that address back into a
page. Tangen deliberately does not try: a second route model would disagree
with yours, and the disagreement is invisible until a 404.

Reverse lookup stays one query, because the last segment is the slug and a
slug is unique per type:

```tsx
export default async function Page({ params }: { params: { path: string[] } }) {
  const slug = params.path.at(-1)!
  const post = await tangen.objects('post').includePath().findBySlug(slug)
  if (!post.data) notFound()

  // The page moved: send the visitor (and the crawler) to its real address.
  const requested = '/blog/' + params.path.join('/')
  if (post.data._path !== requested) redirect(post.data._path!)

  return <Post {...post.data} />
}
```

## The pattern grammar

| Token | Means |
|---|---|
| `blog` | a literal segment |
| `:slug` | this object's own slug |
| `:category` | one segment: that relation's slug |
| `:category*` | that relation AND its ancestors, root first |
| `:category\|general` | a literal when the relation is empty |

Four rules, each enforced at load with the offending token named:

- A chain walks **up**, never down. A segment holds one value, and "up from
  here" is the only direction through a tree with a single answer.
- `:field` is exactly one segment; `:field*` is zero or more. `/:parent*/:slug`
  gives `/about` for a page with no parent.
- A bare `:field` that resolves to nothing is **refused** unless `|fallback`
  gives it a literal. Dropping it silently would produce an address your
  three-slot route cannot match: the link looks fine and 404s.
- A segment must name a relation holding **one**. "Which of the tags?" has no
  answer.

At most six segments, which bounds the recursive query.

### Your home page

```ts
path: { pattern: '/:parent*/:slug', root: 'home' }
```

The object whose slug is `home` lives at `/`. Everything else composes
normally.

## Reading the address

`_path` is **opt in** - it costs a join, so no read pays for it by accident:

```ts
const posts = await tangen.objects('post').includePath().get()
posts.data[0]._path            // '/blog/creative/design/my-post'
```

One extra query per type, not one per row and not one per level: 50 posts
three categories deep is one query. `_path` is `null` only where the pattern
declares no address for that object.

### Your links now carry their own href

An internal `link` field's target carries `path`, and the link carries `href` -
that address with any query and anchor appended - so every link kind renders
the same way:

```tsx
<a href={link.href}>{link.label}</a>
```

`href` is absent rather than null when there is no address, which is the
difference between "no page" and "a page at nothing". You do not opt in to
this: a link exists to be rendered.

### Where a page sits

`includeAncestors()` adds `_ancestors` - the chain above a row, root first, as
`{ id, title }`. It is the same bargain as `_path`: opt in, one extra query per
read whatever the depth, and only for a type whose parent relation Tangen
provides.

```ts
const pages = await tangen.objects('page').includeAncestors().get()
pages.data[0]._ancestors       // [{ id, title: 'About' }]
```

Reach for it whenever rows are paged, filtered or sorted and their nesting
matters: assembling the tree client-side needs every row at once, and a parent
that is not on the page reads as "no parent", so children appear at the top
level.

## When something moves

Nothing is stored, so anything that changes a row's place re-addresses
everything under it, and nothing is holding the old address:

| Change | What happens |
|---|---|
| Rename a parent's slug | every descendant's address changes |
| Move a parent | the same, and deliberate - nothing refuses it |
| Delete a parent | **refused**: Tangen's hierarchical `parent` declares `onDelete: 'restrict'`, so the delete answers 409 naming the pages inside it |

The first two are what the catch-all below absorbs: compare the address that
was requested to the object's `_path` and redirect on a mismatch, and a moved
page keeps its inbound links.

## Two other ways to declare it

| Instead of a pattern | Use it when |
|---|---|
| `path: { field: 'legacyUrl' }` | an editor already types the address into a column, typically after a migration |
| `path: (object) => string \| null` | the rule is not expressible as a pattern |

A function is code-side, like `validate`, so it never reaches the database and
the Admin cannot show or edit it. Prefer a pattern: a function is handed the
object but never the ancestor chain, which takes a query.

## Locales change only the prefix

```ts
defineLocalizationConfig({
  enabled: true,
  defaultLocale: 'en',
  pathPrefix: 'as-needed',                                  // the default
  locales: [
    { code: 'en', label: 'English' },
    { code: 'de', label: 'Deutsch' },                       // -> /de/blog/x
    { code: 'fr', label: 'Français', url: 'https://example.fr' },
  ],
})
```

`as-needed` leaves the default locale bare and prefixes the rest, as Next's
own i18n routing does. `always` prefixes every locale; `never` adds nothing,
for a site whose middleware handles it. A locale with its own `url` is never
prefixed - it carries its locale in the host.

`_path` comes back already prefixed, so it is a complete answer. Slugs
themselves do not translate in v1, which is exactly why one chain resolution
serves every locale.

## Pin your route to the pattern

`tangen types` emits each pattern as a string literal type, so your route file
cannot quietly disagree with the declaration:

```ts
import type { TangenContentPaths } from './generated/tangen-types'

const postRoute: TangenContentPaths['post'] = '/blog/:category*/:slug'
```

Move the pattern and this stops compiling, rather than 404ing in production.

## Editing it without touching code

Type settings in the Admin carries an **Address** row. The pattern is editable
there, validated as you type - an unknown field is named before any push - and
it shows one example address. That is why the pattern is structure rather than
only a function.

## Next

- [Links and navigation](/build/content-modeling/links) - the field whose `href` this fills in
- [Modeling for localization](/build/content-modeling/localization) - what translates, and what does not
- [SEO](/extensions/seo) - sitemaps and canonicals over the same address
