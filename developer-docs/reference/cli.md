---
title: CLI
description: Every tangen command, its flags, and the rules that govern destructive operations and production.
audience: site-developer
type: reference
status: stable
package: "@tangen/cli"
lastVerified: 2026-09-16
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# CLI

`tangen` is a dev dependency of every Tangen project.

```bash
bun run tangen <command> [--workspace <id>]
```

Every command acts on **the deployment it runs on**: the database in
`DATABASE_URL`, under the role in `TANGEN_DEPLOYMENT_ROLE`. There is no flag
that selects an environment (`--env` and `--prod` are refused with the
reason); run the command with the right `.env`.

## Project

| command | does |
|---|---|
| `tangen create` | scaffold a new project. `--name`, `--with-demo`, `--with-hooks`, `--website`, `--ai` / `--no-ai`, `--skip-db-check` |
| `tangen dev` | run the API and the Admin together. Honours `PORT` and `ADMIN_PORT` |
| `tangen start` | run the API for production |
| `tangen build` | build the static Admin a deployment serves. `--out <dir>`, default `dist/admin`. One artifact for every host - the Admin resolves its API at runtime |
| `tangen bootstrap` | prepare a workspace from configuration |

## Schema

The loop you live in: edit `app/content-objects/`, check, push, get types.

| command | does |
|---|---|
| `tangen check` | validate the schema. Touches no database |
| `tangen diff` | what a push would change |
| `tangen push` | apply the schema, after printing the plan |
| `tangen pull` | write the database's schema back into code |
| `tangen add` | scaffold a content object, field or component |
| `tangen schema regenerate` | rewrite `content-tables.ts` from the registry. No DDL - recovery after a push that stopped after its apply |
| `tangen types` | regenerate types |

### `tangen push`

| flag | does |
|---|---|
| `--plan` | print the plan and stop. `--json` for machine-readable |
| `--dry-run` | run the whole preflight without applying |
| `--approve <token>` | approve one destructive operation. Repeatable |
| `--all-workspaces` | apply to every workspace in the project |
| `--typecheck` | type-check the schema first |

**The plan is always printed before anything is applied.** It names every
statement, in order, and what each would cost.

## Destructive operations

A destructive operation is one that can lose data. The policy has four rules,
and none of them is a prompt you can hold enter through.

**1. Every destructive operation needs its own token.** An approval for one
never authorises another.

```text
drop-type:<type>
drop-field:<type>.<field>
purge-component-field:<component>.<key>
purge-guarded:<name>
purge-extension:<id>@<env>
```

```bash
tangen push --approve drop-field:article.subtitle
```

Push tells you the exact tokens it wants. An unrecognised token is reported
rather than ignored.

**2. Production refuses destructive operations, whatever you approve.** There
is no `--force` that changes this. To remove something from production you
change it on development, rehearse on staging, and take the removal to
production as a reviewed migration.

**3. A drop is guarded, not a deletion.** Dropping a column or a table renames
it aside; the data is recoverable until an explicitly approved purge. The plan
marks these `[guarded: recoverable until purged]`.

**4. Ambiguous operations never apply.** An operation the planner cannot
classify is refused, not guessed at. Safe operations in the same plan still
apply.

`tangen purge guarded` is the separate, approved removal of a guarded table.
`tangen purge extension <id> --approve purge-extension:<id>`
removes an extension's data from this deployment, and **refuses on
production**.

## Operations

