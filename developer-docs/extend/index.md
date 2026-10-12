---
title: Extend Tangen
description: "Writing and publishing your own Tangen extension: the manifest, the lifecycle, server and Admin contributions, extension-owned data, testing and distribution."
audience: extension-developer
type: concept
status: stable
lastVerified: 2026-09-02
verification: source
verifiedBy: packages/types/src/extension.ts
---

# Extend Tangen

An extension is a package that declares what it contributes and moves through a
lifecycle the platform owns. Nothing runs at import, and no extension creates a
table at runtime.

## Start here

- [What is an extension?](/extend/introduction/what-is-an-extension) - and when
  not to build one
- [Your first extension](/extend/introduction/first-extension) - the smallest
  one that works
- [Extension structure](/extend/introduction/structure) - the files, and which
  are optional

## The contract

- [Writing a manifest](/extend/contract/manifest) - authoring one that installs
- [The lifecycle in practice](/extend/contract/lifecycle) - what to do at each
  of the eleven stages
- [Capabilities and dependencies](/extend/contract/capabilities) - designing for
  `on`, `off` and `unavailable`
- [Versioning and compatibility](/extend/contract/versioning)

## Configuration and data

- [Configuration](/extend/data/configuration) - declaring options an operator sets
- [Secrets](/extend/data/secrets) - credentials, and how not to leak them
- [Migrations](/extend/data/migrations) - owning tables safely
- [Extension data](/extend/data/extension-data) - the store, and publication-aware
  per-object data

## Contributions

- [Server contributions](/extend/contributions/server) - every supported
  server-side surface
- [Server routes](/extend/contributions/routes) - HTTP endpoints, and who may
  call them
- [Admin contributions](/extend/contributions/admin) - pages, panels, navigation
- [Custom field types](/extend/contributions/fields)
- [Permissions and security](/extend/contributions/permissions)

## Ship it

- [Local development](/extend/shipping/local-development) - the CLI loop
- [Testing an extension](/extend/shipping/testing)
- [Packaging and distribution](/extend/shipping/distribution) - what is
  supported today, and what is not

Exact shapes are in [Extension manifest](/reference/extension-manifest) and
[Extension lifecycle](/reference/extension-lifecycle).
