---
title: Localization
description: Configuring locales, localizing content and globals, querying, fallbacks and routing.
audience: site-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-f/northwind#localization
---

# Localization

Tangen owns **localized content**. Your application owns **URLs and routing**.
Neither side crosses that line, and knowing where it is saves most of the
confusion.

## Enable it

```ts app/config/localization.ts
import { defineLocalizationConfig } from '@tangen/cms'

export default defineLocalizationConfig({
  enabled: true,
  defaultLocale: 'en',
  locales: [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
  ],
})
```

The default locale's values live in the main content table; other locales live
in per-type side tables that `tangen push` manages.

```bash
bun run tangen push
```

## Localize fields

Per field, opt-in:

```ts
subtitle: field.text({ label: 'Subtitle', localized: true }),
body:     field.richtext({ label: 'Body', localized: true }),
sku:      field.text({ label: 'SKU' }),                       // one value, all locales
```

Globals work the same way.

Media does **not** need the flag - it localizes at the asset level.

## Query a locale

```ts
const { data } = await tangen.objects('article').locale('fr').limit(20).get()
const settings = await tangen.globals('site_settings').get()
```

```ts
const { data: locales } = await tangen.locales()
// { enabled: true, locales: [...], defaultLocale: 'en' }
```

`locales()` returns `{ enabled: false }` when localization is off, which is the
honest way to build a language switcher that disappears rather than breaks.

## Fallbacks

A field with no translation falls back to the default locale, so a partly
translated page renders rather than showing gaps. That is usually what you
want - and it means **you cannot tell "translated" from "fallen back" by
looking at the value**. If a UI needs to say "not yet translated", check for the
translation explicitly rather than comparing strings.

## Routing is yours

Tangen does not choose between `/fr/about`, `fr.example.com` and an
`Accept-Language` header. Pick one, and read the locale from it:

```ts app/[locale]/[slug]/page.tsx
export default async function Page({ params }: { params: { locale: string; slug: string } }) {
  const page = await tangen.objects('page').locale(params.locale).findBySlug(params.slug)
  if (!page) notFound()
  return render(page)
}
```

## Localized slugs

If `slug` is localized you get `/fr/a-propos`; if it is not you get
`/fr/about`. Both are legitimate. Localized slugs are better for search and
for readers; unlocalized slugs are simpler and stable across languages.

Whichever you choose, look content up by the slug **for that locale** - a
French URL resolved against English slugs finds nothing.

## Links across locales

An internal link can name a `locale`: which locale of the **target** to
resolve. It is metadata about the destination, not a routing instruction - your
router still decides the path.

## Caching

**The locale must be in your cache key.** A cache keyed on slug alone will
serve French content to English readers, and it will do it intermittently,
which is the worst kind of bug to find.

## A language switcher

```ts
const { data: info } = await tangen.locales()
if (info.enabled) {
  const options = info.locales.map((l) => ({ code: l.code, label: l.label, href: `/${l.code}/${slugFor(l.code)}` }))
}
```

Switching should land on the **same content** in the new locale, not the home
page. That means knowing the target's slug per locale, which is why localized
slugs need a little more work in the router.

## Preview

Preview takes a locale: `fetchPreviewObject({ …, locale })`. An editor
previewing the French draft should see French.

## Common mistakes

- **Localizing a SKU or a price.**
- **Forgetting the locale in a cache key.**
- **Resolving a French URL against default-locale slugs.**
- **A switcher that always goes home.**
- **Adding `localized: true` to media.**

## Related

- [Modeling for localization](/build/content-modeling/localization) ·
  [TangenQL reference](/reference/tangenql) · [Globals](/build/globals) ·
  [Frontend integration](/build/frontend)
