# @tangen/ext-forms

## 0.2.10

### Patch Changes

- c60a390: **The Share sheet says when a form is a draft.** The links it hands out
  answer 404 for an unpublished form, and the sheet went on presenting them as
  if they worked: an operator could copy one and mail it out. The embed payload
  now carries `isLive`, and a draft gets the same warning an API-key-only form
  gets, above the links rather than instead of them, since a snippet is worth
  pasting into a page before the form goes live.

## 0.2.9

### Patch Changes

- 09ba9e5: Two fixes to the public embed.
  
  **An unpublished form is no longer readable at all.** The embed page decided
  availability from `settings.schedule` alone, so it rendered every field of a
  form nobody had published, and ignored the entry limit too. Now a form that
  is not live answers every public read - styled embed, unstyled embed, schema
  route and its keyed twin - with the same 404 a slug nobody owns gets: a draft
  is not a closed form, it is not something a visitor is entitled to know
  exists. A published form outside its schedule or at its entry limit answers
  one shared `availability` and returns its message with no fields, since
  listing every question while refusing is a refusal in name only.
  
  **The captcha widget is drawn again for Turnstile and hCaptcha.** The runtime
  waited for `ready(cb)` before rendering. `grecaptcha.ready` calls back;
  `turnstile.ready` does not - it is for code running before api.js and warns
  when called after - so the widget was never rendered, the submit asked
  `getResponse` about a widget that did not exist, and the console read
  "[Cloudflare Turnstile] Could not find widget" while the visitor saw an empty
  space. The wait is now per provider and raced with a timeout, and a widget
  that never drew is never asked about.

## 0.2.8

### Patch Changes

- 1832574: A `consent` field: a tickbox whose wording is authored copy with links in it,
  so a form can ask someone to agree to a privacy policy they can actually open.
  Its copy is narrowed to links and inline formatting wherever it is rendered -
  the embed, the builder preview and the schema route a headless site reads - and
  a link may only address this site, a fragment, `https`, `http`, `mailto` or
  `tel`. It is never pre-ticked, a saved draft does not restore a tick, and
  `required` means ticked: a submission posting `false` or `"no"` is refused
  rather than recorded as agreement.

## 0.2.7

### Patch Changes

- 94f3d8d: Forms can hold its own settings again, and a manifest cannot make that mistake twice.
  
  `@tangen/ext-forms` declares four captcha settings and a sender override, and core keeps a typed settings block in the extension's OWN store. The manifest never asked for `store:own`, so the kernel's gate deleted `ctx.store`, the Form Settings page answered `undefined is not an object (evaluating 'deps.store.get')`, and a captcha could not be configured at all: nothing else reads those values.
  
  Three changes, smallest first. The grant is added to the Forms manifest. `validateExtensionManifest` now refuses any manifest that declares settings fields without `store:own`, naming the grant, the same shape as the existing checks for admin slots and rich text nodes. And `createExtensionSettings` refuses with `EXTENSION_SETTINGS_UNAVAILABLE`, naming the extension and the grant, instead of reading a property off nothing - for an installation made before the validator existed.
  
  **The captcha was only half built, and the half that shipped refused every submission.** The server verified `_captchaToken` and the schema route published the site key, but the embed runtime never loaded a provider script, never drew a widget and never sent a token - so turning a captcha on made every submission through the official embed fail with "Captcha token required". The runtime now renders reCAPTCHA v2, reCAPTCHA v3 (invisible, executed at submit), hCaptcha and Turnstile from the site key in its payload, sends the token, and resets the widget after any refusal because a token is single use. The embed page carries the public half of the setting, which it did not before.
  
  **Keyed submits are exempt from the captcha.** A captcha asks whether a person is present and an API key has answered something stronger, so `keyed/:id/submit` no longer requires a token - otherwise enabling a captcha broke every server-to-server integration in the workspace, which have no browser to solve one. A keyed caller that sends a token anyway still has it verified.
  
  `docs/forms.md` now says how a headless client does the same: the provider scripts, where the token comes from, and the single-use reset.
  
  The npm package takes a patch, because `@tangen/ext-forms` sits on the platform's `major.minor` line with cms, api, admin and cli and a lone minor would break it. The EXTENSION manifest version is its own number and goes 0.3.0 to 0.4.0, which is what makes `tangen extension upgrade forms` re-run the permission review - an installation made before this release holds the old grant set and needs that upgrade to pick up `store:own`.
- Updated dependencies [94f3d8d]
- Updated dependencies [0e97fb4]
  - @tangen/types@0.6.1

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
