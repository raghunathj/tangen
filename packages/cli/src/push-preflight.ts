/**
 * File Name: push-preflight.ts
 * Purpose: Everything `tangen push` decides BEFORE it changes anything, as one
 *          exported function: the config, the schema type-check, every schema
 *          validator, the runtime registry (read-only), the content plan and its
 *          scope, the destructive classification, every migration statement the
 *          apply will run (with the steps that used to fail at apply time
 *          pre-validated), and the full codegen to memory (content-tables,
 *          custom-tables, tangen-types.d.ts). `push`, `push --plan`, `tangen
 *          diff` and the Schema Builder's save all call this one function, so
 *          the preview, the refusal and the apply read the same facts. The
 *          database is opened for SELECTs only: nothing here writes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The builder passes a `candidate` (the types as they will
 *          be after its write) so the schema is refused BEFORE the file lands.
 *          The apply phase (push.ts + apply.ts) consumes the returned context;
 *          the generated files are written only after that apply committed.
 */
import { resolveProjectDeployment, type ResolvedDeployment } from '@tangen/types'
import { resolveDeploymentDatabase, describeDatabaseError, deploymentRole, type DeploymentDatabase } from './deployment-database'
import { resolve, join } from 'node:path'
import type { SchemaDefinition, ObjectTypeDefinition, TangenConfig, CustomTableDefinition } from '@tangen/types'
import type { DbClient } from '@tangen/db'
import { acquirePushLock, PushLockBusyError, type PushLock } from './push-lock'
import {
  validateContainerEmptiness, validateFieldConfigs, validateCrossReferences, validateColumnNamespace, findTypeNameCollisions,
} from '@tangen/schema'
import { loadLocalSchema, loadRuntimeSchema, loadLocalGlobals, loadLocalTables, loadLocalIds } from './schema-loader'
import { findPreviousNameCollisions, loadExtensionTypes, mergeDeclaredTypes, type MergedSchema } from './extension-schema'
import { diff, identityConflicts, ambiguousFieldRenames, renameGuardCommand, dropTypeBlockers } from './diff'
import { computeScopedTypes, filterPlanToTypes, affectedTypeNames, overlaySchema, scopedLocalSchema } from './scoped-apply'
import { checkMigrationSafety, type PushSeed, type SafetyGate } from './apply'
import { evaluateDestructivePolicy, filterApprovedOps, type DestructiveReport } from './destructive-policy'
import { verifyPushHistory, type PushHistory } from './push-history'
import {  planFlags } from './plan-ops'
import { buildMigrationPlan, countDestruction, readCustomTableOwners, tableExists, type MigrationPlan } from './migration-plan'
import { normalizeCustomTables, ownershipConflicts, versionSkew, orphanedCustomTables, type NormalizedCustomTable } from './custom-table-owner'
import { loadExtensionCustomTables } from './extension-schema'
import { planComponentRenames } from './component-migration'
import { componentRenameConflicts } from '@tangen/schema'
import { generatePushArtifacts, type PushArtifacts } from './push-pipeline'
import { resolveContentTablesDir } from './codegen'
import type { ChangePlan, RuntimeSchema } from './types'
import { runSchemaCheck, onlyGeneratedDiagnostics } from './commands/check'
import { resolveEffectiveConfig, gatherCustomTables, deriveWorkspaceId } from './commands/push-config'
import type { DeploymentRole } from '@tangen/types'
import { idIssue, findIdCollision } from '@tangen/types'
import { flattenGroupFields } from '@tangen/schema'

/** The project a preflight runs for. */
export interface PreflightProject {
  /** Directory holding tangen.config.ts. */
  cwd: string
  /** Explicit workspace id (the CLI's resolved one); derived from the config otherwise. */
  workspaceId?: string
}

/** The schema as it will be after a write the caller has not made yet (the builder's save). */
export interface SchemaCandidate {
  /** Types to add or replace (by name) on top of the local code. */
  types?: ObjectTypeDefinition[]
  /** Type names removed from the local code. */
  remove?: string[]
}

