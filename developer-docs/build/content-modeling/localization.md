---
title: Modeling for localization
description: Deciding which fields translate, before you have translations.
audience: site-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g8/i18n-tables
---

# Modeling for localization

Localization is **per field, opt-in**:

```ts
subtitle: field.text({ label: 'Subtitle', localized: true }),
body:     field.richtext({ label: 'Body', localized: true }),
sku:      field.text({ label: 'SKU' }),                      // not localized
```

A localized field's values live in a per-type side table; the default locale's
value stays on the main row.

## What to localize

**Yes:** anything a person reads. Titles, body copy, labels, meta descriptions,
alt text, button text.

**No:** identifiers and data. SKUs, prices in a single currency, dates, external
URLs, and anything another system owns.

**It depends:** slugs. A localized slug gives you `/fr/a-propos`; an
unlocalized one gives you `/fr/about`. Both are legitimate - decide by whether
your URLs are content or infrastructure.

## Media does not need the flag

Media localizes at the **asset** level - per-locale variants of the same field.
Do not put `localized: true` on a media field.

## Decide early

Adding `localized: true` later is a schema change that moves data into a side
table. It works, and `tangen push` shows you the plan, but it is easier to
decide while you are modeling.

If you are unsure whether a site will ever be multilingual, localize the
obvious text fields now. An unused side table costs nothing; a retrofit costs a
migration.

## Related

- [Localization](/build/localization) - configuring locales and querying
- [Fields reference](/reference/fields)
