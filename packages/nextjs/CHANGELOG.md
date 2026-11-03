# @tangen/nextjs

## 0.2.2

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangen/sdk@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [d54f1ba]
- Updated dependencies [120fff5]
  - @tangen/sdk@0.3.0

## 0.2.0

### Minor Changes

- ef0da88: One page serves both the published web and a draft preview.
  
  Draft mode was a flag with no consumer. `createPreviewHandler` enabled Next's draft mode and stored the validated token in an `HttpOnly` cookie, and nothing in the platform read either one, so a page behind the preview route still fetched published content. The missing half was never the API: `kernel/read-view.ts` has had the rule all along, that a key serves the published web unless it asks for a status AND holds the objects `read_draft` grant, and `.status()` is already on every SDK read. What was missing was a way for a Next page to ask.
  
  `previewStatus()` is that way. It answers `'draft'` while previewing and `'published'` otherwise, so the two views are one query:
  
  ```ts
  .where({ path }).status(await previewStatus()).limit(1).get()
  ```
  
  `isDraftMode()` and `getPreviewToken()` are the pieces it is built from, exported because a site picking between two clients needs the first and the one-object `fetchPreviewObject` read needs the second. All three answer the published view outside a Next request context instead of throwing: they run in a root layout, where an exception would take down the published site to serve a preview feature.
  
  The README and `docs/live-preview.md` now say which path is which. Whole-site draft browsing is the status read with a key that holds `read_draft`, kept separate from the everyday key so that key cannot read a draft even if a status reaches it from somewhere it should not; one object with live keystrokes stays the preview token and `fetchPreviewObject`. The docs also no longer claim a preview token is "optionally scoped to one object": the mint refuses a request without an `objectId` and the read refuses a token that names none, which is what bounds how far a leaked token reaches.

### Patch Changes

- bc7ffcb: The draft-mode preview route accepts the token name the admin actually sends, and its README no longer hands out code that throws.
  
  `createPreviewHandler` read the token from `?token=`. Nothing in the platform sends that name: the admin's Preview button builds its URL through `buildPreviewUrl`, which appends `preview_token`, and that is the name `docs/live-preview.md` states and the SDK preview path reads. A `frontend.previewUrl` pointed at this handler therefore answered `400 Missing token` on every click. `extractToken` now accepts either name, with `token` still winning, so a link a site builds for itself is unaffected.
  
  The README was wrong about both handlers and so could not be followed. It showed `createPreviewHandler({ apiUrl })`, which throws `secret is required` before a request is ever served, and `export const GET = disablePreview()`, which calls the handler at module scope with no request; `disablePreview` IS the handler and is exported with no call. The README now lists all three required options, says plainly that `secret` is a `tgn_` API key rather than a string you invent, documents `TangenSsrTimings`, and points at `docs/live-preview.md` for the SDK preview path that the platform documents and ships an example for.
  
  `disablePreview` had no test, which is why the error in the README went unnoticed. It has two now.
- Updated dependencies [a33a309]
  - @tangen/sdk@0.2.0

## 0.1.23

### Patch Changes

- Registry metadata: these packages pointed at the private development
  monorepo, so each one's page on npm linked to a repository nobody outside
  could open. They now name the public repository and carry the `homepage` and
  `bugs` fields npm renders.
  
  A patch rather than nothing, because a manifest only reaches the registry with
  a new version.
- Updated dependencies
  - @tangen/sdk@0.1.45
