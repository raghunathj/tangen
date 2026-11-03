# @tangen/db

## 0.1.57

### Patch Changes

- A type's declared address crosses the push boundary, and the site's own code
  can read it.
  
  The grammar and the composer shipped last release; what shipped with them
  could not leave the process that declared them. A `path` written as a pattern
  is now a column on the type, so the Admin, the GUI builder and the generated
  types all read the same declaration, and `tangen push` plans it like any other
  structural change.
  
  - `path` is pushed and diffed, so changing an address is a plan line rather
    than a restart
  - the settings sheet edits it, with the same grammar validation the file gets
  - `tangen types` emits it, so a site composes its own URLs from the same
    declaration the server reads
  - a function form stays in code: it is marked in the stored value
    (`PATH_FN_MARKER`) rather than serialised, because a function cannot be, and
    the marker is what stops a push from writing a lie into the column
  
  New in `@tangen/types`: `isPathFnMarker`, `storedPathOf`, `PATH_FN_MARKER`,
  and the `ContentPathFnMarker` / `StoredContentPath` types.
- The last open dependency advisory is cleared, with a gate over the behaviour
  the bump could have changed.
  
  `bun audit` reads the lockfile rather than `node_modules`, so an advisory can
  name a package that was never installed. This one was installed; the test that
  pins the query behaviour around it is what makes the bump safe to repeat.
- The TypeScript we publish is gated, and what the gate found is fixed.
  
  `typecheck:shipped` compiles the published surface the way a consumer's
  compiler sees it, rather than the way the monorepo does. It found real
  breakage in declarations that only ever ran in-repo, and it now runs with the
  release guards, so a type that would not compile for an installer cannot ship.
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.5.0

## 0.1.56

### Patch Changes

- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [120fff5]
  - @tangen/types@0.4.0

## 0.1.55

### Patch Changes

- Updated dependencies [a33a309]
- Updated dependencies [809bb12]
  - @tangen/types@0.3.0

## 0.1.54

### Patch Changes

- Registry metadata: these packages pointed at the private development
  monorepo, so each one's page on npm linked to a repository nobody outside
  could open. They now name the public repository and carry the `homepage` and
  `bugs` fields npm renders.
  
  A patch rather than nothing, because a manifest only reaches the registry with
  a new version.
- Updated dependencies
  - @tangen/types@0.2.0
