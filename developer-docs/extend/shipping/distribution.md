---
title: Packaging and distribution
description: "Packaging and publishing an extension to npm: the package.json shape, the exports every published extension needs, and how a project installs it."
audience: extension-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g7/publish
---

# Packaging and distribution

## Supported today

**A path inside the project.**

```ts app/config/extensions.ts
export default defineExtensions([
  { resolve: '../../extensions/my-extension' },
])
```

The normal shape while developing, and a perfectly good shape in production for
an extension that belongs to one project.

**A package the project installs.**

```jsonc
{ "dependencies": { "@acme/tangen-reviews": "^1.0.0" } }
```

```ts
export default defineExtensions([
  { resolve: '@acme/tangen-reviews', options: { moderation: true } },
])
```

Your own registry, a private registry, a git dependency, or a tarball. Anything
that lands the package in `node_modules` works, because `resolve` is resolved
the way any import is.

## Two things the scaffold writes that a published package must not keep

`tangen extension create` writes a package for **developing inside a project**,
and two of its choices are deliberately wrong for publishing:

```jsonc
{
  "name": "@tangen/ext-reviews",   // the first-party scope. Not yours to publish under
  "private": true                  // refuses to publish, on purpose
}
```

Change both before you publish. `@tangen/` is Tangen's own npm scope and no
third party can publish into it; use your own, as in `@acme/tangen-reviews`
below. `private: true` is what stops an accidental `npm publish` while you are
still developing, and removing it is the deliberate act of deciding to ship.

Nothing else in the scaffold needs changing, and `resolve` does not care what
the package is called - it resolves the name the way any import does.

**Package shape:**

```jsonc
{
  "name": "@acme/tangen-reviews",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./server": "./src/server.ts",
    "./tangen.extension": "./tangen.extension.ts"
  },
  "files": ["src", "tangen.extension.ts", "README.md"],
  "peerDependencies": { "@tangen/cms": "^0.1" }
}
```

**`"./tangen.extension"` is not optional.** A bare `resolve` specifier is loaded
as `<package>/tangen.extension`, so an `exports` map without that subpath blocks
the one import that matters. The failure is quiet from the outside: the package
installs, `tangen extension list` reports it **installed, enabled**, and it
contributes nothing. The reason is in the server log:

```text
[workspace-loader] failed to load extension '@acme/tangen-reviews':
  Cannot find module '@acme/tangen-reviews/tangen.extension'
```

If your extension contributes nothing and the CLI says it is enabled, read that
log before anything else.

Ship the manifest, both entries and the migrations. `@tangen/cms` is a **peer**
dependency - the host supplies it, and two copies mean two registries.

**Publish it like any npm package.** `npm publish` is enough: an extension is an
ordinary package with no workspace ranges to rewrite, so the Bun publishing
constraints that apply to Tangen's own monorepo do not apply to yours.

## Not yet a proven v1 flow

None of these exists, and none should be planned around:

- **A public Tangen extension registry or marketplace.**
- **One-click install from the Admin.**
- **Discovery** - there is no index of published Tangen extensions.
- **A published catalogue of first-party extensions** (below).

## First-party extensions

Some of Tangen's own extensions - **SEO**, **Flows**, **Review** and
**Variants** - are `private: true` and are **published nowhere**. A scaffolded
project starts with no extension directories, so an external project has **no
supported way to install them**.

There is no `npm install` line for them, and this documentation will not invent
one. Their distribution is an open product decision.

Two consequences for you:

1. **Do not use them as evidence that something is supported.** If a capability
   is only demonstrated by a private first-party extension, it is not
   necessarily part of the public contract.
2. **Do not copy their internals.** Some use platform surfaces that are not in
   [Public contract](/reference/public-contract), and copying those makes your
   extension depend on something that can change without notice.

Build against this documentation. If a task seems to need something not
documented here, that is worth reporting rather than working around.

## Versioning

See [Versioning and compatibility](/extend/contract/versioning). The short
version: bump `version` when you ship, because that is what makes UPGRADE run
your new migrations; never edit a migration that has run.

## Related

- [Extension structure](/extend/introduction/structure) ·
  [Versioning and compatibility](/extend/contract/versioning) ·
  [Public contract](/reference/public-contract)
