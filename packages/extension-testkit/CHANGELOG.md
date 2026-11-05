# @tangen/extension-testkit

## 0.2.4

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.6.0
  - @tangen/api@0.2.5

## 0.2.3

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/api@0.2.4
  - @tangen/types@0.5.0

## 0.2.2

### Patch Changes

- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [120fff5]
- Updated dependencies [d54f1ba]
  - @tangen/types@0.4.0
  - @tangen/api@0.2.3

## 0.2.1

### Patch Changes

- Updated dependencies [2c270e5]
- Updated dependencies [a33a309]
- Updated dependencies [809bb12]
- Updated dependencies [03269e0]
- Updated dependencies [f8a0101]
- Updated dependencies [c133431]
  - @tangen/api@0.2.2
  - @tangen/types@0.3.0

## 0.2.0

### Minor Changes

- `ctx.sign` on the extension context, and `testSigner` in the testkit.
  
  An extension that stores a decision a member can also write needs to tell its
  own writes apart from a member's. `ctx.sign` is an HMAC keyed from the
  deployment secret and labelled per extension, available on the server context
  and on both content-hook contexts. New surface, so a minor.
  
  `testSigner(extensionId)` gives a test a deterministic signer over a fixed
  test key, so a suite never reaches for the deployment secret or the dev-secret
  file.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangen/types@0.2.0
  - @tangen/api@0.2.0
