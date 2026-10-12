---
title: Add Globals and navigation
description: Four Globals for site-wide content, including a menu an editor owns, and how to wire them into the workspace.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch4
---

# 4. Add Globals and navigation

**Goal** four Globals, and a primary menu that lives in the CMS rather than in
frontend code.

**Prerequisites** [chapter 3](/learn/enterprise-website/page-blocks).

## What we are building

| global | holds |
|---|---|
| `site-settings` | name, tagline, logo, support and sales email |
| `navigation` | the primary menu, two levels |
| `footer` | a blurb, link columns, a legal line |
| `seo-defaults` | title suffix and default description |

None of this belongs in the frontend. An editor changes the sales address or
reorders the menu without a deploy, and that is the whole point.

## Steps

Globals are **not scaffolded**, so this chapter creates the directory and wires
it in by hand. Two steps, both required.

Global fields use the **array form**, like component sub-fields:

```ts app/globals/index.ts
import { defineGlobals } from '@tangen/cms'

export default defineGlobals([
  {
    name: 'site-settings',
    label: 'Site settings',
    description: 'Identity and contact details used across the site.',
    fields: [
      { name: 'siteName', label: 'Site name', fieldType: 'text', required: true },
      { name: 'tagline', label: 'Tagline', fieldType: 'text' },
      { name: 'logo', label: 'Logo', fieldType: 'media', config: { accept: ['image'] } },
      { name: 'supportEmail', label: 'Support email', fieldType: 'email' },
      { name: 'salesEmail', label: 'Sales email', fieldType: 'email' },
    ],
  },
  {
    name: 'navigation',
    label: 'Navigation',
    description: 'The primary menu. Two levels, which is all this IA needs.',
    fields: [
      {
        name: 'primary', label: 'Primary menu', fieldType: 'repeater',
        config: { fields: [
          { name: 'label', label: 'Label', fieldType: 'text', required: true },
          { name: 'href', label: 'Link', fieldType: 'link', required: true },
          { name: 'children', label: 'Sub-items', fieldType: 'repeater', config: { fields: [
            { name: 'label', label: 'Label', fieldType: 'text', required: true },
            { name: 'href', label: 'Link', fieldType: 'link', required: true },
          ] } },
        ] },
      },
    ],
  },
])
```

Then wire it into the workspace config. Nothing does this for you:

```ts app/workspaces/northwind-systems/workspace.config.ts
import globals from '../../globals'

export default defineWorkspace({
  // …
  components,
  globals,
})
```

```bash
bun x tangen push
```

## A menu item is a link, not a string

`href` is `fieldType: 'link'`, not text. A link stores what it points at rather
than where that thing currently lives, so renaming a page's path does not leave
the menu pointing at a 404. Chapter 8 resolves them.

## Expected result

Push applies cleanly, and the admin sidebar gains a **Globals** section with
your four entries, each editable as a single record.

## Verification

- the admin shows Globals: Site settings, Navigation, Footer, SEO defaults
- editing Site settings and saving succeeds

## Common mistake

**Forgetting to wire `globals` into the workspace config.** The file compiles,
push succeeds, and nothing appears in the admin. There is no error, because
from the platform's side you simply declared no Globals.

## Relevant canonical docs

- [Globals](/build/globals) - defining, reading, and the response shape
- [Links and navigation](/build/content-modeling/links) - what a link stores
- [Configuration reference](/reference/configuration) - the workspace config
