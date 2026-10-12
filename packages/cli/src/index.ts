#!/usr/bin/env bun
/**
 * File Name: index.ts
 * Purpose: Entry point for the @tangen/cli package — exports `defineConfig` for use in
 * tangen.config.ts and contains the Bun main-module CLI dispatcher for all tangen commands.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The CLI dispatcher uses top-level await (requires Bun as runtime).
 * Commands are lazily imported to keep startup time fast. Uses resolveProject for workspace detection.
 */
import type { TangenConfig } from '@tangen/types'
import { deploymentRole } from './deployment-database'
import { parseGrantDecisionFlags } from './commands/grant-flags'
import { c, sym } from './ui'
import { flagValueOrExit } from './flags'
import { dispatcherPrintsHeader, pullLayout } from './dispatch-rules'

// Public API — used in tangen.config.ts as `import { defineConfig } from '@tangen/cli'`
export function defineConfig(config: TangenConfig): TangenConfig {
  return config
}

// CLI entry point — only runs when this file is the Bun main module
if (Bun.main === import.meta.path) {
  const args = process.argv.slice(2)
  const command = args[0]

  // `tangen create` scaffolds a new project — runs before resolveProject
  if (command === 'create') {
    const { promptForWorkspaceDetails, runCreateCommand, deriveSlug, deriveWorkspaceId, checkPostgres } = await import('./commands/create')
    try {
      // tangen create [<folder>] [--name <workspace>] [--db <postgres-url>] [--ai|--no-ai]
      // "." scaffolds into the current directory; --name skips all prompts (CI).
      // --ai/--no-ai skip the AI Companion Mode prompt (undefined ⇒ prompt).
      const folderArg = args[1] && !args[1].startsWith('-') ? args[1] : undefined
      const nameIdx = args.indexOf('--name')
      const dbIdx = args.indexOf('--db')
      const aiFlag = args.includes('--no-ai') ? false : args.includes('--ai') ? true : undefined
      let opts
      if (nameIdx !== -1 && args[nameIdx + 1]) {
        const workspaceName = args[nameIdx + 1]
        const workspaceSlug = deriveSlug(workspaceName)
        const databaseUrl = dbIdx !== -1 ? args[dbIdx + 1] : undefined
        if (databaseUrl && !(await checkPostgres(databaseUrl))) {
          console.error('tangen: could not connect to --db - check the connection string')
          process.exit(1)
        }
        // Non-interactive: Companion Mode on by default, --no-ai to opt out.
        opts = { workspaceName, workspaceSlug, workspaceId: deriveWorkspaceId(workspaceSlug), projectFolder: folderArg ?? workspaceSlug, databaseUrl, ai: aiFlag ?? true }
      } else {
        opts = await promptForWorkspaceDetails(folderArg, aiFlag)
      }
      await runCreateCommand(opts, process.cwd())
    } catch (err: any) {
      console.error(`\n  tangen: ${err.message}`)
      process.exit(1)
    }
    process.exit(0)
  }

  // One deployment holds one database: nothing on the command line selects
  // content. The flag that used to is refused with the sentence that says so.
  if (args.includes('--env') || args.includes('--prod')) {
    console.error('tangen: --env and --prod are gone. A deployment has one database (DATABASE_URL) and one role (TANGEN_DEPLOYMENT_ROLE=development|staging|production); run the command from the deployment you mean.')
    process.exit(1)
  }

  const projectName = flagValueOrExit(args, '--project', 'tangen <command> --project <name>')

  // --workspace <slug> targets a specific workspace in the registry (multi-workspace mode)
  const workspaceSlug = flagValueOrExit(args, '--workspace', 'tangen <command> --workspace <slug>')

  const { resolveProject } = await import('./resolve-project')
  let resolved: Awaited<ReturnType<typeof resolveProject>>
  try {
    resolved = resolveProject(process.cwd(), projectName)
  } catch (err: any) {
    console.error(`tangen: ${err.message}`)
    process.exit(1)
  }

  // The deployment role of this process: printed, never chosen here.
  const role = deploymentRole()

  // push prints its own styled header; for all other commands print a compact
  // one. NEVER on stdout for `mcp` (stdio transport carries only protocol
  // messages - a banner there corrupts the JSON-RPC stream) and never with
  // --json, so the JSON document is the whole of stdout.
  if (dispatcherPrintsHeader(args)) {
    // The header names the workspace the command will OPERATE on - the id the
    // config declares - not the directory-name guess resolveProject makes for
    // finding the project (Phase 6C, finding 6C-6).
    const identity = await resolveWorkspaceIdentity(resolved, workspaceSlug)
    console.log(
      `\n  ${c.bold(c.cyan('◆'))} ${c.bold('tangen')}  ` +
      `${c.dim('workspace:')} ${c.cyan(identity.workspaceId)}  ` +
      `${c.dim('role:')} ${c.green(role)}\n`,
    )
    if (identity.notice) console.warn(`  ${sym.warn}  ${c.yellow(identity.notice)}\n`)
  }

  if (command === 'check') {
    const { runCheckCommand } = await import('./commands/check')
    await runCheckCommand(resolved.configCwd, { json: args.includes('--json') })
  } else if (command === 'diff') {
    const { runDiffCommand } = await import('./commands/diff')
    await runDiffCommand(resolved.configCwd, resolved.workspaceId)
  } else if (command === 'push') {
    // C2: destructive operations are approved one at a time (`--approve <token>`,
    // repeatable). `--confirm` no longer authorises anything: it named every
    // destructive operation at once, and a pipeline that carried it once carried
    // it to production forever.
    if (args.includes('--confirm')) {
      console.error('tangen: --confirm is no longer accepted. Approve each destructive operation by name:\n  tangen push --plan   # lists the tokens\n  tangen push --approve drop-field:<type>.<field> [--approve …]\nA production environment refuses destructive operations regardless.')
      process.exit(1)
    }
    const confirm = collectApprovals(args)
    const allWorkspaces = args.includes('--all-workspaces')
    // --plan: dry run — print the schema diff + migration preview, apply nothing.
    // --json pairs with it for a machine-readable summary an agent can parse.
    const planOnly = args.includes('--plan')
    // --type <name>: SCOPED apply — apply only this content type (+ its out-of-sync
    // relation deps), leaving other types' pending code untouched.
    const typeIdx = args.indexOf('--type')
    const scopeType = typeIdx >= 0 ? args[typeIdx + 1] : undefined
    // --candidate <file.json>: preflight the schema as it will be after the Schema
    // Builder writes these types ({ types, remove }); only meaningful with --plan.
    const candidateIdx = args.indexOf('--candidate')
    const candidate = candidateIdx >= 0 && args[candidateIdx + 1]
      ? JSON.parse(await Bun.file(args[candidateIdx + 1]).text())
      : undefined
    const pushOpts = { planOnly, json: args.includes('--json'), ...(scopeType ? { scopeType } : {}), ...(candidate ? { candidate } : {}) }
    if (allWorkspaces) {
      const { runPushAllWorkspaces } = await import('./commands/push')
      await runPushAllWorkspaces(confirm, process.cwd(), pushOpts)
    } else if (workspaceSlug) {
      // `--workspace <slug>` registers a child workspace;
      // it runs no schema diff, so a dry run or a scoped apply asked of it
      // would be silently dropped. Say so instead: the project push is the
      // command that deploys schema, and it already derives the workspace.
      if (planOnly || scopeType) {
        console.error('tangen: push --workspace registers the workspace only; it does not deploy schema, so --plan and --type do nothing here.')
        const hint = 'tangen push' + (scopeType ? ' --type ' + scopeType : '') + (planOnly ? ' --plan' : '')
        console.error('        run `' + hint + '` from the project root; the workspace is derived from its config.')
        process.exit(1)
      }
      const { runPushForWorkspace } = await import('./commands/push')
      try {
        await runPushForWorkspace(workspaceSlug, confirm, process.cwd())
      } catch (e: any) {
        console.error(`tangen: ${e.message ?? String(e)}`)
        process.exit(1)
      }
    } else {
      const { runPushCommand } = await import('./commands/push')
      // The banner names the workspace push will OPERATE on - the id the config
      // declares - not resolveProject's directory-name guess (Stage G12,
      // G11-3). A --json run prints no banner at all.
      const pushIdentity = pushOpts.json ? null : await resolveWorkspaceIdentity(resolved, workspaceSlug)
      await runPushCommand(confirm, resolved.configCwd, resolved.workspaceId, {
        ...pushOpts,
        ...(pushIdentity ? { header: { workspaceId: pushIdentity.workspaceId } } : {}),
      })
      if (pushIdentity?.notice) console.warn(`  ${sym.warn}  ${c.yellow(pushIdentity.notice)}\n`)
    }
    // The typed registry (tangen-types.d.ts) is one of push's generated files:
    // written with content-tables.ts after a successful apply, never after a
    // failed one. `tangen types` remains for regenerating it on its own.
    // The pooled pg connection has no idle timeout and keeps the event loop alive —
    // without an explicit exit, refused pushes (restrict/--plan early returns) hang
    // forever and the admin's push-status poll never resolves.
    process.exit(process.exitCode ?? 0)
  } else if (command === 'purge') {
    // tangen purge component <component>.<field> [--plan] [--approve <token>] [--json]
    // The explicit destruction of historical component sub-field values. It is
    // a command and not part of push on purpose: removing a field from a
    // component definition hides its stored values, and nothing declarative may
    // ever imply deleting them.
    if (args[1] === 'guarded') {
      // tangen purge guarded [<table>.<column> | <table>]... [--list] [--plan] [--approve purge-guarded:<name>] [--json]
      // The explicit physical deletion of what a guarded drop kept aside (freeze
      // review C2, Unit 2). One approval per object; production refuses.
      const { runGuardedPurgeCommand } = await import('./commands/purge')
      const targets = args.slice(2).filter((a, i, all) => !a.startsWith('-') && all[i - 1] !== '--approve')
      await runGuardedPurgeCommand(resolved.configCwd, targets, {
        list: args.includes('--list'), planOnly: args.includes('--plan'), approvals: collectApprovals(args), json: args.includes('--json'),
      }, resolved.workspaceId)
      process.exit(0)
    }
    if (args[1] === 'extension') {
      // tangen purge extension <id> [--plan] [--approve purge-extension:<id>] [--json]
      // The explicit deletion of what an uninstall retained (Phase 4, Unit 9).
      const { runExtensionPurgeCommand } = await import('./commands/purge')
      const target = args.slice(2).find((a, i, all) => !a.startsWith('-') && all[i - 1] !== '--approve')
      await runExtensionPurgeCommand(resolved.configCwd, target, {
        planOnly: args.includes('--plan'), approvals: collectApprovals(args), json: args.includes('--json'),
      }, resolved.workspaceId)
      process.exit(0)
    }
    if (args[1] !== 'component') {
      console.error('tangen: usage - tangen purge component <component>.<field> [--plan] [--approve purge-component-field:<component>.<field>]\n        tangen purge guarded [<table>.<column> | <table>] [--list] [--plan] [--approve purge-guarded:<name>]\n        tangen purge extension <id> [--plan] [--approve purge-extension:<id>]')
      process.exit(1)
    }
    const { runPurgeCommand } = await import('./commands/purge')
    await runPurgeCommand(resolved.configCwd, args[2], {
      planOnly: args.includes('--plan'),
      approvals: collectApprovals(args),
      json: args.includes('--json'),
    }, resolved.workspaceId)
    process.exit(process.exitCode ?? 0)
  } else if (command === 'doctor') {
    // tangen doctor [--json] - READ-ONLY: local code vs registry vs
    // generated content-tables.ts vs the live database, every disagreement with
    // its fix. Exit 0 clean, 1 drift, 2 unreachable. The pooled pg connection
    // keeps the loop alive, so exit explicitly.
    if (args.includes('--deployment')) {
      // tangen doctor --deployment - the deployment as boot sees it: the
      // database and its live identity, every resolved key with
      // its provenance (references, never values), extension activation,
      // integrations, desired membership, and every finding boot would act on.
      const { runDoctorDeploymentCommand } = await import('./commands/doctor-deployment')
      await runDoctorDeploymentCommand(resolved.configCwd, { json: args.includes('--json') })
      process.exit(process.exitCode ?? 0)
    }
    const { runDoctorCommand } = await import('./commands/doctor')
    await runDoctorCommand(resolved.configCwd, { json: args.includes('--json') })
    process.exit(process.exitCode ?? 0)
  } else if (command === 'connections' && args[1] === 'rotate-key') {
    // tangen connections rotate-key [--json] - re-seals every connection row
    // under the current connections key, opening each with the previous one
    // (TANGEN_CONNECTIONS_KEY_PREVIOUS, never argv). Exit 0 done, 1 rows left
    // unreadable, 2 could not run.
    const { runConnectionsRotateKeyCommand } = await import('./commands/connections')
    await runConnectionsRotateKeyCommand(resolved.configCwd, { json: args.includes('--json') })
    process.exit(process.exitCode ?? 0)
  } else if (command === 'schema' && args[1] === 'regenerate') {
    // tangen schema regenerate [--force] [--json] - rewrites
    // content-tables.ts (+ custom-tables.ts) from the REGISTRY through the
    // push generator; no DDL, no registry change. Refuses while the database is
    // behind the registry (the file would 42703 on read) unless --force.
    const { runSchemaRegenerateCommand } = await import('./commands/schema-regenerate')
    await runSchemaRegenerateCommand(resolved.configCwd, { force: args.includes('--force'), json: args.includes('--json') })
    process.exit(process.exitCode ?? 0)
  } else if (command === 'pull') {
    // tangen pull [--layout v1] - writes app/content-objects/<type>/schema.ts
    // (the v2 layout); --layout v1 writes the old content/ tree.
    const { runPullFromConfig } = await import('./commands/pull')
    await runPullFromConfig(resolved.configCwd, resolved.workspaceId, { layout: pullLayout(args) })
  } else if (command === 'types') {
    const outIdx = args.indexOf('--out')
    const outPath = outIdx !== -1 ? args[outIdx + 1] : undefined
    const { runTypesCommand } = await import('./commands/types')
    await runTypesCommand(resolved.configCwd, outPath)
  } else if (command === 'workspace' && args[1] === 'create') {
    const { promptForNewWorkspace, runWorkspaceCreateCommand } = await import('./commands/create')
    try {
      const opts = await promptForNewWorkspace()
      const { join: joinPath, resolve: resolvePath } = await import('path')
      const { existsSync } = await import('fs')
      let projectRoot = process.cwd()
      for (let i = 0; i < 5; i++) {
        if (existsSync(joinPath(projectRoot, 'app', 'config', 'workspaces.ts'))) break
        if (existsSync(joinPath(projectRoot, 'app', 'tangen.config.ts'))) break
        const parent = resolvePath(projectRoot, '..')
        if (parent === projectRoot) break
        projectRoot = parent
      }
      await runWorkspaceCreateCommand(opts, projectRoot)
      process.exit(0)
    } catch (err: any) {
      console.error(`\n  tangen: ${err.message}`)
      process.exit(1)
    }

  } else if (command === 'release' && (args[1] === 'list' || args[1] === 'status')) {
    // tangen release list [--status <s>] [--json]
    // tangen release status <id> [--json]
    // Read-only (Phase 5B, Unit 13): approve, schedule and apply live in the API.
    const { loadExtensionCommandContext } = await import('./commands/extension-install')
    const { runReleaseListCommand, runReleaseStatusCommand } = await import('./commands/release')
    const { createDb } = await import('@tangen/db')
    const json = args.includes('--json')
    const statusIdx = args.indexOf('--status')
    const statusFilter = statusIdx >= 0 ? args[statusIdx + 1] : undefined
    const releaseId = args[1] === 'status' ? args[2] : undefined
    if (args[1] === 'status' && (!releaseId || releaseId.startsWith('-'))) {
      console.error('tangen: usage - tangen release status <id> [--json]')
      process.exit(1)
    }
    let db: { end: () => Promise<void> } | null = null
    try {
      const { database, workspaceId } = await loadExtensionCommandContext(resolved.configCwd, resolved.workspaceId, { workspaceSlug })
      db = createDb(database.url) as unknown as { end: () => Promise<void> }
      if (args[1] === 'list') await runReleaseListCommand({ db, workspaceId, json }, statusFilter)
      else await runReleaseStatusCommand({ db, workspaceId, json }, releaseId!)
    } catch (err: any) {
      console.error(`tangen: ${err.message}`)
      if (db) await db.end().catch(() => {})
      process.exit(1)
    }
    if (db) await db.end().catch(() => {})

  } else if (command === 'workspace' && args[1] === 'remove') {
    const slugToRemove = args[2]
    if (!slugToRemove || slugToRemove.startsWith('-')) {
      console.error('tangen: workspace slug is required\n  Usage: tangen workspace remove <slug>')
      process.exit(1)
    }
    const { runWorkspaceRemoveCommand } = await import('./commands/create')
    try {
      const { join: joinPath, resolve: resolvePath } = await import('path')
      const { existsSync } = await import('fs')
      let projectRoot = process.cwd()
      for (let i = 0; i < 5; i++) {
        if (existsSync(joinPath(projectRoot, 'app', 'config', 'workspaces.ts'))) break
        if (existsSync(joinPath(projectRoot, 'app', 'tangen.config.ts'))) break
        const parent = resolvePath(projectRoot, '..')
        if (parent === projectRoot) break
        projectRoot = parent
      }
      await runWorkspaceRemoveCommand(slugToRemove, projectRoot)
      process.exit(0)
    } catch (err: any) {
      console.error(`\n  tangen: ${err.message}`)
      process.exit(1)
    }

  } else if (command === 'add' && args[1] === 'object') {
    const typeName = args[2]
    if (!typeName || typeName.startsWith('-')) {
      console.error('tangen: object name is required\n  Usage: tangen add object <name> [--label <label>] [--with-hooks]')
      process.exit(1)
    }
    const labelFlag = args.indexOf('--label')
    const rawLabel = labelFlag !== -1 ? args[labelFlag + 1] : undefined
    const typeLabel = rawLabel ?? (typeName.charAt(0).toUpperCase() + typeName.slice(1))
    const { runAddObjectCommand } = await import('./commands/add-object')
    try {
      await runAddObjectCommand(typeName, typeLabel, resolved.configCwd, { withHooks: args.includes('--with-hooks') })
    } catch (err: any) {
      console.error(`tangen: ${err.message}`)
      process.exit(1)
    }

  } else if (command === 'object' && ['disable', 'enable', 'delete'].includes(args[1] ?? '')) {
    // tangen object disable|enable|delete <name> [--yes]
    const action = args[1] as 'disable' | 'enable' | 'delete'
    const typeName = args[2]
    if (!typeName || typeName.startsWith('-')) {
      console.error(`tangen: object name is required\n  Usage: tangen object ${action} <name>${action === 'delete' ? ' [--yes]' : ''}`)
      process.exit(1)
    }
    const { runObjectToggleCommand, runObjectDeleteFiles } = await import('./commands/object-lifecycle')

    if (action === 'delete') {
      // Permanent, with the cascade: detach referring relation fields (their columns
      // drop too), remove the type, then ONE push approving exactly those drops.
      const { detachReferencesInDir } = await import('./commands/object-lifecycle')
      if (!args.includes('--yes')) {
        console.log(`  ⚠  Deleting "${typeName}" is PERMANENT - its table and ALL content drop on push.`)
        console.log('     Relation fields elsewhere that target it are DETACHED (their columns + values drop too).')
        const answer = prompt(`  Type the name to confirm (or Ctrl+C):`)
        if (answer !== typeName) {
          console.error('tangen: confirmation did not match - aborted')
          process.exit(1)
        }
      }
      const { join: joinCwd } = await import('node:path')
      // The command approves exactly what it did: the type's own drop and the
      // relation fields it detached, nothing else that may be pending.
      const detachedFields: string[] = []
      const detached = detachReferencesInDir(joinCwd(resolved.configCwd, 'content-objects'), typeName, { detached: detachedFields }, joinCwd(resolved.configCwd, 'components'))
      if (detached === null) process.exit(1)
      if (!runObjectDeleteFiles(typeName, resolved.configCwd)) process.exit(1)
      const { runPushCommand } = await import('./commands/push')
      const approvals = [`drop-type:${typeName}`, ...detachedFields.filter((f) => !f.startsWith('components/')).map((f) => `drop-field:${f}`)]
      await runPushCommand(approvals, resolved.configCwd, resolved.workspaceId, {})
    } else {
      if (!runObjectToggleCommand(typeName, action === 'disable', resolved.configCwd)) process.exit(1)
      const { runPushCommand } = await import('./commands/push')
      await runPushCommand([], resolved.configCwd, resolved.workspaceId, {})
    }

  } else if (command === 'knowledge' && (args[1] === 'index' || args[1] === 'status')) {
    // tangen knowledge index|status [--rebuild] [--yes] [--docs]
    const { runKnowledgeIndexCommand, runKnowledgeStatusCommand } = await import('./commands/knowledge')
    const kargs = {
      configCwd: resolved.configCwd,
      workspaceId: resolved.workspaceId,
      rebuild: args.includes('--rebuild'),
      yes: args.includes('--yes'),
      docs: args.includes('--docs'),
    }
    try {
      if (args[1] === 'index') await runKnowledgeIndexCommand(kargs)
      else await runKnowledgeStatusCommand(kargs)
    } catch (err: any) {
      console.error(`tangen: ${err.message}`)
      process.exit(1)
    }

  } else if (command === 'mcp' && args[1] === 'expose') {
    // tangen mcp expose — read-only report of what agents can see
    const { runMcpExposeCommand } = await import('./commands/mcp')
    try {
      await runMcpExposeCommand({ configCwd: resolved.configCwd, workspaceId: resolved.workspaceId })
    } catch (err: any) {
      console.error(`tangen: ${err.message}`)
      process.exit(1)
    }

  } else if (command === 'mcp') {
    // tangen mcp [--key <api-key>] [--url <api-url>] [--allow-schema]
    const { runMcpCommand } = await import('./commands/mcp')
    await runMcpCommand(args.slice(1))

  } else if (command === 'extension' && args[1] === 'bundle') {
    // tangen extension bundle [<dir>] [--minify] [--json] - builds the
    // extension's client module into the ES module its manifest `ui` names,
    // shared modules rewritten to the Admin's runtime global (K7.3).
    const { runExtensionBundleUiCommand } = await import('./commands/extension-bundle-ui')
    await runExtensionBundleUiCommand(resolved.configCwd, args[2] && !args[2].startsWith('--') ? args[2] : undefined, { json: args.includes('--json'), minify: args.includes('--minify') })
    process.exit(process.exitCode ?? 0)
  } else if (command === 'extension' && args[1] === 'install') {
    // tangen extension install <extensionId>
    const extensionId = args[2]
    if (!extensionId || extensionId.startsWith('-')) {
      console.error('tangen: extension id is required\n  Usage: tangen extension install <extensionId>')
      process.exit(1)
    }
    const { runExtensionInstallCommand, loadExtensionCommandContext, declareExtensionFromPackage } = await import('./commands/extension-install')
    try {
      const { database, workspaceId, available } = await loadExtensionCommandContext(resolved.configCwd, resolved.workspaceId, { workspaceSlug })
      // Not declared, but the project has the package: declare it and go on.
      if (!available.some((m) => m.id === extensionId)) {
        const found = await declareExtensionFromPackage(resolved.configCwd, extensionId)
        if (found) {
          console.log(`[tangen] '${found.spec}' is in the project${found.declared ? '; declared it in app/config/extensions.ts' : ''}`)
          available.push(found.manifest)
        }
      }
      // K5.2b: the grant review. --yes approves the manifest's grants (optional ones included);
      // --approve-optional <grant,...|none> narrows the optional ones (repeatable, accumulating); in a terminal you are asked.
      const { approveOptional, approveGrants } = parseGrantDecisionFlags(args)
      const { askYesNo } = await import('./commands/extension-review')
      const { dirname: dirnameOf } = await import('path')
      const projectRoot = resolved.configCwd.endsWith('/app') || resolved.configCwd.endsWith('\\app') ? dirnameOf(resolved.configCwd) : resolved.configCwd
      await runExtensionInstallCommand(extensionId, workspaceId, database.url, available, console.log, { yes: args.includes('--yes'), approveOptional, approveGrants, ask: askYesNo, projectRoot })
    } catch (err: any) {
      console.error(`tangen: ${err.message}`)
      process.exit(1)
    }

  } else if (command === 'migrate' && args[1] === 'layout') {
    // tangen migrate layout [--dry-run] — v1 → v2 app layout
    const { runMigrateLayoutCommand } = await import('./commands/migrate-layout')
    const { dirname: dirnameOf } = await import('path')
    try {
      // resolved.configCwd is the app/ dir (or a dir containing tangen.config.ts);
      // the migration operates on the project root that contains app/.
      const projectRoot = resolved.configCwd.endsWith('/app') || resolved.configCwd.endsWith('\\app')
        ? dirnameOf(resolved.configCwd)
        : resolved.configCwd
      runMigrateLayoutCommand(projectRoot, args.includes('--dry-run'))
    } catch (err: any) {
      console.error(`tangen: ${err.message}`)
      process.exit(1)
    }

  } else if (command === 'extension' && (args[1] === 'uninstall' || args[1] === 'remove')) {
    // tangen extension uninstall <extensionId>
    const extensionId = args[2]
    if (!extensionId || extensionId.startsWith('-')) {
      console.error('tangen: extension id is required\n  Usage: tangen extension uninstall <extensionId>')
      process.exit(1)
    }
    const { runExtensionUninstallCommand } = await import('./commands/extension-uninstall')
    const { loadExtensionCommandContext } = await import('./commands/extension-install')
    try {
      const { database, workspaceId, available } = await loadExtensionCommandContext(resolved.configCwd, resolved.workspaceId, { workspaceSlug })
      await runExtensionUninstallCommand(extensionId, workspaceId, database.url, available)
    } catch (err: any) {
      console.error(`tangen: ${err.message}`)
      process.exit(1)
    }

  } else if (command === 'extension' && args[1] === 'list') {
    // tangen extension list
    const { runExtensionListCommand } = await import('./commands/extension-uninstall')
    const { loadExtensionCommandContext } = await import('./commands/extension-install')
    try {
      const { database, workspaceId, available } = await loadExtensionCommandContext(resolved.configCwd, resolved.workspaceId, { workspaceSlug })
      await runExtensionListCommand(workspaceId, database.url, available)
    } catch (err: any) {
      console.error(`tangen: ${err.message}`)
      process.exit(1)
    }

  } else if (command === 'extension' && args[1] === 'inspect') {
    // tangen extension inspect <extensionId> - the manifest overview and the grant review against what this workspace recorded
    const extensionId = args[2]
    if (!extensionId || extensionId.startsWith('-')) {
      console.error('tangen: extension id is required\n  Usage: tangen extension inspect <extensionId>')
      process.exit(1)
    }
    const { loadExtensionCommandContext } = await import('./commands/extension-install')
    const { runExtensionInspectCommand } = await import('./commands/extension-lifecycle')
    const { createDb } = await import('@tangen/db')
    // Every command opens the deployment's database, runs, and CLOSES it.
    // This one did not, so it printed its answer and then hung for ever on an
    // open pool (found running it against acme, 2026-09-19).
    let inspectDb: { end: () => Promise<void> } | null = null
    try {
      const { database, workspaceId, available } = await loadExtensionCommandContext(resolved.configCwd, resolved.workspaceId, { workspaceSlug })
      inspectDb = createDb(database.url) as unknown as { end: () => Promise<void> }
      await runExtensionInspectCommand({ db: inspectDb as never, workspaceId, available: available as never }, extensionId)
    } catch (err: any) {
      console.error(`tangen: ${err.message}`)
      if (inspectDb) await inspectDb.end().catch(() => {})
      process.exit(1)
    }
    if (inspectDb) await inspectDb.end().catch(() => {})

  } else if (command === 'extension' && (args[1] === 'enable' || args[1] === 'disable' || args[1] === 'upgrade' || args[1] === 'status')) {
    // tangen extension enable|disable|upgrade <extensionId>   tangen extension status [--json]
    // The v1 lifecycle (Phase 4, Unit 12); every command opens the
    // deployment's database, runs, and closes it.
    const action = args[1]
    const extensionId = args[2]
    if (action !== 'status' && (!extensionId || extensionId.startsWith('-'))) {
      console.error(`tangen: extension id is required\n  Usage: tangen extension ${action} <extensionId>${action === 'upgrade' ? ' [--plan]' : ''}`)
      process.exit(1)
    }
    const { loadExtensionCommandContext } = await import('./commands/extension-install')
    const { runExtensionEnableCommand, runExtensionUpgradeCommand, runExtensionStatusCommand } = await import('./commands/extension-lifecycle')
    const { createDb } = await import('@tangen/db')
    let db: { end: () => Promise<void> } | null = null
    try {
      const { database, workspaceId, available } = await loadExtensionCommandContext(resolved.configCwd, resolved.workspaceId, { workspaceSlug })
      db = createDb(database.url) as unknown as { end: () => Promise<void> }
      const deps = { db, workspaceId, available, role }
      if (action === 'status') await runExtensionStatusCommand(deps, { json: args.includes('--json') })
      else if (action === 'upgrade') {
        // K5.2b: an upgrade re-reviews new grants against what was recorded; --yes approves them.
        const { approveOptional, approveGrants } = parseGrantDecisionFlags(args)
        const { askYesNo } = await import('./commands/extension-review')
        const { dirname: dirnameOf } = await import('path')
        const projectRoot = resolved.configCwd.endsWith('/app') || resolved.configCwd.endsWith('\\app') ? dirnameOf(resolved.configCwd) : resolved.configCwd
        await runExtensionUpgradeCommand({ ...deps, projectRoot }, extensionId!, { planOnly: args.includes('--plan'), yes: args.includes('--yes'), approveOptional, approveGrants, ask: askYesNo })
      }
      else await runExtensionEnableCommand(deps, extensionId!, action === 'enable')
    } catch (err: any) {
      console.error(`tangen: ${err.message}`)
      if (db) await db.end().catch(() => {})
      process.exit(1)
    }
    if (db) await db.end().catch(() => {})

  } else if (command === 'ai') {
    const { runAiCommand } = await import('./commands/ai')
    runAiCommand(args)
  } else if (command === 'skills' && args[1] === 'update') {
    // Refresh this project's skills from the versions the installed CLI ships -
    // scaffolded repos otherwise stay frozen at scaffold-day guidance.
    const { runSkillsUpdate } = await import('./commands/ai')
    const res = runSkillsUpdate(process.cwd())
    for (const f of res.written) console.log(`  ✓  ${f}`)
    console.log(`skills updated (${res.written.length} file${res.written.length === 1 ? '' : 's'})`)
  } else if (command === 'dev') {
    const { runDevCommand } = await import('./commands/dev')
    await runDevCommand({ typecheck: args.includes('--typecheck'), skipDbCheck: args.includes('--skip-db-check') })
  } else if (command === 'start') {
    const { runDevCommand } = await import('./commands/dev')
    await runDevCommand({ apiOnly: true, skipDbCheck: args.includes('--skip-db-check') })
  } else if (command === 'build') {
    // The static Admin a deployment serves. One artifact for every host: the
    // Admin resolves its API at runtime, so the build knows no deployment.
    const { runBuildCommand } = await import('./commands/build')
    const outIdx = args.indexOf('--out')
    await runBuildCommand(outIdx >= 0 && args[outIdx + 1] ? { out: args[outIdx + 1] } : {})
  } else if (command === 'reconcile' || (command === 'db' && args[1] === 'reconcile')) {
    // tangen reconcile [--apply] — sync the drizzle migration ledger with
    // migrations already applied out-of-band (the safety latch for "applied
    // but never recorded" drift). Dry-run by default.
    const { resolveDeploymentDatabase, describeDatabaseError } = await import('./deployment-database')
    let url: string
    try {
      url = resolveDeploymentDatabase().url
    } catch (e) {
      console.error(`tangen: ${describeDatabaseError(e)}`)
      process.exit(1)
    }
    const apply = args.includes('--apply')
    const { reconcileMigrations } = await import('@tangen/db/reconcile')
    const res = await reconcileMigrations(url, { apply })
    if (!res.ledgerExists) {
      console.log('tangen: no migration ledger - this DB has never been migrated. Run migrations first.')
    } else if (res.missing.length === 0) {
      console.log(`tangen: migration ledger in sync (${res.recorded}/${res.total}). Nothing to reconcile.`)
    } else if (apply) {
      console.log(`tangen: recorded ${res.missing.length} applied-but-unrecorded migration(s): ${res.missing.map((m) => m.tag).join(', ')}`)
      console.log(`tangen: ledger now in sync (${res.total}/${res.total}).`)
    } else {
      console.log(`tangen: ledger drift - ${res.recorded}/${res.total} recorded. These are applied but not recorded:`)
      for (const m of res.missing) console.log(`  - ${m.tag}`)
      console.log('\nRun `tangen reconcile --apply` to record them (only when the schema is actually up to date).')
    }
  } else if (command === 'bootstrap') {
    const { runBootstrapCommand } = await import('./commands/bootstrap')
    const nameFlag = args.indexOf('--name')
    await runBootstrapCommand({
      configCwd: resolved.configCwd,
      workspaceId: resolved.workspaceId,
      withDemo: args.includes('--with-demo'),
      name: nameFlag !== -1 ? args[nameFlag + 1] : undefined,
      // --ai / --no-ai skip the interactive AI-mode prompt (undefined ⇒ prompt).
      ai: args.includes('--no-ai') ? false : args.includes('--ai') ? true : undefined,
    })
  } else if (command === 'reset-password') {
    // tangen reset-password <email> [--password <pw>]
    const email = args[1] && !args[1].startsWith('-') ? args[1] : ''
    if (!email) {
      console.error('tangen: an email is required\n  Usage: tangen reset-password <email>')
      process.exit(1)
    }
    const pwFlag = args.indexOf('--password')
    const { runResetPasswordCommand } = await import('./commands/reset-password')
    await runResetPasswordCommand(
      email,
      pwFlag !== -1 ? args[pwFlag + 1] : undefined,
    )
  } else if (command === 'enable') {
    // tangen enable <featureKey>
    const featureKey = args[1]
    if (!featureKey || featureKey.startsWith('-')) {
      console.error('tangen: feature name is required\n  Usage: tangen enable <feature>  (e.g. tangen enable auth)')
      process.exit(1)
    }
    const { runEnableCommand } = await import('./commands/enable')
    // The deployment's database, through the one resolver. tangen.config.ts
    // may not be importable yet (first-time setup); the variable still answers.
    const { resolveDeploymentDatabase, describeDatabaseError } = await import('./deployment-database')
    let url: string | undefined
    let dbError = ''
    try { url = resolveDeploymentDatabase().url } catch (e) { dbError = describeDatabaseError(e) }
    // Config-only features (ai, graphql) have no migrations — enabling them just
    // scaffolds the config + wires it in, so a database isn't required.
    const { getFeature } = await import('./features/registry')
    const needsDb = (getFeature(featureKey)?.migrations.length ?? 0) > 0
    if (!url && needsDb) {
      console.error(`tangen: ${dbError}`)
      process.exit(1)
    }
    try {
      await runEnableCommand(featureKey, resolved.configCwd, url ?? '')
    } catch (err: any) {
      console.error(`tangen: ${err.message}`)
      process.exit(1)
    }

  } else if (command === 'disable') {
    // tangen disable <featureKey> [--drop-tables]
    const featureKey = args[1]
    if (!featureKey || featureKey.startsWith('-')) {
      console.error('tangen: feature name is required\n  Usage: tangen disable <feature>  (e.g. tangen disable auth)')
      process.exit(1)
    }
    const dropTables = args.includes('--drop-tables')
    const { runDisableCommand } = await import('./commands/disable')
    // `disable` is `enable`'s mirror (Stage G9, G8-1): the same resolver, and
    // a config that is already partially removed still lets the variable answer.
    const { resolveDeploymentDatabase, describeDatabaseError } = await import('./deployment-database')
    let url: string | undefined
    let dbError = ''
    try { url = resolveDeploymentDatabase().url } catch (e) { dbError = describeDatabaseError(e) }
    if (!url && dropTables) {
      console.error(`tangen: --drop-tables needs the database: ${dbError}`)
      process.exit(1)
    }
    try {
      await runDisableCommand(featureKey, resolved.configCwd, url ?? '', { dropTables })
    } catch (err: any) {
      console.error(`tangen: ${err.message}`)
      process.exit(1)
    }

  } else if (command === 'extension' && args[1] === 'create') {
    // tangen extension create [<id>] [--name <name>] [--description <desc>] [--author <author>] [--website <url>]
    const { runExtensionCreateCommand, promptForExtensionDetails, registerExtensionInConfig } = await import('./commands/extension-create')
    const { join } = await import('path')
    try {
      let opts: Awaited<ReturnType<typeof promptForExtensionDetails>>

      const inlineId = args[2] && !args[2].startsWith('-') ? args[2] : undefined
      const nameFlag = args.indexOf('--name')
      const descFlag = args.indexOf('--description')
      const authorFlag = args.indexOf('--author')
      const websiteFlag = args.indexOf('--website')

      if (inlineId && nameFlag !== -1) {
        // Non-interactive mode
        opts = {
          id: inlineId,
          name: nameFlag !== -1 ? args[nameFlag + 1] : inlineId,
          description: descFlag !== -1 ? args[descFlag + 1] : `A Tangen extension`,
          author: authorFlag !== -1 ? args[authorFlag + 1] : '',
          website: websiteFlag !== -1 ? args[websiteFlag + 1] : '',
          version: '0.1.0',
        }
      } else {
        // Interactive mode
        opts = await promptForExtensionDetails()
        if (inlineId) opts.id = inlineId
      }

      // configCwd is app/ — extensions/ is its sibling at the project root
      const extensionsDir = join(resolved.configCwd, '..', 'extensions')
      await runExtensionCreateCommand(opts, extensionsDir)
      const registered = registerExtensionInConfig(join(resolved.configCwd, 'config', 'extensions.ts'), opts.id)
      console.log(`\n  Extension '${opts.id}' created${registered ? ' and registered in app/config/extensions.ts' : ''}. Next steps:\n`)
      if (!registered) console.log(`    add { resolve: '../../extensions/${opts.id}' } to app/config/extensions.ts`)
      console.log(`    (npm|bun) install                                      # only if you also link it as a workspace package`)
      // The registry (app/config/extensions.ts) only reaches a workspace if that
      // workspace imports it - otherwise the extension never loads at runtime.
      console.log(`    ensure your workspace config uses the registry:        # app/workspaces/<slug>/workspace.config.ts`)
      console.log(`        import extensions from '../../config/extensions'`)
      console.log(`        export default defineWorkspace({ ..., extensions })`)
      console.log(`    tangen extension install ${opts.id}   # runs onInstall`)
      console.log(`    restart 'bun run dev' to load the panel + server entry\n`)
    } catch (err: any) {
      console.error(`tangen: ${err.message}`)
      process.exit(1)
    }

  } else {
    console.log(`tangen - schema-as-code CLI

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
  extension uninstall <extensionId>                        Remove an installed extension (role grants kept, shown inactive)
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
  --workspace <slug> One workspace from app/workspaces/index.ts: extension commands act on it; push registers it
  --label <label>   Human-readable label for the new type (default: title-cased name)

Features:
  auth              Site Auth - end-user authentication (password, OTP, SSO, anonymous)
  forms             Forms is an extension: tangen extension install forms
`)
    // Asking for help is not an error: `tangen`, `tangen help`, `--help` and
    // `-h` all exit 0. An unknown command prints the same text and exits 1.
    const askedForHelp = !command || command === 'help' || command === '--help' || command === '-h'
    process.exit(askedForHelp ? 0 : 1)
  }
}
/**
 * The workspace identity a command will use: the id the config declares,
 * with a notice when it had to be guessed. Returns the resolver's own
 * best-guess only when the config cannot be read at all, marked as such -
 * the header must never quietly show one workspace while the command writes
 * to another (Phase 6C, Unit 6).
 */
