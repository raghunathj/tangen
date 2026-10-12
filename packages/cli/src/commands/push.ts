/**
 * File Name: push.ts
 * Purpose: Implements the `tangen push` command: preflight (read-only), apply
 *          (one transaction), write (the generated files), in that order and
 *          never partial.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The preflight (push-preflight.ts) decides everything
 *   with SELECTs only: type-check, validators, the plan, the destructive
 *   classification, every migration statement the apply will run (pre-validated)
 *   and the full codegen to memory. `--plan` returns right after it, so a dry
 *   run writes nothing, not even the workspace rows. The apply (apply.ts) runs
 *   the registry rows and every planned statement in ONE transaction, after the
 *   idempotent system-column self-heal; extension push hooks follow as their own
 *   transaction. The generated files (content-tables, custom-tables,
 *   tangen-types.d.ts) are written only after the apply committed, from the
 *   preflight's artifacts. Destructive ops (DROP_FIELD of a column, DROP_TYPE,
 *   tier-2 casts) require a per-operation --approve; production refuses them.
 */
import { resolve, join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import type { WorkspaceDefinition } from '@tangen/types'
import { printPlan, printPlanJson, planToJson } from '../print-plan'
import { startPushRecord, finishPushRecord, readGitSha, readCliVersion } from '../push-ledger'
import { pushHistoryGate, describePushHistory } from '../push-history'
import { applyPush, invalidateSchemaCache, notifySchemaChanged } from '../apply'
import { writePushArtifacts } from '../push-pipeline'
import { preflight, type PreflightContext, type PreflightFailure, type SchemaCandidate } from '../push-preflight'
import { groupStatements } from '../migration-plan'
import { log, c, sym } from '../ui'
import {
  resolveWorkspaceConfigPath, deriveWorkspaceId, buildSetupHintUrl, findDbPackageRoot, gatherCustomTables,
  mergeWorkspaceConfig, resolveEffectiveConfig, findAllProjectCwds,
} from './push-config'
import { resolveDeploymentDatabase, deploymentRole } from '../deployment-database'
import { resolveProjectDeployment, type ResolvedDeployment } from '@tangen/types'

export {
  resolveWorkspaceConfigPath, deriveWorkspaceId, buildSetupHintUrl, findDbPackageRoot, gatherCustomTables,
  mergeWorkspaceConfig, resolveEffectiveConfig, findAllProjectCwds,
}

/**
 * Brings the system schema up to date before a push: the canonical migrator
 * when the environment has a real connection string and the client is the
 * command's own, else (or when the migrator refuses) the floor derived from
 * the migrations. Best-effort: warns, never throws.
 */
export async function ensureSystemSchemaForPush(
  pf: { database: { url?: string }; dbInjected: boolean; cwd: string },
  exec: (text: string) => Promise<unknown>,
  warn: (msg: string) => void = (m) => log.warn(m),
): Promise<'migrated' | 'floor'> {
  const url = pf.database.url
  if (!pf.dbInjected && url && /^postgres(ql)?:\/\//.test(url)) {
    try {
      const { createRequire } = await import('node:module')
      const req = createRequire(join(pf.cwd, 'noop.js'))
      const { runMigrations } = await import(req.resolve('@tangen/db/migrate'))
      await runMigrations(url)
      return 'migrated'
    } catch (err) {
      warn(`system migrations did not run (${err instanceof Error ? err.message : String(err)}) - applying the derived schema floor instead; run \`tangen reconcile\` if the ledger has drifted`)
    }
  }
  const { ensureSystemColumns } = await import('@tangen/db')
  await ensureSystemColumns(exec)
  return 'floor'
}

/**
 * Upserts the workspace row (idempotent via `onConflictDoNothing`). Used by the
 * registration-only `--workspace` push; the schema push seeds the same row
 * inside its apply transaction.
 */
async function ensureWorkspace(
  db: Awaited<ReturnType<typeof import('@tangen/db').createDb>>,
  workspaceId: string,
  projectName: string,
  displayName?: string,
): Promise<void> {
  const { workspaces } = await import('@tangen/db')
  const wsName = displayName
    ?? (projectName
      ? projectName.charAt(0).toUpperCase() + projectName.slice(1).replace(/_/g, ' ')
      : workspaceId)
  const wsSlug = workspaceId.replace(/^wsp_/, '').replace(/_/g, '-')
  await db
    .insert(workspaces as any)
    .values({ id: workspaceId, name: wsName, slug: wsSlug })
    .onConflictDoNothing()
}

export async function runPushAllWorkspaces(
  approvals: string[],
  cwd: string,
  opts: PushOptions = {},
): Promise<void> {
  const cwds = findAllProjectCwds(cwd)
  if (cwds.length === 0) {
    log.error('No tangen.config.ts found in this directory tree.')
    process.exit(1)
  }

  const results: { cwd: string; ok: boolean; error?: string }[] = []
  for (const projectCwd of cwds) {
    console.log()
    console.log(`  ${c.dim('──')} ${c.bold(projectCwd)}`)
    try {
      // keepAlive: the loop must reach every project - a push never exits the process here.
      const outcome = await runPushCommand(approvals, projectCwd, undefined, { ...opts, keepAlive: true })
      results.push({ cwd: projectCwd, ok: outcome.ok, ...(outcome.ok ? {} : { error: outcome.error }) })
    } catch (e: any) {
      results.push({ cwd: projectCwd, ok: false, error: e.message ?? String(e) })
    }
  }

  console.log()
  console.log(`  ${c.dim('── Summary')}`)
  console.log()
  for (const r of results) {
    if (r.ok) console.log(`  ${sym.tick}  ${r.cwd}`)
    else console.error(`  ${sym.cross}  ${c.red(r.cwd)}: ${c.dim(r.error ?? '')}`)
  }
  console.log()

  const failed = results.filter((r) => !r.ok).length
  if (failed > 0) {
    log.error(`${failed} project(s) failed.`)
    process.exitCode = 1
  }
}

/** Options for a push run. `planOnly` = dry run (preview, apply nothing). */
export interface PushOptions {
  planOnly?: boolean
  json?: boolean
  /** Return instead of process.exit(0) - for callers (bootstrap, --all-workspaces) that continue after the push. */
  keepAlive?: boolean
  /** SCOPED apply - apply only this content type (plus its out-of-sync relation deps),
   *  regenerating content-tables from runtime+overlay. Leaves other types' WIP untouched. */
  scopeType?: string
  /** The Schema Builder's not-yet-written types, preflighted as if on disk (with --plan). */
  candidate?: SchemaCandidate
  /**
   * What the `◆ tangen` banner should name: the DECLARED workspace identity
   * the dispatcher resolved, not the directory-name guess `resolveProject`
   * makes (Stage G11, finding G11-3).
   */
  header?: { workspaceId: string }
}

/**
 * The two strings push's banner prints: the workspace (the DECLARED identity
 * when the dispatcher resolved it, then the caller's guess, then "(from
 * config)") and the deployment role of this process.
 */
export function pushBanner(
  opts: Pick<PushOptions, 'header'>,
  workspaceId: string | undefined,
  role: string = deploymentRole(),
): { workspaceId: string; role: string } {
  return {
    workspaceId: opts.header?.workspaceId ?? workspaceId ?? '(from config)',
    role,
  }
}

/** What a push run came to - for callers that continue after it. */
export type PushOutcome = { ok: true } | { ok: false; error: string }

/** Prints a preflight failure the way push always printed its refusals. */
function printPreflightFailure(f: PreflightFailure, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ ok: false, stage: f.stage, title: f.title, errors: f.errors }, null, 2))
    return
  }
  console.error(`  ${c.red('✗')}  ${f.title}`)
  for (const e of f.errors) console.error(`     ${f.stage === 'check' ? '' : '- '}${e}`)
}

