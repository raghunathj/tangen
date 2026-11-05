/**
 * File Name: usage.ts
 * Purpose: The `tangen` usage text, as data. It was a template literal inside
 *          the dispatcher's final else branch, which meant the only way to
 *          print it was to fall all the way through every command - so
 *          `tangen push --help` could not print help, and instead ran a push.
 *          Lifted here unchanged so the flag guard can print it before any
 *          command runs.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure data. The command list here and the flag table in
 *          known-flags.ts describe the same surface; a test asserts every
 *          command the guard knows is mentioned in this text, so a new command
 *          cannot be added to one and forgotten in the other.
 */

export const USAGE = `tangen - schema-as-code CLI

Commands:
  create [<folder>] [--name <ws>] [--db <url>]                             Scaffold a new Tangen project ("." = current dir; --name skips prompts)
  workspace create                                                         Add a new workspace to an existing project
  workspace remove <slug>                                                  Remove a workspace from the project
  check                                                                    Type-check schema files
  diff              [--project <name>]                     Show pending schema changes
  dev               Run the API server + admin panel for this project
                    [--typecheck: also run tsc --noEmit --watch, warnings only]
  start             Run the API server only (production)
  build             [--out <dir>]                                           Build the static Admin for a deployment (default: dist/admin)
  reconcile         Sync the migration ledger with already-applied migrations
                    [--apply to record;] - fixes "applied but not recorded" drift
  push              [--project <name>] [--approve <token>]         Apply schema changes (runs check first)
  push              --workspace <slug>                     Register a workspace from the registry in the DB
  pull              [--project <name>] [--layout v1]       Regenerate app/content-objects/<type>/schema.ts from the DB (--layout v1: the old content/ tree)
  purge component <component>.<field> [--plan] [--approve <token>]  PERMANENT - delete a HISTORICAL component sub-field's stored values + their translations
  purge extension <id> [--plan] [--approve purge-extension:<id>]  PERMANENT - delete what an UNINSTALL retained; owned tables become guarded drops once no installation remains
  connections rotate-key [--json]                        Re-seal every connection under the current connections key (previous key from TANGEN_CONNECTIONS_KEY_PREVIOUS)
  doctor            [--json]                                Read-only drift report: code vs registry vs content-tables.ts vs database (exit 0 clean / 1 drift / 2 unreachable)
  schema regenerate [--force] [--json]                      Rewrite content-tables.ts from the registry (no DDL) - recovery after a push that stopped after its apply
  types             [--out <path>] [--project <name>]                     Generate tangen-types.d.ts for typed SDK usage
  add object <name> [--label <label>] [--project <name>]                  Scaffold a new content type
  object disable|enable <name>                            Soft delete toggle - content APIs 404 while disabled; data stays
  object delete <name>           [--yes]                  PERMANENT - removes code + drops the table on a confirmed push
  reset-password <email>  [--password <pw>]                 Set a new password for an existing admin member (recovery)
  enable <feature>                                          Enable a built-in feature (auth, graphql, ai, localization)
  disable <feature>                                         Disable a built-in feature
  extension install <extensionId>  [--yes] [--approve-optional <grant,...|none>]... [--approve-grants <grant,...>]...   Install an extension: reviews the grants it asks for (tiers, reasons, what it cannot do), honours tangen.policy.ts, records the approval in the workspace and tangen.lock
  extension inspect <extensionId>  [--workspace <slug>]      The manifest overview, what it provides and requires, and its grants against what this workspace approved
  extension uninstall|remove <extensionId>                 Remove an installed extension (role grants kept, shown inactive)
  release list                     [--status <s>] [--json]   Releases of the workspace: status, path by role, approval, schedule (read-only; approve/apply in the Admin or API)
  release status <id>              [--json]                  One release: items in apply order with outcomes, approval checksum, failure, history
  extension bundle [<dir>]     [--minify] [--json]       Build the extension's client module into the runtime Admin bundle its manifest ui field names (shared React/router/kit read from the Admin)
  extension list                                           List configured extensions and their install state in this workspace
  extension enable <extensionId>                             ENABLE (contributions resume; no reinstall)
  extension disable <extensionId>                            DISABLE (data and installation kept; refused while a dependant needs it)
  extension upgrade <extensionId>  [--plan] [--yes]          UPGRADE to the registered version: re-reviews new grants, pending migrations, onUpgrade, then the version
  extension status                 [--json]                  Why each extension is or is not active here (dependencies, schema, options)
  migrate layout                   [--dry-run]                             Move a v1 app/ layout to the v2 structure (idempotent)
  extension create [<id>]          [--name <n>] [--description <d>]       Scaffold a new Tangen extension (interactive)
                                   [--author <a>] [--website <url>]
  skills update                                                            Refresh this project's AI skills from the installed CLI's shipped versions
  bootstrap                       [--name <ws>]            First run: system tables, then workspace + content tables
  knowledge index                  [--rebuild] [--yes]      Build or refresh the knowledge (RAG) index for this workspace
  knowledge status                                          What the knowledge index holds, and what is stale
  mcp                                                       Serve this workspace over MCP on stdio (for a coding agent)
  mcp expose                       [--json]                 Read-only report of what an agent can see over MCP
  ai init                          [--force] [--tools <a,b>]               Write agent guardrail files for this project
  ai status                                                                Which Content AI provider keys this process can see
  db reconcile                     [--apply]                Alias of \`reconcile\`

Options:
  --project <name>  Workspace project to operate on (auto-detected from cwd)
  --workspace <slug> One workspace from app/workspaces/index.ts: extension commands act on it; push registers it;
                     types generates that workspace's globals, roles and locales
  --label <label>   Human-readable label for the new type (default: title-cased name)

Features:
  auth              Site Auth - end-user authentication (password, OTP, SSO, anonymous)
  forms             Forms is an extension: tangen extension install forms
`