async function resolveWorkspaceIdentity(
  resolved: { configCwd: string; workspaceId: string },
  workspaceSlug: string | undefined,
): Promise<{ workspaceId: string; notice: string | null }> {
  const { resolve: resolvePath } = await import('path')
  const configPath = workspaceSlug
    ? resolvePath(process.cwd(), 'app', 'workspaces', workspaceSlug, 'workspace.config.ts')
    : resolvePath(resolved.configCwd, 'tangen.config.ts')
  const { existsSync, statSync } = await import('fs')
  const { relative } = await import('path')
  const shown = relative(process.cwd(), configPath) || configPath
  // The reason a config could not be read is the whole message: a missing
  // file, an emptied file and a broken import each need a different fix.
  let reason: string
  if (!existsSync(configPath)) {
    reason = `${shown} does not exist`
  } else if (statSync(configPath).size === 0) {
    reason = `${shown} is empty - it should export a TangenConfig with workspaceId (tangen create writes one)`
  } else {
    try {
      const mod = await import(configPath)
      const config = mod.default as TangenConfig | undefined
      if (!config || typeof config !== 'object') {
        reason = `${shown} has no default export`
      } else {
        const { deriveWorkspaceId, workspaceIdNotice } = await import('./commands/push-config')
        const workspaceId = deriveWorkspaceId(config)
        return { workspaceId, notice: workspaceIdNotice(config, workspaceId) }
      }
    } catch (err) {
      reason = `${shown} could not be imported: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`
    }
  }
  return { workspaceId: resolved.workspaceId, notice: `workspace id "${resolved.workspaceId}" is a guess from the folder name - ${reason}` }
}

/** `--approve <token>` and `--approve=<token>`, any number of times, in order. */
function collectApprovals(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--approve' && args[i + 1] && !args[i + 1]!.startsWith('-')) out.push(args[++i]!)
    else if (args[i]!.startsWith('--approve=')) out.push(args[i]!.slice('--approve='.length))
  }
  return out
}

