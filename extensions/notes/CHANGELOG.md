# @tangen/ext-notes

## 0.2.4

### Patch Changes

- d54f1ba: Text a person has to read no longer sits on the decorative colour tier.
  
  `globals.css` states the rule beside the token, that the 50% tier is decorative
  only and readable text stops at the 60% tier, and nothing enforced it, so twenty
  places had drifted past it. The 50% tier measures 3.94:1 on a page; the 60% tier
  measures 5.7:1.
  
  In the Admin: the object list's "not translated" and "No file", bulk edit's "No
  options", the permission tree's resource label and slugs, settings > connections'
  group count, the roles table's empty dash, and eight lines in the AI panel
  (timestamps, token counts, two outcome lines, a step title). In the SEO manager:
  "Falls back to the page title" and "Not set". In Notes: the panel's "Internal:
  never shown on the site.", which was the only color-contrast violation on either
  editor surface. Two were not token changes at all, a rating's unfilled star and
  a separator.
  
  The a11y lane goes from 14 failures to 16 passing with it.
- Updated dependencies [d54f1ba]
  - @tangen/ui@0.2.5
  - @tangen/icons@0.1.1
  - @tangen/cms@0.2.3

## 0.2.3

### Patch Changes

- bbab122: A `@tangen` peer now declares the line it works with instead of `*`.
  
  `*` says "compatible with every version of this package, past and future".
  It is never true, and it was the only thing npm could have used to warn a
  site that an extension and the platform had drifted apart. It also hid the
  packages from the release tooling: a `*` peer cannot be taken out of range,
  so `changeset version` had no reason to release an extension when the
  platform moved under it, and the old `fixed` group was republishing all of
  them on every patch instead - with their declared compatibility byte for
  byte the same as the version before.
  
  The convention is `^<major>.<minor>` with no patch, which reads as "any patch
  inside this minor line". The patch is deliberately absent: on a 0.0.x package
  a caret pins it, so `^0.0.26` would admit only 0.0.26 and a single
  `@tangen/icons` patch would put every extension out of range at once. `^0.0`
  admits every 0.0.x, `^0.2` every 0.2.x.
  
  A release gate now refuses a `*` peer on a workspace package, and refuses a
  range that no longer admits the version that package is on, so this cannot go
  stale quietly.
- Updated dependencies [4edc9c1]
  - @tangen/icons@0.1.0
  - @tangen/ui@0.2.4

## 0.2.2

### Patch Changes

- Updated dependencies [3b6e5d5]
  - @tangen/ui@0.2.2
  - @tangen/cms@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies
  - @tangen/cms@0.2.1
  - @tangen/ui@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies
  - @tangen/icons@0.0.26
  - @tangen/cms@0.2.0
  - @tangen/ui@0.2.0
