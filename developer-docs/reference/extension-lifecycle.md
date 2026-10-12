---
title: Extension lifecycle
description: The eleven stages an extension moves through, what each may do, and what disable, uninstall and purge mean.
audience: extension-developer
type: reference
status: stable
lastVerified: 2026-09-01
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Extension lifecycle

```text
REGISTER → INSTALL → ENABLE → MOUNT → START → STOP → DISABLE → UPGRADE → UNINSTALL → PURGE → DISPOSE
```

Eleven stages. They mean different things, and a stage that "sort of" happened
is the source of most extension bugs.

| stage | scope | what happens | what may **not** happen |
|---|---|---|---|
| **REGISTER** | process | the manifest is read and recorded: id, version, dependencies, contributions | **nothing runs.** No worker, no timer, no connection, no query, no migration |
| **INSTALL** | workspace, per deployment | the extension is added to this deployment's database. **Migrations run**, in order, each in a transaction, recorded with a checksum. `onInstall` runs | - |
| **ENABLE** | workspace, per deployment | an operator switches it on here | migrations do not run again |
| **MOUNT** | process | its routes and Admin contributions are attached | - |
| **START** | process | its workers, subscribers and timers begin - **only** if it is available and required | - |
| **STOP** | process | no new background work; loops end | - |
| **DISABLE** | workspace, per deployment | an operator switches it off here. It contributes **nothing**: no routes, no hooks, no panels, no jobs | its data is not touched |
| **UPGRADE** | workspace, per deployment | a newer version is applied. **New migrations run** | - |
| **UNINSTALL** | workspace, per deployment | it is removed from this deployment | **its data is not dropped** |
| **PURGE** | workspace, per deployment | the separate, approved deletion of that deployment's data | - |
| **DISPOSE** | process | every handle it holds is released | - |

Every stage is per **workspace**, in the deployment's database, except REGISTER and DISPOSE,
which are per process.

## Nothing starts at import

This is the rule the platform enforces most strictly. Importing an extension's
module, registering it, installing it, or running `onInstall` must not create a
network client, a timer, a worker, a subscriber or a connection.

Background work belongs in START, which only runs when the extension is
actually available and wanted here.

## Availability

An extension is `on`, `off` or `unavailable`, like any capability:

| state | means |
|---|---|
| `on` | installed here, enabled here, its code is loaded, and everything it requires is available |
| `off` | not installed here, or installed and switched off. **An operator's choice** |
| `unavailable` | it cannot run here: a required capability is missing, a dependency is not active, its migrations are pending, or this process has not loaded its code |

**Enabled in the database with the code not loaded in this process is
`unavailable`, never `on`.** Restarting the server picks it up.

An operator's disable or uninstall is **state**, and re-declaring the extension
in code does not overwrite it. Declaring makes it available; installing and
enabling are separate, deliberate acts.

## Uninstall does not delete data

`extension_data`, the extension's own tables' rows, its migration ledger and
its content types all survive an uninstall, and a reinstall adopts them.

**PURGE** is the separate deletion, and it is guarded:

```bash
tangen purge extension acme.reviews \
  --approve purge-extension:acme.reviews
```

It **refuses in production**. An owned table is not dropped but kept aside as a
guarded table once no installation remains anywhere, and only
`tangen purge guarded` drops it.

`tangen doctor` reports what an uninstall retained.

## Published and draft extension data

When an extension stores per-object data keyed by a content object's id, the
platform maintains a **published snapshot** beside the draft: publishing the
object copies the data into it, and unpublishing clears it. A Delivery read of
the object serves the published snapshot, never the draft.

## Related

- [Extension manifest](/reference/extension-manifest) ·
  [Permissions](/reference/permissions) · [CLI](/reference/cli) ·
  [Deployments](/reference/deployments)