function printWarnings(pf: PreflightContext): void {
  if (pf.warnings.length === 0) return
  console.warn(`  ${sym.warn}  ${c.yellow(`${pf.warnings.length} reference${pf.warnings.length > 1 ? 's' : ''} point at a type that doesn't exist:`)}`)
  for (const r of pf.warnings) {
    const hint = r.suggestion ? c.dim(` - did you mean ${c.cyan(`"${r.suggestion}"`)}?`) : ''
    console.warn(`     ${c.dim(r.at)}  ${r.kind} → ${c.red(`"${r.reference}"`)}${hint}`)
  }
  console.warn('')
}

/**
 * Where the types came from, when that is not simply "this site's code".
 * Printed before the plan on every push, not only when something changes: a
 * developer must be able to see that a type they never wrote is expected.
 */
function printProvenance(pf: PreflightContext): void {
  const { fromExtension, overridden, conflicts } = pf.provenance
  if (fromExtension.size > 0) {
    const byExtension = new Map<string, string[]>()
    for (const [type, ext] of fromExtension) byExtension.set(ext, [...(byExtension.get(ext) ?? []), type])
    for (const [ext, types] of byExtension) {
      log.info(`Content types from extension ${c.cyan(ext)}: ${types.map((t) => c.cyan(t)).join(c.dim(', '))}`)
    }
  }
  for (const o of overridden) {
    if (o.siteName) {
      log.warn(`Extension ${c.cyan(o.extension)} declares ${c.cyan(o.type)} (previously ${c.cyan(o.siteName)}), and this site already declares ${c.cyan(o.siteName)} - the site's type wins and is left exactly as it is. Delete your ${c.cyan(`app/content-objects/${o.siteName}`)} schema to let the extension provide it (that renames the table to ${c.cyan(o.type)}).`)
      continue
    }
    log.warn(`${c.cyan(o.type)} is declared by extension ${c.cyan(o.extension)} AND by this site - the site's definition wins (it is your database). Remove yours to go back to the extension's.`)
  }
  for (const c2 of conflicts) {
    log.warn(`${c.cyan(c2.type)} is declared by two extensions - ${c.cyan(c2.kept)} wins (first in app/config/extensions.ts) and ${c.cyan(c2.dropped)}'s definition is ignored.`)
  }
}

/** The per-step lines push always printed, now after the one commit. */
function printAppliedSteps(pf: PreflightContext): void {
  if (pf.migration.i18nTables.length > 0) {
    log.ok(`Localization side tables: ${pf.migration.i18nTables.map((t) => c.cyan(t)).join(c.dim(', '))}`)
  }
  if (pf.gatheredCustomTables && pf.gatheredCustomTables.length > 0) {
    log.ok(`Custom tables: ${pf.gatheredCustomTables.map((t) => c.cyan(t.name)).join(c.dim(', '))}`)
  }
  for (const g of groupStatements(pf.migration)) {
    if (g.group === 'registry' || g.group === 'system' || g.group === 'heal') log.ok(`${g.label}: ${g.statements.length} statement${g.statements.length === 1 ? '' : 's'}`)
  }
}

export async function runPushCommand(
  approvals: string[],
  cwd: string,
  workspaceId?: string,
  opts: PushOptions = {},
): Promise<PushOutcome> {
  if (!opts.json) { const b = pushBanner(opts, workspaceId); log.header(b.workspaceId, b.role) }

  // ── Preflight: everything decided, nothing applied ──────────────────────────
  const pf = await preflight({ cwd, workspaceId }, {
    scopeType: opts.scopeType,
    approvals,
    candidate: opts.candidate,
    // A candidate is not on disk, so there is nothing for tsc to check yet.
    check: opts.candidate === undefined,
    // C1: hold the schema-mutation lock across planning and apply. `--plan`
    // writes nothing, so it must not block a real push.
    lock: opts.planOnly !== true && opts.candidate === undefined,
  })
  if (!pf.ok) {
    printPreflightFailure(pf, opts.json === true)
    process.exitCode = 1
    return { ok: false, error: [pf.title, ...pf.errors].join(' ') }
  }

  // C1: the lock is held from here (planning already happened under it) until
  // this call returns, however it returns. `keepAlive` matters most: a
  // --all-workspaces run stays in the process, so a leaked lock would block the
  // next workspace's push for the lifetime of the run.
  try {
    return await runPushApply(pf, approvals, cwd, workspaceId, opts)
  } finally {
    await pf.lock?.release()
  }
}

async function runPushApply(
  pf: Extract<Awaited<ReturnType<typeof preflight>>, { ok: true }>,
  _approvals: string[],
  cwd: string,
  workspaceId: string | undefined,
  opts: PushOptions,
): Promise<PushOutcome> {

  if (!opts.json) {
    if (pf.checkSkipped) log.warn('tsconfig.schema.json not found - skipping type-check')
    if (pf.generatedStale) log.warn('generated/content-tables.ts does not type-check against the installed packages - it is regenerated by this push')
    else log.ok('Schema types OK')
    if (opts.scopeType && pf.scopeExtras.length > 0) {
      log.info(`Scoped apply of ${c.cyan(opts.scopeType)} also updates out-of-sync ${pf.scopeExtras.length === 1 ? 'dependency' : 'dependencies'}: ${pf.scopeExtras.map((e) => c.cyan(e)).join(c.dim(', '))}`)
    }
    printProvenance(pf)
    printWarnings(pf)
  }

  // ── Dry run (--plan): the complete preview, nothing written ─────────────────
  if (opts.planOnly) {
    if (opts.json) {
      const extra = {
        warnings: pf.warnings,
        provenance: {
          fromExtension: Object.fromEntries(pf.provenance.fromExtension),
          overridden: pf.provenance.overridden,
          conflicts: pf.provenance.conflicts,
        },
        destructive: pf.destructive,
        history: pf.history,
        ...(opts.scopeType ? { scopeType: opts.scopeType, extraTypes: pf.scopeExtras } : {}),
      }
      printPlanJson(pf.plan, pf.migration, extra)
    } else {
      printPlan(pf.plan, pf.migration)
      if (pf.plan.operations.length === 0 && pf.migration.statements.length === 0) console.log(`  ${c.dim('no schema changes')}`)
      const historyGate = pushHistoryGate(pf.history)
      if (historyGate) log.warn(historyGate)
      else if (pf.history.legacy > 0) console.log(`  ${c.dim(describePushHistory(pf.history))}`)
      console.log(
        `\n  ${c.dim('dry run - nothing applied, nothing written. Re-run without --plan to apply' +
          (pf.gate?.risk === 'ambiguous' ? ' (blocked changes need a migration, see above).'
           : pf.gate ? ' (destructive ops need one --approve each; never in production).' : '.'))}`,
      )
    }
    return { ok: true }
  }

  // ── Guard: the three-state migration gate (C2) ──────────────────────────────
  // Ambiguous is not a stronger destructive: it is a different answer, and
  // an approval is not the reply to it.
  if (pf.gate) {
    printPlan(pf.plan, pf.migration)
    log.warn(pf.gate.message)
    process.exitCode = 1
    return {
      ok: false,
      error: pf.gate.risk === 'ambiguous'
        ? 'ambiguous operations cannot be applied automatically'
        : 'destructive operations require per-operation approval, and production refuses them',
    }
  }

  // ── Guard: the ledger must verify before anything runs (history integrity) ──
  const historyGate = pushHistoryGate(pf.history)
  if (historyGate) {
    log.warn(historyGate)
    process.exitCode = 1
    return { ok: false, error: 'the push history of this environment does not verify' }
  }
  if (pf.history.legacy > 0) console.log(`  ${c.dim(describePushHistory(pf.history))}`)

  const hasWork = pf.planToApply.operations.length > 0 || pf.migration.statements.length > 0
  if (hasWork) printPlan(pf.planToApply, pf.migration)

  // ── Apply: one transaction ──────────────────────────────────────────────────
  const { db } = pf
  const { sql } = await import('drizzle-orm')

  // The system schema must carry every column the registry writes. The
  // migrator is the one path that evolves it: run it (a single ledger read when
  // in sync); only when it cannot run - no real connection string, or a ledger
  // it refuses - fall back to the floor derived from the same migrations.
  // Autocommit on purpose: nothing here may abort the push transaction.
  await ensureSystemSchemaForPush(pf, (text) => db.execute(sql.raw(text)))

  // The ledger row: running now, applied / failed after. Best-effort - an audit
  // trail, not a gate. Written outside the transaction on purpose: a process
  // that dies mid-push leaves an honest `running` row behind.
  const ledgerId = await startPushRecord(db, {
    workspaceId: pf.workspaceId,
    gitSha: await readGitSha(cwd),
    cliVersion: readCliVersion(),
    plan: planToJson(pf.planToApply, pf.migration),
    statements: pf.migration.statements,
  }, (m) => log.warn(m))

  try {
    await applyPush(db, {
      workspaceId: pf.workspaceId,
      ops: pf.planToApply.operations,
      statements: pf.migration.statements,
      seed: pf.seed,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await finishPushRecord(db, ledgerId, 'failed', message, (m) => log.warn(m))
    console.error(`  ${c.red('✗')}  Push failed - the transaction rolled back, the database is as it was:`)
    for (const line of message.split('\n')) console.error(`     ${line}`)
    process.exitCode = 1
    return { ok: false, error: message }
  }
  await finishPushRecord(db, ledgerId, 'applied', undefined, (m) => log.warn(m))
  printAppliedSteps(pf)

  // The transaction is committed: running APIs may now drop their cached
  // schema. Only when something actually changed.
  if (hasWork) {
    const told = await notifySchemaChanged(db)
    if (!told) log.warn('could not notify running APIs of the schema change - they refresh within a minute, or on restart')
  }

  // Extension push hooks (plan-core-slimming F1): what an extension owns in
  // code (code-first forms in app/forms, say) is upserted by the extension in
  // its own transaction after the schema committed; skipped on a scoped apply.
  if (!opts.scopeType) await runExtensionPushHooks(db, pf)

  // ── Write: the generated files, from the preflight's artifacts ──────────────
  writePushArtifacts(pf.artifacts, pf.contentTablesDir, pf.typesPath)
  log.ok(`content tables → ${pf.contentTablesDir.replace(cwd + '/', '')}/content-tables.ts ${c.dim('(codegen and types; the server builds its tables from the registry)')}`)
  if (pf.artifacts.customTables !== undefined) {
    log.ok(`custom tables → ${pf.contentTablesDir.replace(cwd + '/', '')}/custom-tables.ts`)
  }
  if (pf.artifacts.typesDeclaration !== undefined) {
    log.ok(`types → ${pf.typesPath.replace(cwd + '/', '')} (${pf.localSchema.types.length} content types)`)
  }

  if (!hasWork) {
    log.noChanges()
    if (opts.keepAlive) return { ok: true }
    process.exit(0)
  }

  // Invalidate Redis schema cache (best-effort)
  const redisUrl = pf.deployment.get<boolean>('redis.enabled') === false ? undefined : pf.deployment.secrets.get('redis.url')
  if (redisUrl) {
    const cleared = await invalidateSchemaCache(redisUrl, pf.database.url)
    if (cleared) {
      console.log(`  ${sym.tick}  schema cache invalidated ${c.dim('(running APIs pick this up on their next request - refresh the admin)')}`)
    } else {
      console.log(`  ${sym.warn}  schema cache NOT invalidated ${c.dim(`(redis unreachable at ${redisUrl.replace(/\/\/[^@]*@/, '//***@')}) - restart the API to see schema changes`)}`)
    }
  }

  log.success(pf.role)

  await printSetupHint(pf.deployment, pf.workspaceId)

  if (opts.keepAlive) return { ok: true }
  process.exit(0)
}

/**
 * Runs every declared extension's `push` hook (`afterPush`) with the
 * committed database. One failing hook is reported and skipped; the push
 * itself has already succeeded.
 */
async function runExtensionPushHooks(db: PreflightContext['db'], pf: PreflightContext): Promise<void> {
  let manifests: Awaited<ReturnType<typeof import('./extension-install').loadConfigExtensions>>
  try {
    const { loadConfigExtensions } = await import('./extension-install')
    manifests = await loadConfigExtensions(pf.config, dirname(pf.configPath), { onUnresolved: () => {} })
  } catch { return }
  const entries = ((pf.config as { extensions?: Array<{ resolve?: string; options?: Record<string, unknown> }> }).extensions ?? [])
  for (const manifest of manifests) {
    if (!manifest.push) continue
    try {
      const { importManifestEntry } = await import('../extension-entry')
      const mod = await importManifestEntry(manifest, manifest.push, 'push')
      const hook = (mod?.default ?? mod) as { afterPush?: (ctx: unknown) => Promise<void> | void } | null
      if (typeof hook?.afterPush !== 'function') continue
      const entry = entries.find((e) => e.resolve && (e.resolve === manifest.__pkg || e.resolve.endsWith(`/${manifest.id}`) || e.resolve.endsWith(`ext-${manifest.id}`)))
      await hook.afterPush({ db, workspaceId: pf.workspaceId, configCwd: dirname(pf.configPath), options: entry?.options ?? {}, log })
    } catch (err) {
      log.warn(`extension '${manifest.id}' push hook failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}


/** Post-push setup hint - shown only when the workspace has no members yet. Best-effort. */
async function printSetupHint(deployment: ResolvedDeployment, workspaceId: string): Promise<void> {
  const serverUrl = deployment.get<string>('server.url')
  const setupApiUrl = serverUrl
    ? `${serverUrl.replace(/\/$/, '')}/api/v1/setup/${workspaceId}`
    : null
  if (!setupApiUrl) return
  try {
    const res = await fetch(setupApiUrl)
    if (res.ok) {
      const data = await res.json() as { needsSetup?: boolean }
      if (data.needsSetup) {
        const hintUrl = buildSetupHintUrl(deployment.get<string>('frontend.url'), workspaceId)
        console.log(`  ${sym.bullet}  ${c.yellow('This workspace has no members yet.')}`)
        if (hintUrl) {
          console.log(`     Open the admin panel to complete workspace setup:`)
          console.log(`     ${c.cyan(hintUrl)}`)
        }
        console.log()
      }
    }
  } catch {
    // Network failure - hint is best-effort, never fatal
  }
}

/**
 * Registry-aware push for a child workspace.
 * Looks up the slug in app/config/workspaces.ts, seeds the workspace row in
 * the deployment's database, and shows the setup hint. Skips schema migration - that is the master
 * workspace's responsibility (`tangen push` with no --workspace flag).
 */
export async function runPushForWorkspace(
  slug: string,
  _approvals: string[],
  cwd: string,
): Promise<void> {
  // 1. Load the workspace registry
  const registryPath = resolve(cwd, 'app', 'workspaces', 'index.ts')
  if (!existsSync(registryPath)) {
    throw new Error('No workspace registry found. Expected: app/workspaces/index.ts')
  }

  let definitions: Pick<WorkspaceDefinition, 'id' | 'name' | 'slug'>[]
  try {
    const mod = await import(registryPath)
    definitions = mod.default as WorkspaceDefinition[]
  } catch {
    throw new Error('Could not load workspace registry from app/workspaces/index.ts')
  }

  const resolved = resolveWorkspaceConfigPath(slug, definitions, cwd)
  if (!resolved) {
    const available = definitions.map(d => d.slug).join(', ')
    throw new Error(`Workspace "${slug}" not found in registry. Available: ${available}`)
  }

  const { def, configDir } = resolved
  // Master dir keeps the tangen.config.ts adapter; workspace dirs use workspace.config.ts
  const configPath = existsSync(resolve(configDir, 'workspace.config.ts'))
    ? resolve(configDir, 'workspace.config.ts')
    : resolve(configDir, 'tangen.config.ts')

  let config: any
  try {
    const mod = await import(configPath)
    config = mod.default
  } catch {
    throw new Error(`Could not load config for workspace "${slug}" from ${configPath}`)
  }

  const database = resolveDeploymentDatabase()
  const workspaceId = def.id
  const role = deploymentRole()

  log.header(workspaceId, role)

  const { createDb } = await import('@tangen/db')
  const db = createDb(database.url)

  // 3. Seed the workspace row (idempotent - no schema diff for child workspaces)
  await ensureWorkspace(db, workspaceId, '', def.name)

  log.ok(`Workspace "${def.name}" registered`)
  log.info('Registration only: schema is deployed by `tangen push` run from the project that owns the types.')

  // 4. Setup hint (best-effort)
  await printSetupHint(resolveProjectDeployment({ project: { workspaceId, config: config as never }, role }), workspaceId)
}
