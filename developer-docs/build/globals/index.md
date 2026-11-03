---
title: Globals
description: Site-wide singletons - settings, navigation, SEO defaults - and how to query them.
audience: site-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-10-13
verification: executable
verifiedBy: stage-g6/ch4+ch7, globals-no-push 2026-10-13
---

# Globals

A global is a **singleton**: one record for the whole workspace, not a list.
Site settings, the main menu, the footer, SEO defaults.

## Global or content type

| | |
|---|---|
| **global** | there is exactly one, forever. No slug, no list, no publish cycle of its own |
| **content type** | there are many, or there might be. It has a URL, or it appears in a list |

"Site settings" is a global. "Pages" is a type. A single About page is still a
type - one row today, two tomorrow.

## Defining

```ts app/globals/index.ts
import { defineGlobals } from '@tangen/cms'

export default defineGlobals([
  {
    name: 'site_settings',
    label: 'Site settings',
    fields: [
      { name: 'siteName', label: 'Site name', fieldType: 'text', required: true, config: { localized: true } },
      { name: 'contactEmail', label: 'Contact email', fieldType: 'email' },
      { name: 'maintenanceMode', label: 'Maintenance mode', fieldType: 'boolean' },
    ],
  },
  {
    name: 'seo_defaults',
    label: 'SEO defaults',
    fields: [
      { name: 'titleTemplate', label: 'Title template', fieldType: 'text', config: { localized: true } },
      { name: 'description', label: 'Default description', fieldType: 'textarea', config: { localized: true } },
      { name: 'socialImage', label: 'Default social image', fieldType: 'media' },
    ],
  },
])
```

Then import it in your workspace config as `globals`.

**Globals need no push and no migration.** `tangen push` never reads them: the
definitions are code, loaded with the project config and read on each request,
and the `globals` table stores only the authored DATA, keyed by name. So adding,
renaming or reordering a global takes a restart of the API, not a schema change.
Two consequences worth knowing: a global appears in the admin as soon as the API
reloads, and removing one ORPHANS its data row rather than dropping it, so the
values come back if you put the global back.

> A Global's `fields` is an **array**, not the keyed builder map content types
> use: each entry names itself with `name` and states its `fieldType`. Every field
> type is available - but the per-field options a `field.*` builder would fold in
> for you go under `config` here, which is why `localized` is nested. That is the
> whole difference between the two authoring shapes.

## Querying

```ts
const { data } = await tangen.globals('site_settings').get()
console.log(data.values.siteName)      // 'My Blog'
```

The values sit at `data.values` - one unwrap, unlike `objects(...)` which
returns its rows at `data`. Sites usually wrap it once:

```ts
const global = async (name: string) => (await tangen.globals(name).get()).data.values
```

**The name is not typed.** `tangen push` augments the registry with your
content types only - the generated file declares `content` and nothing else - so
`globals('site_settings')` takes a plain string and its result is `unknown`.
Narrow it yourself at the boundary:

```ts
interface SiteSettings { siteName: string; tagline?: string }
const settings = (await tangen.globals('site_settings').get()).data.values as SiteSettings
```

A typo in the name is therefore a runtime miss, not a compile error. Keep the
names in one module rather than repeating string literals across your site.

### A global has no `depth`

A relation or media field on a **content object** expands into the full record
under `.depth(1)`. A global has no depth option, so the same field comes back
as the **bare id string**:

```ts
const settings = (await tangen.globals('site_settings').get()).data.values
settings.logo                              // 'med_2ab66f04…', not an object
tangen.media.transformUrl(settings.logo, { w: 32, format: 'webp' })
```

That is enough to render an image, because a transform only needs the id. If
you want the asset's own `altText`, `width` or `height`, fetch it:
`tangen.media.get(settings.logo)`.

The key needs the **`globals:read`** scope - a key with only `objects: read`
gets a 403 that names the missing scope.

Needs `globals: read`. Writing needs `globals: write`.

## Navigation

The common pattern: a repeater of items, each with a label and a
[link](/build/content-modeling/links).

```ts
{
  name: 'navigation',
  label: 'Navigation',
  // The ARRAY form, like every global. A repeater's rows are plain sub-field
  // objects under config.fields; the field.* builders emit no `name`, so they
  // describe top-level fields of a content TYPE and never a global's.
  fields: [
    {
      name: 'primary', label: 'Primary menu', fieldType: 'repeater',
      config: {
        admin: { helpText: 'Drag to reorder. The order here is the order on the page.' },
        fields: [
          { name: 'label', label: 'Label', fieldType: 'text', required: true, config: { localized: true } },
          { name: 'target', label: 'Target', fieldType: 'link', config: { allowedTargets: ['page', 'article'] } },
          // A repeater nests. One level is usually all an IA needs.
          { name: 'children', label: 'Sub-items', fieldType: 'repeater', config: { fields: [
            { name: 'label', label: 'Label', fieldType: 'text', required: true },
            { name: 'target', label: 'Target', fieldType: 'link', required: true },
          ] } },
        ],
      },
    },
    { name: 'footer', label: 'Footer menu', fieldType: 'repeater', config: { fields: [ /* … */ ] } },
  ],
}
```

Two things that are easy to get wrong here, both of them the array form's doing:

- **`localized` goes under `config`**, on a global's fields and on a sub-field
  alike. It does not exist at a field's top level, so putting it there is a TYPE
  ERROR rather than a silent no-op. Mind that `tangen check` will not catch it:
  that command type-checks `app/content-objects` and `app/generated` only, so a
  globals file that does not compile still passes `check` and `push`. `tangen dev`
  uses the full tsconfig and does catch it.
- **`admin` belongs under `config` on a global's field** (`config: { admin: { width, helpText } }`),
  because a global's field is a field definition. On a RAW SUB-FIELD inside a
  repeater, `admin` may sit at the top level instead, and both are read. See
  [the fields reference](/reference/fields#admin-options-on-a-sub-field).

Then in your app:

```ts
const { data } = await tangen.globals('navigation').get()
const items = data.values.primary.map((item) => ({ label: item.label, href: hrefFor(item.target) }))
```

Because the target is a link, renaming a page's slug does not break the menu.

Header and footer are the same pattern - two repeaters on one global, or two
globals. One global with several menus is usually easier for editors to find.

## Localization

`localized: true` works on a global's fields exactly as it does on a type's.
Read a locale by passing it to your client, and the fallback rules are the
same.

## Caching

A global is read on nearly every page render. Cache it in your frontend for the
life of a request at minimum; a short TTL is usually safe, because a settings
change is not urgent to the second.

## Common mistakes

- **Modeling a one-row content type as a global** when it might become many.
- **Reading a global per component** instead of once per request.
- **Storing URLs as text in a menu.** Use a link.
- **Expecting a media or relation field to arrive expanded.** Globals have no `depth`; you get the id.

## Related

- [Fields reference](/reference/fields) · [Links and navigation](/build/content-modeling/links)
  · [Querying](/build/querying) · [Localization](/build/localization)
