# @tangen/types

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