export interface PreflightOptions {
  /** `--type`: a comma-separated scope. */
  scopeType?: string
  /** `--approve <token>`, one per destructive operation; unapproved ones are left out and reported. */
  approvals?: string[]
  /** The builder's not-yet-written schema, overlaid on the local code. */
  candidate?: SchemaCandidate
  /** Run the schema type-check (tsc). Default true; a candidate is not on disk, so the builder skips it. */
  check?: boolean
  /** An already-open client (tests); the preflight opens one from the env config otherwise. */
  db?: DbClient
  /**
   * Take the schema-mutation lock before reading schema state (C1).
   *
   * TRUE whenever this preflight may lead to an apply. False for `--plan`,
   * `diff` and the builder's candidate check, which write nothing: making a
   * read-only preview block a real push would be a worse tool.
   *
   * The caller owns the returned `lock` and must release it.
   */
  lock?: boolean
}

export type PreflightStage = 'config' | 'check' | 'namespace' | 'scope' | 'validate' | 'prevalidate' | 'generate'

export interface PreflightFailure {
  ok: false
  stage: PreflightStage
  /** The headline the CLI prints before the error lines. */
  title: string
  errors: string[]
  /** Set when the failure happened after the database was opened. */
  db?: DbClient
}

export interface CrossReferenceWarning {
  at: string
  kind: string
  reference: string
  suggestion?: string
}

/** Everything the apply and the printers need, all decided, nothing applied. */
export interface PreflightContext {
  ok: true
  cwd: string
  configPath: string
  config: TangenConfig
  /** The deployment's database (DATABASE_URL). */
  database: DeploymentDatabase
  /** The resolved deployment (core keys), for the Redis binding. */
  deployment: ResolvedDeployment
  /** The deployment role of THIS process (TANGEN_DEPLOYMENT_ROLE, else NODE_ENV): what push safety keys on. */
  role: DeploymentRole
  workspaceId: string
  db: DbClient
  /** True when the caller supplied the client (tests): the apply then cannot open the migrator's own connection. */
  dbInjected: boolean
  /** Held when `opts.lock` was set. The caller releases it, in a finally. */
  lock?: PushLock
  localSchema: SchemaDefinition
  /** Where each type in `localSchema` came from: the site's code, or which extension. */
  provenance: MergedSchema
  runtimeSchema: RuntimeSchema
  /** The local types the validators and the identity/i18n planners cover (scoped on --type). */
  validationSchema: SchemaDefinition
  /** The schema the generated Drizzle file is built from (runtime + overlay on --type). */
  artifactSchema: SchemaDefinition
  /** Every content change between local code and the registry. */
  fullPlan: ChangePlan
  /** The plan for this push (scoped on --type). Shown by --plan. */
  plan: ChangePlan
  /** The plan the apply runs: `plan` minus the destructive ops not approved (and every destructive op in production). */
  planToApply: ChangePlan
  /** Out-of-sync dependency types a scoped apply pulled in. */
  scopeExtras: string[]
  /** The gate when the plan needs approvals it was not given, or the deployment role refuses; null otherwise. */
  gate: SafetyGate | null
  /** Every destructive operation in the plan, as the policy reports it (token, object, rows, guarded). */
  destructive: DestructiveReport[]
  /** The push ledger, re-fingerprinted: the apply refuses when a row does not verify. */
  history: PushHistory
  /** Every statement beyond the content ops, the notes, and the (empty) pre-validation errors. */
  migration: MigrationPlan & { singletonIds: Map<string, string>; i18nTables: string[] }
  artifacts: PushArtifacts
  contentTablesDir: string
  typesPath: string
  warnings: CrossReferenceWarning[]
  /** Custom tables whose recorded extension owner no longer declares them. Informational: nothing is dropped. */
  customTableOrphans: Array<{ table: string; owner: string }>
  /** The same custom tables with their owner attached, for the plan to print. */
  normalizedCustomTables?: NormalizedCustomTable[]
  seed: PushSeed
  gatheredCustomTables: CustomTableDefinition[] | undefined
  registry: Array<Record<string, unknown>>
  /** True when no tsconfig.schema.json was found or the check was skipped by option. */
  checkSkipped: boolean
  /** True when the type-check failed only inside generated/ - the file this push rewrites. */
  generatedStale: boolean
}

export type PreflightResult = PreflightContext | PreflightFailure

