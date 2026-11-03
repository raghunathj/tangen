# @tangen/icons

## 0.1.2

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.5.0

## 0.1.1

### Patch Changes

- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [120fff5]
  - @tangen/types@0.4.0

## 0.1.0

### Minor Changes

- 4edc9c1: `@tangen/icons` moves to the 0.1 line, so an icon release stops dragging the
  admin with it.
  
  `@tangen/admin` and `@tangen/ui` both declare `@tangen/icons` as
  `workspace:^`, which publishes as a caret on the current version. A caret
  pins the patch on a `0.0.x` version: `^0.0.26` admits only `0.0.26`, so
  `0.0.27` was out of range for both of them and every single icons patch
  forced a republish of admin and ui. MEASURED: adding icons to a changeset of
  10 packages made it 12, and removing it brought it back to 10.
  
  On the 0.1 line the published range is `^0.1.0`, which admits every `0.1.x`,
  so an added icon reaches a site through its existing install and nothing else
  needs releasing. The peer ranges that name icons move with it.
  
  No icon changed, and no API changed. This is a version-line move.

## 0.0.26

### Patch Changes

- Registry metadata: these packages pointed at the private development
  monorepo, so each one's page on npm linked to a repository nobody outside
  could open. They now name the public repository and carry the `homepage` and
  `bugs` fields npm renders.
  
  A patch rather than nothing, because a manifest only reaches the registry with
  a new version.
- Updated dependencies
  - @tangen/types@0.2.0
