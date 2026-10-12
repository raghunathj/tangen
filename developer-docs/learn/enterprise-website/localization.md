---
title: Add localization
description: English, French and German, per-field, with the republish rule that catches everyone.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch9
---

# 9. Add localization

**Goal** the site in three languages, with translations visible on the frontend
and untranslated fields falling back.

**Prerequisites** [chapter 8](/learn/enterprise-website/frontend-routes).

## Not every field is translated

Northwind marks `localized: true` on the fields a translator actually owns: a
product's `tagline` and `summary`, a page's `summary`, an article's `excerpt`
and `body`. Not on `order`, not on `logo`, not on relations. Localization is
per field, and marking everything creates work nobody does.

## Steps

**Enable it.** This rewrites your workspace config and reports every change it
makes:

```bash
bun x tangen enable localization
```

**Add the locales** in the file it created:

```ts app/config/localization.ts
import { defineLocalizationConfig } from '@tangen/cms'

export const localizationConfig = defineLocalizationConfig({
  enabled: true,
  defaultLocale: 'en',
  locales: [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
  ],
})
```

**Apply it.** Push creates a `<type>_i18n` side table per localized type. The
default locale stays in the main table; translations live beside it:

```bash
bun x tangen push
```

```text
+ page_i18n: create side table
+ page_i18n.summary: add localized column TEXT
+ product_i18n: create side table
+ product_i18n.tagline: add localized column TEXT
```

## Writing a translation

A locale-scoped `PATCH`, then a **republish**:

```ts scripts/translate.ts
async function translate(type: string, id: string, locale: string, values: Record<string, unknown>) {
  await call('PATCH', `/objects/${type}/${id}?locale=${locale}`, values)
  await call('POST', `/objects/${type}/${id}/publish`, {})
}

await translate('product', gridlock, 'fr', {
  tagline: "Une ingestion qui ne perd aucun événement",
})
```

**The republish is the whole trick.** A locale-scoped write returns `200` and
writes the side row, but the Delivery API keeps serving the published snapshot.
Without that second line every translation is invisible to the site while every
write looks successful. This costs people an afternoon; it is the single most
important sentence on this page.

## Reading a locale

On the SDK, `.locale()` is a builder method:

```ts
const { data } = await tangen.objects('product')
  .locale('fr')
  .where({ slug: { eq: 'gridlock' } })
  .limit(1).get()

data[0].tagline    // 'Une ingestion qui ne perd aucun événement'
```

If you call the query route directly, `locale` is a **top-level key of the
request body**. A `?locale=fr` on that route is ignored rather than refused, so
you get a `200` carrying English and it looks like a missing translation.

## Locale-prefixed routes

The site serves `/fr/...` and `/de/...` by taking the prefix off the path and
passing the rest through the same routes:

```ts
const seg = url.pathname.split('/')[1]
const locale = ['fr', 'de'].includes(seg) ? seg : 'en'
const path = locale === 'en' ? url.pathname : url.pathname.slice(locale.length + 1) || '/'
```

Links stored in the CMS are default-locale form, so the site adds the prefix:

```ts
const L = (p: string) => (locale === 'en' || !p.startsWith('/') ? p : `/${locale}${p === '/' ? '' : p}`)
```

## Expected result

| route | shows |
|---|---|
| `/products/gridlock` | Streaming ingestion that does not drop events |
| `/fr/products/gridlock` | Une ingestion qui ne perd aucun événement |
| `/de/products/gridlock` | Streaming-Ingestion, die keine Ereignisse verliert |

And `<title>` on `/fr/company/about` is `À propos`.

## Fallback

`/fr/company/careers` has no French translation and still renders, in English.
Fallback is **per field**, to the default locale, so a half-translated record
shows French where it has French and English where it does not.

## Verification

- the three product routes above show three different taglines
- `/fr/company/careers` returns `200` with English content
- a translation written without a republish is not visible, and is after one

## Common mistake

**Translating and not republishing.** See above. It is not a warning you will
get; it is one you have to remember.

## Relevant canonical docs

- [Localization](/build/localization) - the full model, side tables, fallback
- [TangenQL: locale](/reference/tangenql) - the wire form
- [SDK reference](/reference/sdk) - `.locale()`