/** The local schema with a candidate overlaid: replace or add by name, then remove. Pure. */
export function applyCandidate(schema: SchemaDefinition, candidate: SchemaCandidate | undefined): SchemaDefinition {
  if (!candidate) return schema
  const remove = new Set(candidate.remove ?? [])
  const byName = new Map(schema.types.map((t) => [t.name, t]))
  for (const t of candidate.types ?? []) byName.set(t.name, t)
  for (const name of remove) byName.delete(name)
  return { ...schema, types: [...byName.values()] }
}

/**
 * Loads the config with the same short retry push always had: the admin's
 * deferred schema writes can have the import graph mid-rewrite for a moment.
 */
async function loadConfig(configPath: string): Promise<{ config: TangenConfig | null; error: unknown }> {
  let error: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const mod = await import(`${configPath}?t=${Date.now()}`)
      return { config: mod.default as TangenConfig, error: null }
    } catch (e) {
      error = e
      await new Promise((r) => setTimeout(r, 700))
    }
  }
  return { config: null, error }
}

function fail(stage: PreflightStage, title: string, errors: string[], db?: DbClient): PreflightFailure {
  return { ok: false, stage, title, errors, ...(db ? { db } : {}) }
}

/**
 * The whole decision for one push, read-only. Returns the context the apply
 * phase runs, or the first failure with the lines to print.
 */
