# @tangen/ext-forms

## 0.2.6

### Patch Changes

- Forms refuses a content write whose `form` field points at a form that does not exist.
  
  A page could publish a reference to a deleted or renamed form and the only
  sign was an empty section on the live site. The field type could not catch it:
  `SiteFieldValidate` receives a value and nothing else, so an existence check
  was impossible there, and `ContentHookCtx` carried no query access either.
  
  `ContentHookCtx.ext` is the new seam, bound per extension in the hook runner
  the way filters and contributions are already lent their own ctx. It is a
  getter rather than a value, because hooks run on every content write and
  building a ctx is not free; an extension that only reads `nextData` pays
  nothing. It is absent for site hooks and on a host that has not wired
  extensions, which a hook reads as "cannot verify" and proceeds.
  
  Forms walks the type's own definition alongside the values, so a `form` field
  is found inside a component block, a repeater row, or a block within a block,
  and asks one question of the database only when the walk found a reference.
  It fails open on a missing ctx, types or db: a check that refuses writes
  because it could not run is worse than the gap it closes.
  
  The extension manifest moves to 0.3.0 and declares `hooks:content`. Because a
  new REQUIRED grant is not in what an existing installation recorded, every
  workspace with Forms installed must run `tangen extension upgrade forms` and
  approve it; until then the check does not run.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.6.0
  - @tangen/icons@0.1.3
  - @tangen/cms@0.2.6
  - @tangen/ui@0.2.9

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
