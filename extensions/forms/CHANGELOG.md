# @tangen/ext-forms

## 0.2.5

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.5.0
  - @tangen/ui@0.2.6
  - @tangen/icons@0.1.2
  - @tangen/cms@0.2.4

## 0.2.4

### Patch Changes

- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [120fff5]
- Updated dependencies [d54f1ba]
  - @tangen/types@0.4.0
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

- Updated dependencies [a33a309]
- Updated dependencies [809bb12]
- Updated dependencies [3b6e5d5]
  - @tangen/types@0.3.0
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
- Updated dependencies
  - @tangen/types@0.2.0
  - @tangen/icons@0.0.26
  - @tangen/cms@0.2.0
  - @tangen/ui@0.2.0
