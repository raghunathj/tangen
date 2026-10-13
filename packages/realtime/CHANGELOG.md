# @tangen/realtime

## 0.1.5

### Patch Changes

- Republished as 0.1.5 because 0.1.4 cannot exist.
  
  The 0.2.0 publish left `@tangen/realtime@0.1.4` in npm's *staged* state: the
  upload began, never completed, and npm then refuses the version forever with
  `409 Cannot publish over previously staged version`. The publisher reported it
  as published, because `bun publish` exited 0.
  
  That broke three packages that did publish, since `^0.1.4` had nothing to
  resolve to: `@tangen/admin@0.2.0`, `@tangen/realtime-admin@0.1.4` and
  `@tangen/realtime-react@0.1.3`. `^0.1.4` admits 0.1.5, so publishing this
  fixes all three without republishing any of them.

## 0.1.4

### Patch Changes

- Registry metadata: these packages pointed at the private development
  monorepo, so each one's page on npm linked to a repository nobody outside
  could open. They now name the public repository and carry the `homepage` and
  `bugs` fields npm renders.
  
  A patch rather than nothing, because a manifest only reaches the registry with
  a new version.