export async function preflight(
  project: PreflightProject,
  opts: PreflightOptions = {},
): Promise<PreflightResult> {
  const cwd = project.cwd
  const configPath = resolve(cwd, 'tangen.config.ts')

  // ── Config ──────────────────────────────────────────────────────────────────
  const loaded = await loadConfig(configPath)
  if (!loaded.config) {
    const cause = loaded.error instanceof Error && loaded.error.message ? [loaded.error.message] : []
    return fail('config', `Could not load tangen.config.ts from ${cwd}`, cause)
  }
  let config: TangenConfig
  try {
    config = await resolveEffectiveConfig(cwd, loaded.config)
  } catch (e) {
    return fail('config', 'Could not load the workspace config', [e instanceof Error ? e.message : String(e)])
  }
  // The deployment's database. A caller that hands in an open client (tests,
  // the Schema Builder) has already chosen it; the URL then only names it.
  let database: DeploymentDatabase
  try {
    database = resolveDeploymentDatabase()
  } catch (e) {
    if (!opts.db) return fail('config', 'This deployment has no database', [describeDatabaseError(e)])
    database = { url: '', source: 'DATABASE_URL' }
  }
  const workspaceId = deriveWorkspaceId(config, project.workspaceId)
  // The deployment role of THIS process: what push safety keys on.
  const role = deploymentRole()
  // The resolved deployment (core keys only: the CLI knows no extension manifests), for the Redis binding push invalidates.
  const deployment = resolveProjectDeployment({
    project: { workspaceId, config: config as never, siteConfig: config.siteConfig, integrations: (config as { integrations?: unknown }).integrations as never },
    role,
  })

  // ── Type-check ──────────────────────────────────────────────────────────────
  let checkSkipped = opts.check === false
  let generatedStale = false
  if (opts.check !== false) {
    const check = await runSchemaCheck(cwd)
    checkSkipped = check.skipped === true
    if (!check.ok) {
      // Errors confined to the generated file are the file being older than
      // the codegen that is about to rewrite it - not a schema problem.
      if (onlyGeneratedDiagnostics(check.output)) generatedStale = true
      else return fail('check', 'Schema type errors found', check.output.trim().split('\n'))
    }
  }

  // ── Local schema (+ what the extensions declare, + the builder's candidate) ─
  // Extension-provisioned types join the site's here and nowhere else, so every
  // stage below - the validators, the plan, the migration, the codegen, the
  // apply - sees ONE schema and there is exactly one provisioning path.
  let localSchema: SchemaDefinition
  let merged: MergedSchema
  try {
    const site = await loadLocalSchema(configPath)
    merged = mergeDeclaredTypes(site, await loadExtensionTypes(cwd, config as never))
    localSchema = applyCandidate(merged.schema, opts.candidate)
  } catch (e) {
    return fail('config', 'Could not load the local schema', [e instanceof Error ? e.message : String(e)])
  }

  const seeds = opts.scopeType ? opts.scopeType.split(',').map((s) => s.trim()).filter(Boolean) : []
  const registry = ((config as any).components ?? []) as Array<Record<string, unknown>>

  // One name per column per type - checked on the code alone, before the
  // database is even opened.
  {
    const namespaceTypes = opts.scopeType ? localSchema.types.filter((t) => seeds.includes(t.name)) : localSchema.types
    const collisions = validateColumnNamespace(namespaceTypes as never)
    if (collisions.length > 0) return fail('namespace', 'Field names collide on their table column:', collisions)

    const rowClashes = findPreviousNameCollisions(localSchema)
    if (rowClashes.length > 0) return fail('validate', 'Two declared types would claim the same registry row:', rowClashes)

    // Every name this push would turn into a database identifier (Phase 6B,
    // Unit 7): letters, digits and underscore, at most 63 bytes - PostgreSQL
    // truncates a longer one, so two fields could become one column - and
    // outside the namespaces the platform reserves. Existing names are not
    // revalidated: this is the rule for what a push CREATES.
    const idIssues: string[] = []
    for (const type of namespaceTypes) {
      const typeIssue = idIssue(type.name, 'content type name')
      if (typeIssue) idIssues.push(typeIssue)
      for (const f of flattenGroupFields((type.fields ?? []) as never)) {
        const fieldIssue = idIssue(f.name, `field name on "${type.name}"`)
        if (fieldIssue) idIssues.push(fieldIssue)
      }
      const collision = findIdCollision(flattenGroupFields((type.fields ?? []) as never).map((f) => String(f.name)))
      if (collision) idIssues.push(`"${collision.a}" and "${collision.b}" on "${type.name}" are the same column once PostgreSQL truncates them to 63 bytes`)
    }
    if (idIssues.length > 0) return fail('validate', 'A name this push would create is not a usable database identifier:', idIssues)
  }

  // ── The database, read-only ──────────────────────────────────────────────
  let db = opts.db
  if (!db) {
    const { createDb } = await import('@tangen/db')
    db = createDb(database.url)
  }


  // ── The migration lock (C1) ────────────────────────────────────────────────
  // Taken BEFORE the registry is read, not around the apply: a plan computed
  // from a stale read is the defect, and a correct transaction executing wrong
  // statements is no better than a torn one.
  // Released by `failLocked` on any failure below, and by the caller on
  // success. A lock that outlives its push blocks the next one for nothing.
  let lock: PushLock | undefined
  const failLocked = (stage: PreflightStage, title: string, errors: string[], d?: DbClient): PreflightFailure => {
    void lock?.release()
    return fail(stage, title, errors, d)
  }
  if (opts.lock) {
    try {
      lock = await acquirePushLock(database.url, workspaceId)
    } catch (e) {
      if (e instanceof PushLockBusyError) {
        return fail('config', 'Another schema change is in progress', [e.message], db)
      }
      return fail('config', 'Could not take the schema migration lock', [
        e instanceof Error ? e.message : String(e),
      ], db)
    }
  }

  let runtimeSchema: RuntimeSchema
  try {
    runtimeSchema = await loadRuntimeSchema(db)
  } catch (e) {
    return failLocked('config', 'Could not read the schema registry', [
      e instanceof Error ? e.message : String(e),
      'A database that was never migrated has no registry - run tangen bootstrap (or bun run db:migrate) first.',
    ], db)
  }
  // ── Identity, before any DDL is planned (C3) ───────────────────────────────
  // A duplicate, malformed or reused stable id makes "is this a rename or a
  // delete" unanswerable, and the wrong answer destroys a table. Fail closed.
  const idProblems = identityConflicts(localSchema, runtimeSchema)
  if (idProblems.length > 0) {
    return failLocked('validate', 'Schema identity is ambiguous, so nothing was planned', idProblems, db)
  }

  const fullPlan = diff(localSchema, runtimeSchema)

  // A drop-and-add pair of the same shape on one type is a rename whose
  // previousName was forgotten. Fields carry no stable id, so this cannot be
  // resolved by identity: refuse rather than drop a populated column on a
  // guess. A drop approved BY NAME resolves its pair (the developer decided
  // on that delete; the drop is guarded and recoverable anyway), and the
  // message prints that exact command (the user, 2026-09-13).
  const ambiguous = ambiguousFieldRenames(fullPlan.operations, opts.approvals ?? [])
  if (ambiguous.length > 0) {
    const command = renameGuardCommand(fullPlan.operations, opts.approvals ?? [])
    return failLocked('validate', 'A field rename looks like a drop, so nothing was planned', [
      ...ambiguous,
      'If they are renames, add previousName as above and push again; the data moves with the column.',
      'If they are not (a delete plus a new field), approve each drop by name - the column is kept aside as a guarded drop, recoverable until purged:',
      ...(command ? [`  ${command}`] : []),
    ], db)
  }

  // ── Scope (--type) ──────────────────────────────────────────────────────────
  let plan = fullPlan
  let scopeExtras: string[] = []
  let validationSchema = localSchema
  let artifactSchema = localSchema
  if (opts.scopeType) {
    for (const seed of seeds) {
      if (!localSchema.types.some((t) => t.name === seed) && !runtimeSchema.types.some((t) => t.name === seed)) {
        return fail('scope', `--type "${seed}" is not a content type in this project`, [], db)
      }
    }
    const { scoped, extras } = computeScopedTypes(seeds, localSchema, affectedTypeNames(fullPlan))
    plan = filterPlanToTypes(fullPlan, scoped)
    scopeExtras = extras
    validationSchema = scopedLocalSchema(localSchema, scoped)
    artifactSchema = overlaySchema(runtimeSchema, localSchema, scoped)
  }

  // ── Validators ──────────────────────────────────────────────────────────────
  {
    const blockers = dropTypeBlockers(validationSchema, plan.operations, registry as never)
    if (blockers.length > 0) return fail('validate', 'Cannot drop type(s) - relation fields still reference them:', blockers, db)

    const collisions = findTypeNameCollisions(validationSchema.types as never)
    if (collisions.length > 0) {
      return failLocked('validate', 'Type names collide on their GraphQL object type (names are singular-normalized):',
        collisions.map((col) => `${col.names.map((n) => `"${n}"`).join(' and ')} → ${col.graphqlType} - rename one`), db)
    }

    const empties = validateContainerEmptiness(validationSchema.types as never, registry as never)
    if (empties.length > 0) return fail('validate', 'Empty containers are not allowed:', empties, db)

    const badConfigs = validateFieldConfigs(validationSchema.types as never, registry as never)
    if (badConfigs.length > 0) return fail('validate', 'Invalid field configuration:', badConfigs, db)
  }

  // Dangling cross-type references are a warning, not a blocker.
  const knownTypeNames = [...localSchema.types, ...runtimeSchema.types].map((t) => t.name)
  const warnings = validateCrossReferences(validationSchema.types as never, registry as never, knownTypeNames) as CrossReferenceWarning[]

  // ── Component data migrations ───────────────────────────────────────────────
  // Declared by `previousName` in a component definition; there is no component
  // registry in the database, so nothing else could tell the planner that two
  // stored keys are the same field. Skipped on a scoped push: a component is
  // not owned by one content type, so `--type` cannot bound it.
  {
    const renameProblems = (registry as never as Array<{ name: string }>).flatMap((c) => componentRenameConflicts(c as never))
    if (renameProblems.length > 0) {
      return failLocked('validate', 'Component rename intent cannot be trusted:', renameProblems, db)
    }
  }
  if (!opts.scopeType) {
    const componentOps = await planComponentRenames(db, validationSchema as never, registry as never)
    if (componentOps.length > 0) {
      plan = { ...plan, operations: [...plan.operations, ...componentOps], ...planFlags([...plan.operations, ...componentOps]) }
    }
  }

  // ── Migration risk (C2) ─────────────────────────────────────────────────────
  // The preview counts what a destructive op would remove. SELECTs only, and a
  // failure to count is never a failure to push.
  const runtimeNameOf = new Map(runtimeSchema.types.map((t: any) => [t.id, t.name]))
  const counts = await countDestruction(db, plan.operations, (id: string) => runtimeNameOf.get(id) ?? id)
  const approvals = opts.approvals ?? []
  const gate = checkMigrationSafety(plan, { approvals, role }, counts)
  const destructive = evaluateDestructivePolicy(plan, { approvals, counts, role }).report
  const planToApply = filterApprovedOps(plan, approvals, role)

  // ── Workspace-wide inputs (skipped on a scoped apply) ───────────────────────
  // ── Custom tables, with ownership ───────────────────────────────────────────
  // Site declarations and the custom tables of ENABLED extensions become one
  // normalized list. Extensions declare structure; nothing here lets them plan,
  // execute or own anything Tangen has not agreed to.
  let gatheredCustomTables: NormalizedCustomTable[] | undefined
  let customTableOrphans: Array<{ table: string; owner: string }> = []
  if (!opts.scopeType) {
    const siteTables = await gatherCustomTables(cwd, config.customTables) as CustomTableDefinition[]
    const extTables = await loadExtensionCustomTables(cwd, config as never)

    const skew = versionSkew(extTables)
    if (skew.length > 0) {
      return failLocked('validate', 'One extension is resolved at two versions and both declare custom tables:', skew, db)
    }
    const { tables, errors: ownErrors } = normalizeCustomTables(siteTables, extTables)
    if (ownErrors.length > 0) return failLocked('validate', 'Custom table ownership is ambiguous:', ownErrors, db)

    const recorded = await readCustomTableOwners(db)
    const existing = new Set<string>()
    for (const t of tables) if (await tableExists(db, t.table.name)) existing.add(t.table.name)
    const conflicts = ownershipConflicts(tables, recorded, (n) => existing.has(n))
    if (conflicts.length > 0) return failLocked('validate', 'Custom table ownership conflict:', conflicts, db)

    customTableOrphans = orphanedCustomTables(tables, recorded)
    gatheredCustomTables = tables
  }

  // ── Every statement the apply will run, pre-validated ───────────────────────
  const migration = await buildMigrationPlan(db, {
    workspaceId,
    ops: planToApply.operations,
    runtime: runtimeSchema,
    schema: validationSchema as never,
    registry,
    localization: (config as any).localization?.enabled === true,
    customTables: gatheredCustomTables,
  })
  if (migration.errors.length > 0) {
    return failLocked('prevalidate', 'The push would fail while migrating - fix these first (nothing was applied):', migration.errors, db)
  }

  // ── Codegen to memory ───────────────────────────────────────────────────────
  let artifacts: PushArtifacts
  try {
    const [globals, tables, ids] = await Promise.all([loadLocalGlobals(configPath), loadLocalTables(configPath), loadLocalIds(configPath)])
    // Codegen wants the definitions; ownership is a planning concern. Extension
    // tables are included, so a site developer gets types for them too.
    artifacts = generatePushArtifacts(artifactSchema, registry, gatheredCustomTables?.map((t) => t.table), {
      schema: localSchema, globals, tables, locales: ids.locales, roles: ids.roles, extensions: ids.extensions,
    }, { workspaceId })
  } catch (e) {
    return failLocked('generate', 'Nothing applied - the generated schema could not be produced:', [e instanceof Error ? e.message : String(e)], db)
  }

  const projectName = config.project ?? ''
  const displayName = (config as any).name as string | undefined
  const wsName = displayName
    ?? (projectName ? projectName.charAt(0).toUpperCase() + projectName.slice(1).replace(/_/g, ' ') : workspaceId)
  // The ledger's own integrity, read here so nothing has run when it fails.
  const history = await verifyPushHistory(db)

  const seed: PushSeed = {
    workspace: { id: workspaceId, name: wsName, slug: workspaceId.replace(/^wsp_/, '').replace(/_/g, '-') },
  }

  return {
    ok: true,
    cwd,
    configPath,
    config,
    role,
    database,
    deployment,
    lock,
    workspaceId,
    db,
    dbInjected: opts.db !== undefined,
    localSchema,
    provenance: merged,
    runtimeSchema,
    validationSchema,
    artifactSchema,
    fullPlan,
    plan,
    planToApply,
    scopeExtras,
    gate,
    destructive,
    history,
    migration,
    artifacts,
    contentTablesDir: resolveContentTablesDir(cwd, cwd),
    typesPath: join(cwd, 'generated', 'tangen-types.d.ts'),
    warnings,
    customTableOrphans,
    seed,
    gatheredCustomTables: gatheredCustomTables?.map((t) => t.table),
    normalizedCustomTables: gatheredCustomTables,
    registry,
    checkSkipped,
    generatedStale,
  }
}
