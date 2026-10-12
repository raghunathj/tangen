/**
 * File Name: schema-write.ts
 * Purpose: SB-2 — the dev-only schema-write API for the Content Object Builder.
 *   Create/update/delete a content type → run the push preflight on the schema
 *   as it will be (read-only; a refusal is a 422 and nothing is written), then
 *   write app/content-objects/<name>/schema.ts (+ barrel) and trigger
 *   `tangen push`. Hard-gated: refuses (403) unless the runtime is
 *   schema-writable (dev + writable source), and requires the `manage:settings`
 *   capability. The UI gate is only a reflection of this.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Elysia } from 'elysia'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { getSchemaWritable, findAppContentDir, findAppComponentsDir, findAppGlobalsDir } from '../../lib/schema-writable'
import { writeContentType, deleteContentType, writeComponent, deleteComponent, writeGlobals, upsertGlobal, removeGlobal, assertSafeName } from '../../services/schema-writer'
import { generateObjectTypeSource, generateComponentSource } from '@tangen/schema'
import { trackPush, getPushRun, newPushRunId, ensurePushRunDir, readDiskRun } from '../../services/push-tracker'
import type { CodegenObjectType, CodegenComponent, CodegenGlobal } from '@tangen/schema'
import { RESERVED_FIELD_NAMES } from '@tangen/types'
import { relationFieldsTargeting, componentRelationRefsTargeting } from '../../services/relation-integrity'
import { validateContainerEmptiness, validateColumnNamespace, componentRenameConflicts } from '@tangen/schema'
import { deploymentRole, deploymentPolicy, type DeploymentRole } from '../../lib/deployment-role'

export interface PushResult { ok: boolean; output?: string }

/** A dry-run preview of what `tangen push` WOULD do — used to warn, before an Apply,
 *  that other types (a colleague's WIP pulled from git, an unrelated edit) also have
 *  pending changes that the whole-codebase push would apply. `ok:false` = couldn't
 *  compute (never blocks the Apply; the warning just doesn't show). */
export interface PlanPreview {
  ok: boolean
  affectedTypes: string[]
  hasDestructive: boolean
  counts?: { added: number; changed: number; removed: number }
  /** Scoped preview only: out-of-sync dependency types pulled into a `--type` apply. */
  extraTypes?: string[]
}

/** The schema as it will be after a write the builder has not made yet. */
export interface SchemaCandidate {
  types?: CodegenObjectType[]
  remove?: string[]
}

/**
 * The push preflight's verdict on a candidate schema: `ran:false` means the CLI could
 * not be executed at all (its output says why); `ok:false` carries the refusal the
 * CLI would print. The builder refuses to write the file in either case.
 */
export interface PreflightOutcome {
  ran: boolean
  ok: boolean
  stage?: string
  title?: string
  errors?: string[]
  output?: string
  /** Every destructive operation the plan holds, with the approval token the push needs for it (C2). */
  destructive?: Array<{ token: string; type: string | null; field: string | null }>
}

/** Injectable dependencies (real ones in production; stubs in tests). */
export interface SchemaWriteDeps {
  isWritable: () => boolean
  /**
   * The semantic role of the request's environment (Phase 5A, Unit 6):
   * schema writes are development-only tooling, refused for staging,
   * production and an unknown role before any handler runs.
   */
  /** The deployment role of this process; a test may inject one. */
  role?: () => DeploymentRole
  resolveAppContentDir: () => string | null
  resolveAppComponentsDir: () => string | null
  resolveAppGlobalsDir: () => string | null
  /** `scopeType` → a SCOPED `push --type <name>` (apply only that type + its out-of-sync deps). */
  push: (appContentDir: string, runId: string, approvals?: string[], scopeType?: string) => Promise<PushResult>
  /** Dry-run `tangen push [--type <t>] --plan --json` → the affected/extra-types preview. */
  planPreview: (appContentDir: string, scopeType?: string) => Promise<PlanPreview>
  /**
   * The push preflight over a candidate (`tangen push --plan --json --candidate <file>`):
   * validators, the plan, the migration pre-validation and the full codegen, all read-only,
   * on the schema AS IT WILL BE after the write. Absent in tests that do not care.
   */
  preflight?: (appContentDir: string, candidate: SchemaCandidate, opts: { scopeType?: string; approvals?: string[] }) => Promise<PreflightOutcome>
  /** Delay before touching watched files, letting the HTTP response flush (tests: 0). */
  flushDelayMs?: number
}

