# @tangen/studio-compiler

## 0.1.3

### Patch Changes

- The delivery contract belongs to the platform, not to Studio.
  
  `DeliveryProvider` lived in `@tangen/studio-compiler`, which meant
  `packages/api` imported Studio code on the one path that exists to keep
  working when Studio is disabled. The contract now lives in `@tangen/types`,
  imported by the platform delivery route, by the store that resolves a backend,
  and restated by `ctx.delivery`.
  
  Types only, deliberately: a value exported there reaches the public surface of
  `@tangen/cms`, and a site developer has no use for a delivery backend. Core's
  own backends live beside their resolver in the API; `@tangen/studio-compiler`
  keeps its key-value one, and it retires with Studio.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.6.0

## 0.1.2

### Patch Changes

- Registry metadata: these packages pointed at the private development
  monorepo, so each one's page on npm linked to a repository nobody outside
  could open. They now name the public repository and carry the `homepage` and
  `bugs` fields npm renders.
  
  A patch rather than nothing, because a manifest only reaches the registry with
  a new version.
- Updated dependencies
  - @tangen/studio-schema@0.1.2