| command | does |
|---|---|
| `tangen doctor` | drift, orphans, unapplied history, and what an uninstall retained |
| `tangen doctor --deployment` | the deployment as boot sees it: binding and sharing, live database identity, every key with provenance (references, never values), extension activation, integrations, findings; exit 1 on an error |
| `tangen extension bundle [<dir>] [--minify] [--json]` | Builds the extension's client module (`client`, else `src/index.tsx`) into the runtime Admin bundle its manifest `ui` names (default `dist/admin.js`): one ES module, with React, react-dom, react-router-dom, `@tangen/ui` and `@tangen/icons` read from the Admin's shared runtime rather than bundled. Exit 0 done, 2 could not. |
| `tangen connections rotate-key [--json]` | Re-seals every connection in this deployment's database under the current connections key (`TANGEN_CONNECTIONS_KEY` or `connections.encryptionKey`, else the session secret), opening each with the previous key from `TANGEN_CONNECTIONS_KEY_PREVIOUS` (never from the command line). Rows neither key opens are named and left alone; `tangen doctor --deployment` reports them as `CONNECTION_UNREADABLE`. Exit 0 done, 1 rows remain unreadable, 2 could not run. |
| `tangen migrate layout` | move a v1 `app/` layout to the v2 structure. Idempotent |
| `tangen reconcile` | reconcile extension installation state |
| `tangen release` | **read-only**: `list` and `status`. Creating, approving and applying a release happens in the Admin or over the API |
| `tangen purge` | approved deletion of extension data or guarded tables |
| `tangen workspace create` / `remove` | add or remove a workspace in a multi-workspace project |
| `tangen object` | manage content **types**: `enable`, `disable`, `delete` |
| `tangen db reconcile` | alias of `tangen reconcile` |
| `tangen reset-password` | reset a member's password |

## Extensions and capabilities

| command | does |
|---|---|
| `tangen extension` | `create`, `install`, `enable`, `disable`, `upgrade`, `uninstall`, `list`, `status`, `inspect` |
| `tangen extension install <id> [--yes] [--approve-optional <grant,...\|none>] [--approve-grants <grant,...>]` | reviews the grants the extension asks for before anything is written: each grant by tier with the publisher's reason and what it allows, optional grants with the feature they enable, and what the extension cannot do; in a terminal you are asked, in CI `--yes` approves and `--approve-optional` narrows the optional ones. The approval is recorded on the installation and is what the extension runs with. `--approve-grants` is the CI form: the approved set is exactly the list. A committed `tangen.policy.ts` (`export default { grants: { allow?: [...], deny?: [...] } }`, patterns such as `network:*.example.com`; deny wins) is honoured, and a successful install records `{ version, integrity, grantedGrants }` in `tangen.lock` so a new grant shows in a pull request |
| `tangen extension upgrade <id> [--yes]` | re-reviews against what was approved: a new required grant refuses the upgrade until approved, a grant the new version no longer asks for is revoked |
| `tangen extension inspect <id>` | the manifest overview and the grant review against what this workspace approved (`granted` / `denied` per grant) |
| `tangen enable` / `tangen disable` | switch a capability on or off in the project config |

Declaring an extension in `app/config/extensions.ts` makes it **available**.
Installing and enabling it are separate, per-deployment acts, and an
operator's choice is not overwritten by re-declaring it in code.

## AI and agents

| command | does |
|---|---|
| `tangen ai init` | write the agent guardrails and the Tangen Agent Skill into an existing project. `--force`, `--tools claude,codex,gemini,cursor,windsurf`. `tangen create` already does this |
| `tangen ai status` | which Content AI provider keys this process can see |
| `tangen skills update` | refresh this project's `tangen-*` skills from the installed CLI. Leaves your own skills alone |
| `tangen mcp` | the MCP stdio bridge. Reads `TANGEN_API_URL` and `TANGEN_API_KEY` |
| `tangen mcp expose` | read-only report of what an agent can see over MCP. `--json` |
| `tangen knowledge index` | build or refresh the knowledge index. `--rebuild`, `--yes` |
| `tangen knowledge status` | what the index holds, and which prerequisite is missing. See [Knowledge](/reference/knowledge) |

## Machine-readable output

`--json` is supported where a plan or a list is the output - notably
`tangen push --plan --json`. Exit codes are non-zero on refusal, so a CI step
that ignores stdout still fails correctly.

`--yes` skips interactive confirmation where a command has one. It does **not**
approve a destructive operation; only `--approve <token>` does.

## Related

- [Fields](/reference/fields) - what `tangen push` applies ·
  [Deployments](/reference/deployments) ·
  [Configuration](/reference/configuration) ·
  [Extension lifecycle](/reference/extension-lifecycle)
