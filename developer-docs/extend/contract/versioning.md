---
title: Versioning and compatibility
description: Versioning an extension, upgrading it, and staying compatible with Tangen.
audience: extension-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: source
verifiedBy: packages/api/src/hooks/app-hooks-registry.ts
---

# Versioning and compatibility

## Your version

`version` in the manifest is yours. Bump it when you ship: it is what makes
UPGRADE run your new migrations.

Semver is the sensible convention, and what a **breaking** change means for an
extension is concrete:

| change | version |
|---|---|
| a new optional config key, a new page, a new route | minor |
| a migration that adds a column with a default | minor |
| a config key becoming required | **major** - installs will start failing |
| a route or page path changing | **major** - callers and bookmarks break |
| a declared capability id changing | **major** - operators' role assignments break |
| removing a content type or column | **major**, and it needs a purge story |

## Depending on another extension

```ts
requires: { extensions: [{ id: 'acme.core', version: '^1' }] }
```

Ranges accepted: `1.2.3`, `^1.2`, `~1.2.3`, `>=1.2.0`, `>=1.0.0 <2.0.0`, `*`.
A bare `'acme.core'` means any version.

If the installed version does not satisfy your range, your extension is
`unavailable` here with a reason naming the dependency. That is the correct
outcome - it never half-runs.

## Depending on Tangen

`@tangen/cms` is a **peer dependency**:

```jsonc
{ "peerDependencies": { "@tangen/cms": "^0.1" } }
```

The host project supplies it. Two copies would mean two registries and two sets
of types.

Pin a range, not `latest`. And read
[Public contract](/reference/public-contract): a surface marked **experimental**
can change in a minor, so an extension that leans on one should say so in its
own README.

## Migrations and versions

A migration that has run is **immutable**. Its id is in the ledger with a
checksum, and editing it is a corruption, not an update.

To change something a past migration created, write a new migration. To fix one
that has not shipped anywhere, you may edit it - but "not shipped anywhere"
includes nobody's development environment.

## When Tangen changes

The lifecycle stages, the manifest shape and the contribution types are v1
contracts. When they change, it is a major Tangen version with a deprecation
path.

Your extension should:

- **use `?.` on optional context seams.** `ctx.deploymentRole?.()`,
  `ctx.hasExtension?.()` and their kind are absent on runtimes that do not wire
  them, and an absent seam is a supported state rather than an error.
- **not depend on undocumented behaviour.** If it is not in the reference, it is
  not a contract.

## Related

- [Migrations](/extend/data/migrations) ·
  [Packaging and distribution](/extend/shipping/distribution) ·
  [Public contract](/reference/public-contract)
