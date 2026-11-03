# @tangen/cms

## 0.2.5

### Patch Changes

- 0bfbcd0: `tangen create` finishes the job: it creates the database tables itself when the
  connection string it validated means `.env` is complete, so a new project is two
  commands (`create`, then `npm run dev`) and the setup wizard is reachable without
  a separate `tangen bootstrap`. When it cannot - no database given, or the install
  failed - it prints the manual step exactly as before.
  
  `tangen push` now writes the same `tangen-types.d.ts` that `tangen types` writes.
  Push read the thin root `tangen.config.ts` for globals, locales, roles,
  extensions and components, but those live on the WORKSPACE config and the root is
  never consulted for them, so a `component` field came out `unknown` after a push
  and typed correctly only after a separate `tangen types`. Push now resolves them
  through `resolveCodegenConfigs`, the same helper `tangen types` uses.
  
  `@tangen/cms` README: the start-a-project flow leads with the single package that
  carries the `tangen` bin, and no longer lists the bootstrap step.
- Updated dependencies [0bfbcd0]
  - @tangen/cli@0.2.5

## 0.2.4

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.5.0
  - @tangen/cli@0.2.4
  - @tangen/schema@0.2.1
  - @tangen/ext-flows@0.2.5
  - @tangen/ext-forms@0.2.5
  - @tangen/helpers@0.1.24
  - @tangen/ext-seo@0.2.5

## 0.2.3

### Patch Changes

- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [120fff5]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
  - @tangen/types@0.4.0
  - @tangen/schema@0.2.0
  - @tangen/cli@0.2.3
  - @tangen/ext-seo@0.2.4
  - @tangen/ext-notes@0.2.4
  - @tangen/ext-flows@0.2.4
  - @tangen/ext-forms@0.2.4
  - @tangen/helpers@0.1.23

## 0.2.2

### Patch Changes

- Updated dependencies [fb4bd7a]
- Updated dependencies [a33a309]
- Updated dependencies [809bb12]
- Updated dependencies [fa228ea]
  - @tangen/schema@0.1.44
  - @tangen/types@0.3.0
  - @tangen/cli@0.2.2
  - @tangen/helpers@0.1.22
  - @tangen/ext-seo@0.2.2
  - @tangen/ext-auth@0.2.2
  - @tangen/ext-flows@0.2.2
  - @tangen/ext-forms@0.2.2
  - @tangen/ext-notes@0.2.2

## 0.2.1

### Patch Changes

- The npm page for `@tangen/cms` is where someone lands first, and it was a
  reference snippet rather than a starting point. It now says what Tangen is,
  what this package is (the single import for site developers, a facade over
  types/schema/helpers - not the server, not the editor, not the read client),
  what you need (Bun and Postgres, no file-backed mode), and the actual route
  from `bunx @tangen/cli create` to a typed query.
  
  A README only reaches the registry with a new version, which is why a
  documentation change is a release.
- @tangen/ext-auth@0.2.1
  - @tangen/ext-flows@0.2.1
  - @tangen/ext-forms@0.2.1
  - @tangen/ext-notes@0.2.1
  - @tangen/ext-seo@0.2.1
  - @tangen/cli@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangen/types@0.2.0
  - @tangen/helpers@0.1.21
  - @tangen/schema@0.1.43
  - @tangen/cli@0.2.0
  - @tangen/ext-auth@0.2.0
  - @tangen/ext-flows@0.2.0
  - @tangen/ext-forms@0.2.0
  - @tangen/ext-notes@0.2.0
  - @tangen/ext-seo@0.2.0
