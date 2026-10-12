---
title: Extension CLI
description: The commands that manage an extension's lifecycle.
audience: extension-developer
type: guide
status: stable
package: "@tangen/cli"
lastVerified: 2026-09-16
verification: executable
verifiedBy: stage-g7/lifecycle
---

# Extension CLI

Every command acts on **the deployment it runs on** - the database in
`DATABASE_URL`, under the role in `TANGEN_DEPLOYMENT_ROLE`. Run it with the
`.env` of the deployment you mean; there is no `--env`.

## Inventory

```bash
bun run tangen extension list
bun run tangen extension status
```

`list` shows what is declared, installed, enabled and active. `status` is the
detail for one.

`tangen doctor` reports drift, pending migrations, and what an
uninstall retained.

## Lifecycle

If your manifest declares `grants`, `tangen extension install` reviews them
before anything is written and records the approval; `tangen extension
upgrade` re-reviews what a new version adds. A project may commit a
`tangen.policy.ts` that refuses grant patterns outright, and every install
is pinned in `tangen.lock` with the reviewed manifest's integrity - write
your reasons for the people who will read that review.


```bash
bun run tangen extension install   <id>
bun run tangen extension enable    <id>
bun run tangen extension disable   <id>
bun run tangen extension upgrade   <id>
bun run tangen extension uninstall <id>
```

| command | does | data |
|---|---|---|
| `install` | adds it here; **runs migrations**; runs `onInstall` | - |
| `enable` | switches it on here | - |
| `disable` | switches it off; it contributes nothing | untouched |
| `upgrade` | applies **new** migrations | - |
| `uninstall` | removes it here; runs `onUninstall` | **retained** |

## Creating and configuring

```bash
bun run tangen extension create
bun run tangen extension status <id>
```

## Purge

The separate, approved deletion of the extension's data on this deployment:

```bash
bun run tangen purge extension acme.reviews \
  --approve purge-extension:acme.reviews
```

- The approval token **names the extension**. An approval for one never
  authorises another.
- **It refuses on a production deployment**, whatever you approve.
- An owned table is kept aside as a **guarded table** once no installation
  remains anywhere; only `tangen purge guarded` drops it.

Do not document, script or suggest a way around this. There is not one.

## Which deployment

The one whose `.env` the command runs with. A CI job installs into the
database its `DATABASE_URL` names and nowhere else; a production role refuses
the destructive commands whatever is approved.

## Related

- [CLI reference](/reference/cli) · [Local development](/extend/shipping/local-development)
  · [The lifecycle in practice](/extend/contract/lifecycle)