/**
 * Best-effort `tangen push` from the app root. Never throws.
 *
 * DEV-RESTART SURVIVAL: on a dev server (bun --watch) the schema write restarts THIS
 * process, killing anything tied to it. So the push runs as a DETACHED shell that
 * records its output + exit code under PUSH_RUN_DIR keyed by the run id — the restarted
 * server answers status polls from those files (see readDiskRun). The returned promise
 * (used when no restart happens) polls the same status file.
 */
export async function spawnPush(appContentDir: string, runId: string, approvals: string[] = [], scopeType?: string): Promise<PushResult> {
  const appRoot = dirname(appContentDir) // <root>/app (holds tangen.config.ts)
  const repoRoot = dirname(appRoot)
  const monorepoCli = join(repoRoot, 'packages', 'cli', 'src', 'index.ts')
  // C2: one --approve per destructive operation the caller decided on; never a blanket flag.
  const confirmFlag = approvals.map((a) => ` --approve ${JSON.stringify(a)}`).join('')
  // --type scopes the apply to one content type (+ its out-of-sync deps).
  const typeFlag = scopeType ? ` --type ${JSON.stringify(scopeType)}` : ''
  const cmd = existsSync(monorepoCli)
    ? `bun ${JSON.stringify(monorepoCli)} push${confirmFlag}${typeFlag}`
    : `tangen push${confirmFlag}${typeFlag}`
  const runDir = ensurePushRunDir()
  const logFile = join(runDir, `${runId}.log`)
  const statusFile = join(runDir, `${runId}.status`)
  return new Promise<PushResult>((resolvePromise) => {
    try {
      writeFileSync(logFile, '') // marks the run as started (disk fallback → "running")
      // The wrapper sleeps first: it is spawned BEFORE the schema files are written (a
      // spawn after the write races the dev-watch restart and loses), so it waits for
      // the write that happens right after it starts.
      const script = `sleep 1; ${cmd} > ${JSON.stringify(logFile)} 2>&1; echo $? > ${JSON.stringify(statusFile)}`
      const child = spawn('sh', ['-c', script], { cwd: appRoot, detached: true, stdio: 'ignore' })
      child.unref()
      child.on('error', (e) => resolvePromise({ ok: false, output: String(e) }))
      const startedAt = Date.now()
      const timer = setInterval(() => {
        if (existsSync(statusFile)) {
          clearInterval(timer)
          let code = ''
          let output: string | undefined
          try { code = readFileSync(statusFile, 'utf8').trim() } catch { /* keep '' → failed */ }
          try { output = readFileSync(logFile, 'utf8').slice(-4000) } catch { /* no log */ }
          resolvePromise({ ok: code === '0', output })
        } else if (Date.now() - startedAt > 10 * 60_000) {
          clearInterval(timer)
          resolvePromise({ ok: false, output: 'push timed out after 10 minutes' })
        }
      }, 500)
      ;(timer as any).unref?.()
    } catch (e) {
      resolvePromise({ ok: false, output: String(e) })
    }
  })
}

/**
 * Dry-run `tangen push --plan --json` from the app root and parse the
 * plan JSON. Unlike {@link spawnPush} this WRITES NOTHING (so no dev-restart dance) — it
 * captures stdout directly. `printPlanJson` prints the plan object to stdout while
 * warnings go to stderr, but we still slice from the first `{` to the last `}` so any
 * stray log can't break the parse. Never throws — a failure yields `ok:false`.
 */
export async function spawnPlanPreview(appContentDir: string, scopeType?: string): Promise<PlanPreview> {
  const appRoot = dirname(appContentDir)
  const repoRoot = dirname(appRoot)
  const monorepoCli = join(repoRoot, 'packages', 'cli', 'src', 'index.ts')
  const typeFlag = scopeType ? ` --type ${JSON.stringify(scopeType)}` : ''
  const cmd = existsSync(monorepoCli)
    ? `bun ${JSON.stringify(monorepoCli)} push --plan --json${typeFlag}`
    : `tangen push --plan --json${typeFlag}`
  const fail = { ok: false, affectedTypes: [], hasDestructive: false }
  return new Promise<PlanPreview>((resolvePromise) => {
    try {
      const child = spawn('sh', ['-c', cmd], { cwd: appRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      let out = ''
      child.stdout?.on('data', (d) => { out += d.toString() })
      child.on('error', () => resolvePromise(fail))
      child.on('close', () => {
        const start = out.indexOf('{')
        const end = out.lastIndexOf('}')
        if (start === -1 || end <= start) return resolvePromise(fail)
        try {
          const json = JSON.parse(out.slice(start, end + 1)) as { affectedTypes?: string[]; extraTypes?: string[]; hasDestructive?: boolean; counts?: PlanPreview['counts'] }
          resolvePromise({ ok: true, affectedTypes: json.affectedTypes ?? [], hasDestructive: !!json.hasDestructive, counts: json.counts, ...(json.extraTypes ? { extraTypes: json.extraTypes } : {}) })
        } catch {
          resolvePromise(fail)
        }
      })
      setTimeout(() => { try { child.kill() } catch { /* already gone */ } resolvePromise(fail) }, 60_000).unref?.()
    } catch {
      resolvePromise(fail)
    }
  })
}

/**
 * The push preflight on a not-yet-written schema: writes the candidate to the push run
 * dir and runs `tangen push --plan --json --candidate <file>`. The CLI
 * loads the code on disk, overlays the candidate, and answers with the same JSON `--plan`
 * prints: `{ ok: false, stage, title, errors }` when it refuses. Never throws; a CLI that
 * could not run answers `ran: false` with the captured output.
 */
export async function spawnPreflight(appContentDir: string, candidate: SchemaCandidate, opts: { scopeType?: string; approvals?: string[] } = {}): Promise<PreflightOutcome> {
  const appRoot = dirname(appContentDir)
  const repoRoot = dirname(appRoot)
  const monorepoCli = join(repoRoot, 'packages', 'cli', 'src', 'index.ts')
  const runDir = ensurePushRunDir()
  const candidateFile = join(runDir, `${newPushRunId()}.candidate.json`)
  const typeFlag = opts.scopeType ? ` --type ${JSON.stringify(opts.scopeType)}` : ''
  const confirmFlag = (opts.approvals ?? []).map((a) => ` --approve ${JSON.stringify(a)}`).join('')
  const base = existsSync(monorepoCli) ? `bun ${JSON.stringify(monorepoCli)} push` : 'tangen push'
  const cmd = `${base} --plan --json${typeFlag}${confirmFlag} --candidate ${JSON.stringify(candidateFile)}`
  return new Promise<PreflightOutcome>((resolvePromise) => {
    let settled = false
    const done = (o: PreflightOutcome) => { if (!settled) { settled = true; try { rmSync(candidateFile, { force: true }) } catch { /* gone */ } resolvePromise(o) } }
    try {
      writeFileSync(candidateFile, JSON.stringify(candidate))
      const child = spawn('sh', ['-c', cmd], { cwd: appRoot, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      child.stdout?.on('data', (d) => { out += d.toString() })
      child.stderr?.on('data', (d) => { err += d.toString() })
      child.on('error', (e) => done({ ran: false, ok: false, output: String(e) }))
      child.on('close', () => {
        const start = out.indexOf('{')
        const end = out.lastIndexOf('}')
        if (start === -1 || end <= start) return done({ ran: false, ok: false, output: (out + err).slice(-4000) })
        try {
          const json = JSON.parse(out.slice(start, end + 1)) as { ok?: boolean; stage?: string; title?: string; errors?: string[]; destructive?: PreflightOutcome['destructive'] }
          if (json.ok === false) return done({ ran: true, ok: false, stage: json.stage, title: json.title, errors: json.errors ?? [] })
          done({ ran: true, ok: true, destructive: json.destructive ?? [] })
        } catch {
          done({ ran: false, ok: false, output: (out + err).slice(-4000) })
        }
      })
      setTimeout(() => { try { child.kill() } catch { /* already gone */ } done({ ran: false, ok: false, output: 'preflight timed out after 120 seconds' }) }, 120_000).unref?.()
    } catch (e) {
      done({ ran: false, ok: false, output: String(e) })
    }
  })
}

/**
 * Runs the push preflight on the candidate and throws the 422 the builder shows when the
 * push would refuse the schema - BEFORE anything is written. A preflight that could not run
 * at all is a refusal too: the file would land and the push behind it would fail the same way.
 */
async function assertPreflight(deps: SchemaWriteDeps, dir: string, candidate: SchemaCandidate, opts: { scopeType?: string; approvals?: string[] }): Promise<PreflightOutcome | null> {
  if (!deps.preflight) return null
  const verdict = await deps.preflight(dir, candidate, opts)
  if (verdict.ok) return verdict
  if (!verdict.ran) {
    throw new RequestError('VALIDATION_ERROR', `The schema could not be checked before writing (tangen push --plan did not run) - nothing was written. ${verdict.output?.trim().split('\n').slice(-3).join(' ') ?? ''}`.trim(), 422, undefined, { preflight: verdict })
  }
  const errors = verdict.errors ?? []
  const message = errors.length > 0 ? `${verdict.title ?? 'Push refused the schema'}: ${errors[0]}` : (verdict.title ?? 'Push refused the schema')
  throw new RequestError('VALIDATION_ERROR', `${message} - nothing was written.`, 422, undefined, { preflight: verdict, errors })
}

/**
 * A referring type WITHOUT its relation fields that target `deletedType` — the codegen
 * shape writeContentType wants, with editorView stage lists cleaned of the removed names.
 */
function detachTargetFromType(t: Record<string, any>, deletedType: string): CodegenObjectType {
  const keep = (f: Record<string, any>) => !(f.fieldType === 'relation' && f.config?.targetType === deletedType)
  const removed = new Set((t.fields ?? []).filter((f: Record<string, any>) => !keep(f)).map((f: Record<string, any>) => f.name as string))
  const admin = { ...(t.admin ?? {}) } as Record<string, any>
  if (admin.editorView) {
    admin.editorView = {
      ...(admin.editorView.main ? { main: admin.editorView.main.filter((n: string) => !removed.has(n)) } : {}),
      ...(admin.editorView.sidebar ? { sidebar: admin.editorView.sidebar.filter((n: string) => !removed.has(n)) } : {}),
    }
  }
  return {
    id: t.id ?? `oty_${t.name}`,
    name: t.name,
    label: t.label,
    ...(t.plural ? { plural: t.plural } : {}),
    ...(t.singleton ? { singleton: true } : {}),
    ...(t.disabled ? { disabled: true } : {}),
    admin,
    fields: (t.fields ?? []).filter(keep).map((f: Record<string, any>) => ({
      name: f.name, label: f.label, fieldType: f.fieldType, config: cleanInlineComponents(f.config ?? {}, deletedType), required: f.required === true,
      ...(f.disabled === true ? { disabled: true } : {}),
    })),
  }
}

/** Strip relation sub-fields targeting `deletedType` from INLINE component defs (recursive). */
function cleanInlineComponents(config: Record<string, any>, deletedType: string): Record<string, any> {
  if (!Array.isArray(config.components)) return config
  return {
    ...config,
    components: config.components.map((ref: unknown) => {
      if (typeof ref === 'string' || !ref || typeof ref !== 'object') return ref   // registry refs handled via writeComponent
      const def = ref as Record<string, any>
      return {
        ...def,
        fields: (def.fields ?? [])
          .filter((sf: Record<string, any>) => !(sf.fieldType === 'relation' && sf.config?.targetType === deletedType))
          .map((sf: Record<string, any>) => ({ ...sf, config: cleanInlineComponents(sf.config ?? {}, deletedType) })),
      }
    }),
  }
}

/** 422 when a field name collides with a system column (CREATE TABLE would fail). */
function assertNoReservedFieldNames(fields: Array<{ name?: string; previousName?: string[] }> | undefined): void {
  for (const f of fields ?? []) {
    if (f?.name && RESERVED_FIELD_NAMES.has(f.name)) {
      throw new RequestError('VALIDATION_ERROR', `Field name "${f.name}" is reserved - every content type already has that system column`, 422)
    }
    // A rename FROM a system column is never real intent: those columns are the
    // platform's, a developer never declared one, and honouring it would ask
    // the planner to rename `title` into a user field.
    for (const prev of f?.previousName ?? []) {
      if (RESERVED_FIELD_NAMES.has(prev)) {
        throw new RequestError('VALIDATION_ERROR', `Field "${f.name}" claims to have been renamed from "${prev}", which is a system column no schema declares`, 422)
      }
    }
  }
}

/**
 * 422 when a field name would map to the same column twice (declared at the top level
 * AND inside a group, or inside two groups) or shadows a built-in column. The builder
 * refuses to write the file at all - the message is the one `tangen push` prints.
 */
function assertColumnNamespace(type: CodegenObjectType): void {
  const collisions = validateColumnNamespace([type as never])
  if (collisions.length > 0) throw new RequestError('VALIDATION_ERROR', collisions[0], 422, undefined, { collisions })
}

/** Development-only tooling: refused on a deployment whose role is not development. */
async function gateRole(deps: SchemaWriteDeps, _ctx: any): Promise<void> {
  const role = (deps.role ?? deploymentRole)()
  if (!deploymentPolicy(role).schemaWritable) {
    throw new RequestError('FORBIDDEN', `Schema editing is available on a development deployment only; this deployment's role is ${role}`, 403)
  }
}

async function gate(deps: SchemaWriteDeps, ctx: any): Promise<string> {
  requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:settings')
  await gateRole(deps, ctx)
  if (!deps.isWritable()) {
    throw new RequestError('FORBIDDEN', 'Schema editing is only available on a dev runtime with a writable app source', 403)
  }
  const dir = deps.resolveAppContentDir()
  if (!dir) throw new RequestError('NOT_FOUND', 'app/content-objects not found - cannot write schema', 404)
  return dir
}

/**
 * Defer the schema WRITE (and the push after it) into a tracked background run, so the
 * HTTP response flushes FIRST. Root cause of the Save 502s: on a dev server (bun --watch)
 * the schema file we write is in the API's own import graph — the watcher restarted the
 * process before the in-flight response flushed, so the proxy returned a bare 502. Now we
 * respond immediately, wait a beat, then write + push; the admin polls
 * GET /schema/push-status/:id (which also reads the on-disk run record after a restart).
 * `pushDir: null` = write-only run (components — no tables, nothing to push).
 */
function startDeferredWrite(deps: SchemaWriteDeps, pushDir: string | null, write: () => void, approvals: string[] = [], scopeType?: string): { id: string; status: 'running' } {
  const id = newPushRunId()
  trackPush(id, (async () => {
    await new Promise((r) => setTimeout(r, deps.flushDelayMs ?? 150))
    // Spawn the detached push BEFORE writing: the write restarts the dev server, and a
    // spawn attempted from the dying process gets killed before the child detaches. The
    // push wrapper sleeps ~1s, so it reads the files written just below.
    const pushed: Promise<PushResult> = pushDir ? deps.push(pushDir, id, approvals, scopeType) : Promise.resolve({ ok: true })
    write()
    return pushed
  })())
  return { id, status: 'running' }
}

/** Same gate as {@link gate}, resolving the app/globals dir instead. */
async function gateGlobals(deps: SchemaWriteDeps, ctx: any): Promise<string> {
  requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:settings')
  await gateRole(deps, ctx)
  if (!deps.isWritable()) {
    throw new RequestError('FORBIDDEN', 'Schema editing is only available on a dev runtime with a writable app source', 403)
  }
  const dir = deps.resolveAppGlobalsDir()
  if (!dir) throw new RequestError('NOT_FOUND', 'app/globals not resolvable', 404)
  return dir
}

/** Build the schema-write route with injectable deps (testable without fs/DB). */
export function makeSchemaWriteRoute(deps: SchemaWriteDeps) {
  return (app: Elysia) =>
    app
      // Create or update a content type. Validation is synchronous (422 semantics);
      // the file write is deferred (see startDeferredWrite), so `written` is the plan.
      .post('/api/v1/admin/schema/types', async (ctx: any) => {
        const dir = await gate(deps, ctx)
        const type = ctx.body as CodegenObjectType
        if (!type?.name) throw new RequestError('VALIDATION_ERROR', 'name is required', 422)
        assertSafeName(type.name)
        assertNoReservedFieldNames(type.fields)
        {
          const empties = validateContainerEmptiness([type as never])
          if (empties.length > 0) throw new RequestError('VALIDATION_ERROR', empties[0], 422, { containers: empties })
        }
        assertColumnNamespace(type)
        // confirm=true → the admin asked the user about the fields this save REMOVES
        // (their columns + data drop); the push then carries one approval per removed
        // field OF THIS TYPE - the tokens come from the preflight, never a blanket flag (C2).
        // SCOPED BY DEFAULT: the push applies only THIS type (+ its out-of-sync deps), so a
        // teammate's WIP schema pulled from git isn't dragged in. `?scope=all` opts into the
        // full whole-codebase reconcile (the "Apply all types" action).
        const scopeType = ctx.query?.scope === 'all' ? undefined : type.name
        const confirm = ctx.query?.confirm === 'true'
        // The push's own preflight on the schema AS IT WILL BE: validators, plan, migration
        // pre-validation, codegen - all read-only. A refusal is a 422 and nothing is written.
        const verdict = await assertPreflight(deps, dir, { types: [type] }, { scopeType })
        const approvals = confirm ? (verdict?.destructive ?? []).filter((d) => d.type === type.name).map((d) => d.token) : []
        const push = startDeferredWrite(deps, dir, () => writeContentType(dir, type), approvals, scopeType)
        return { data: { written: [`${type.name}/schema.ts`, 'index.ts'], push, scoped: scopeType ?? null } }
      })
      // Delete a content type — PERMANENT (drops the table + data on push). Requires
      // explicit confirm. Referring relation fields in OTHER types are DETACHED in the
      // same run (their columns drop too) — the confirm dialog lists them, and the
      // push-level restrict then passes because the post-plan schema has no danglers.
      .delete('/api/v1/admin/schema/types/:name', async (ctx: any) => {
        const dir = await gate(deps, ctx)
        const name = ctx.params.name as string
        assertSafeName(name)
        if (ctx.query?.confirm !== 'true') {
          throw new RequestError('VALIDATION_ERROR', 'Deleting a type is permanent (drops its table + data) - pass confirm=true', 422)
        }
        const schema = (ctx.schema ?? { types: [] }) as { types: Array<Record<string, any>> }
        const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === ctx.workspaceId)
        const registry = (project?.components ?? []) as never[]
        const refs = relationFieldsTargeting(schema as never, name).filter((r) => r.typeName !== name)
        const compRefs = componentRelationRefsTargeting(schema as never, registry, name)
        // One rewrite per owning type covers BOTH top-level fields and inline component defs.
        const rewriteTypeNames = new Set([
          ...refs.map((r) => r.typeName),
          ...compRefs.inline.map((r) => r.typeName),
        ])
        const rewrites = schema.types
          .filter((t) => rewriteTypeNames.has(t.name))
          .map((t) => detachTargetFromType(t, name))
        // Reusable components: edited ONCE, affecting every type that embeds them.
        const componentsDir = compRefs.registry.length > 0 ? deps.resolveAppComponentsDir() : null
        if (compRefs.registry.length > 0 && !componentsDir) {
          throw new RequestError('NOT_FOUND', 'app/components not resolvable - cannot detach component references', 404)
        }
        const componentRewrites = [...new Set(compRefs.registry.map((r) => r.componentName))].map((cn) => {
          const def = (registry as Array<Record<string, any>>).find((c) => c.name === cn)!
          return {
            ...def,
            fields: (def.fields ?? []).filter((sf: Record<string, any>) => !(sf.fieldType === 'relation' && sf.config?.targetType === name)),
          }
        })
        // SCOPED BY DEFAULT: the delete push applies only the dropped type + the types it
        // detaches from (their relation columns drop in the same run), so unrelated WIP isn't
        // reconciled. Reusable-component rewrites carry no DB columns (embedded JSONB), so
        // they need no scope entry. `?scope=all` opts into the full reconcile.
        const scopeType = ctx.query?.scope === 'all' ? undefined : [name, ...rewriteTypeNames].join(',')
        // C2: approve exactly the type's own drop and the relation columns this run
        // detaches; component sub-field rewrites own no column and need no approval.
        const approvals = [`drop-type:${name}`, ...refs.map((r) => `drop-field:${r.typeName}.${r.fieldName}`)]
        await assertPreflight(deps, dir, { types: rewrites, remove: [name] }, { scopeType, approvals })
        const push = startDeferredWrite(deps, dir, () => {
          for (const t of rewrites) writeContentType(dir, t)
          for (const c of componentRewrites) writeComponent(componentsDir!, c as never)
          deleteContentType(dir, name)
        }, approvals, scopeType)
        const detached = [
          ...refs.map((r) => `${r.typeName}.${r.fieldName}`),
          ...compRefs.registry.map((r) => `${r.componentName}.${r.subfield} (component)`),
          ...compRefs.inline.map((r) => `${r.typeName}.${r.fieldName}:${r.componentName}.${r.subfield}`),
        ]
        return { data: { written: ['index.ts'], removed: name, detached, push } }
      })
      // Poll a background push run (started by a type/global write). Falls back to the
      // on-disk run record — the in-memory map dies when the dev watcher restarts us.
      .get('/api/v1/admin/schema/push-status/:id', (ctx: any) => {
        requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:settings')
        return { data: getPushRun(ctx.params.id) ?? readDiskRun(ctx.params.id) ?? { status: 'unknown' } }
      })

      // Pre-apply preview: what would a whole-codebase push apply RIGHT NOW? The builder
      // calls this before an Apply and warns if types OTHER than the one being edited
      // have pending changes (a colleague's WIP pulled from git, an unrelated local edit)
      // — because `tangen push` reconciles the WHOLE codebase, not just the saved type.
      // Read-only (a --plan dry run); safe to call on every Apply.
      .get('/api/v1/admin/schema/pending-plan', async (ctx: any) => {
        const dir = await gate(deps, ctx)
        // ?type=<name> → scoped preview: what a `--type` apply would touch + the out-of-sync
        // dependencies it pulls in (`extraTypes`). No type → the full whole-codebase preview.
        const preview = await deps.planPreview(dir, ctx.query?.type || undefined)
        return { data: preview }
      })

      // Export the whole schema as a single TypeScript file — a safety copy
      // users can download from the builder before risky edits.
      .get('/api/v1/admin/schema/export', (ctx: any) => {
        requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:settings')
        const { schema } = ctx
        const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === ctx.workspaceId)
        const parts: string[] = [
          `// Tangen schema export - ${new Date().toISOString()}`,
          '// One file per type normally lives in app/content-objects/<name>/schema.ts;',
          '// this is a concatenated safety copy generated from the live schema.',
          '',
        ]
        for (const t of schema.types as any[]) parts.push(generateObjectTypeSource(t), '')
        for (const c of ((project?.components ?? []) as any[])) parts.push(generateComponentSource(c), '')
        ctx.set.headers['content-type'] = 'text/plain; charset=utf-8'
        ctx.set.headers['content-disposition'] = 'attachment; filename="tangen-schema-export.ts"'
        return parts.join('\n')
      })

      // ── Reusable components ──────────────────────────────────────────────
      // List the workspace's reusable component registry (for the picker).
      .get('/api/v1/admin/schema/components', (ctx: any) => {
        requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:settings')
        const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === ctx.workspaceId)
        return { data: (project?.components ?? []) as unknown[] }
      })
      // Create or update a reusable component (writes app/components/<name>).
      // Deferred write, no push — components don't create tables.
      .post('/api/v1/admin/schema/components', async (ctx: any) => {
        await gate(deps, ctx)
        const dir = deps.resolveAppComponentsDir()
        if (!dir) throw new RequestError('NOT_FOUND', 'app/components not resolvable', 404)
        const comp = ctx.body as CodegenComponent
        // Rename intent on a component sub-field stays live until the values it
        // describes are gone, so a name it still claims cannot become a new
        // field: the migration counts occurrences, and would move them.
        {
          const problems = componentRenameConflicts(comp as never)
          if (problems.length > 0) throw new RequestError('VALIDATION_ERROR', problems[0], 422, { renames: problems })
        }
        if (!comp?.name) throw new RequestError('VALIDATION_ERROR', 'name is required', 422)
        assertSafeName(comp.name)
        {
          const empties = validateContainerEmptiness([], [comp as never])
          if (empties.length > 0) throw new RequestError('VALIDATION_ERROR', empties[0], 422, { containers: empties })
        }
        const push = startDeferredWrite(deps, null, () => writeComponent(dir, comp))
        return { data: { written: [`${comp.name}/schema.ts`, 'index.ts'], push } }
      })
      // Delete a reusable component.
      .delete('/api/v1/admin/schema/components/:name', async (ctx: any) => {
        await gate(deps, ctx)
        const dir = deps.resolveAppComponentsDir()
        if (!dir) throw new RequestError('NOT_FOUND', 'app/components not resolvable', 404)
        const name = ctx.params.name as string
        assertSafeName(name)
        const push = startDeferredWrite(deps, null, () => deleteComponent(dir, name))
        return { data: { written: ['index.ts'], removed: name, push } }
      })

      // ── Globals (single app/globals/index.ts array) ──────────────────────
      .get('/api/v1/admin/schema/globals', (ctx: any) => {
        requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:settings')
        const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === ctx.workspaceId)
        return { data: (project?.globals ?? []) as unknown[] }
      })
      .post('/api/v1/admin/schema/globals', async (ctx: any) => {
        const dir = await gateGlobals(deps, ctx)
        const body = ctx.body as CodegenGlobal
        if (!body?.name) throw new RequestError('VALIDATION_ERROR', 'name is required', 422)
        assertSafeName(body.name)
        const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === ctx.workspaceId)
        const merged = upsertGlobal((project?.globals ?? []) as CodegenGlobal[], body)
        const push = startDeferredWrite(deps, dir, () => writeGlobals(dir, merged))
        return { data: { written: ['globals/index.ts'], push } }
      })
      .delete('/api/v1/admin/schema/globals/:name', async (ctx: any) => {
        const dir = await gateGlobals(deps, ctx)
        const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === ctx.workspaceId)
        const merged = removeGlobal((project?.globals ?? []) as CodegenGlobal[], ctx.params.name)
        const push = startDeferredWrite(deps, dir, () => writeGlobals(dir, merged))
        return { data: { written: ['globals/index.ts'], push, removed: ctx.params.name } }
      })

      // ── Batch write (MS-3) — a whole set of schemas, then ONE push ────────
      // Writes every item (types/components/globals) first, then a single push so the
      // set validates together (relations between the new types resolve regardless of order).
      .post('/api/v1/admin/schema/batch', async (ctx: any) => {
        requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:settings')
        await gateRole(deps, ctx)
        if (!deps.isWritable()) throw new RequestError('FORBIDDEN', 'Schema editing is only available on a dev runtime with a writable app source', 403)
        const items = (ctx.body?.items ?? []) as Array<{ kind?: string } & Record<string, unknown>>
        if (!Array.isArray(items) || items.length === 0) throw new RequestError('VALIDATION_ERROR', 'items is required', 422)

        // Validate + resolve everything synchronously (422/404 semantics), then defer the
        // actual writes into ONE tracked run (see startDeferredWrite for why).
        const contentDir = deps.resolveAppContentDir()
        const written: string[] = []
        const jobs: Array<() => void> = []
        const globalItems: CodegenGlobal[] = []
        for (const it of items) {
          const name = it.name as string | undefined
          if (!name) throw new RequestError('VALIDATION_ERROR', 'every item needs a name', 422)
          assertSafeName(name)
          if (it.kind === 'component') {
            const dir = deps.resolveAppComponentsDir()
            if (!dir) throw new RequestError('NOT_FOUND', 'app/components not resolvable', 404)
            jobs.push(() => writeComponent(dir, it as unknown as CodegenComponent))
            written.push(`${name}/schema.ts`)
          } else if (it.kind === 'global') {
            globalItems.push(it as unknown as CodegenGlobal)
          } else {
            if (!contentDir) throw new RequestError('NOT_FOUND', 'app/content-objects not found', 404)
            assertNoReservedFieldNames(it.fields as Array<{ name?: string }> | undefined)
            {
              const empties = validateContainerEmptiness([it as never])
              if (empties.length > 0) throw new RequestError('VALIDATION_ERROR', empties[0], 422, { containers: empties })
            }
            assertColumnNamespace(it as unknown as CodegenObjectType)
            jobs.push(() => writeContentType(contentDir, it as unknown as CodegenObjectType))
            written.push(`${name}/schema.ts`)
          }
        }
        if (globalItems.length) {
          const dir = deps.resolveAppGlobalsDir()
          if (!dir) throw new RequestError('NOT_FOUND', 'app/globals not resolvable', 404)
          const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === ctx.workspaceId)
          let merged = (project?.globals ?? []) as CodegenGlobal[]
          for (const g of globalItems) merged = upsertGlobal(merged, g)
          jobs.push(() => writeGlobals(dir, merged))
          written.push('globals/index.ts')
        }
        // One push from any resolved app dir (push is workspace-wide, run from the app root).
        const pushDir = contentDir ?? deps.resolveAppGlobalsDir() ?? deps.resolveAppComponentsDir()
        if (!pushDir) throw new RequestError('NOT_FOUND', 'no app source dir resolvable', 404)
        const candidateTypes = items.filter((it) => it.kind !== 'component' && it.kind !== 'global') as unknown as CodegenObjectType[]
        if (candidateTypes.length > 0) await assertPreflight(deps, pushDir, { types: candidateTypes }, {})
        const push = startDeferredWrite(deps, pushDir, () => { for (const j of jobs) j() })
        return { data: { written, push } }
      })
}

/** Production route: real capability + fs resolution + push. */
export const schemaWriteRoute = makeSchemaWriteRoute({
  isWritable: getSchemaWritable,
  resolveAppContentDir: findAppContentDir,
  resolveAppComponentsDir: findAppComponentsDir,
  resolveAppGlobalsDir: findAppGlobalsDir,
  push: spawnPush,
  planPreview: spawnPlanPreview,
  preflight: spawnPreflight,
})
