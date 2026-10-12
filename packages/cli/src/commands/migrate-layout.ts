/**
 * File Name: migrate-layout.ts
 * Purpose: Implements `tangen migrate layout` — moves a site repo from the v1
 *   app/ layout to the v2 layout (content-objects/, workspaces/index.ts
 *   registry, workspace.config.ts, permissions/, api/resources.ts) and
 *   rewrites the import specifiers that the moves invalidate.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Idempotent — every operation checks its precondition and
 *   no-ops when the target state already holds, so re-running is safe.
 *   `--dry-run` reports the operations without touching the filesystem.
 *   Repo-specific debris (unimported schema dirs, ad-hoc components) is NOT
 *   guessed at — the command only performs the documented structural moves.
 */
import { existsSync, renameSync, readdirSync, rmdirSync, unlinkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface MigrateLayoutResult {
  /** Human-readable operations, in execution order ("move a → b", "rewrite c"). */
  operations: string[]
  /** True when nothing needed doing (repo already on the v2 layout). */
  alreadyMigrated: boolean
}

interface Io {
  exists: (p: string) => boolean
  rename: (from: string, to: string) => void
  readDir: (p: string) => string[]
  removeDirIfEmpty: (p: string) => void
  removeFile: (p: string) => void
  mkdir: (p: string) => void
  read: (p: string) => string
  write: (p: string, content: string) => void
}

const realIo: Io = {
  exists: existsSync,
  rename: renameSync,
  readDir: (p) => readdirSync(p),
  removeDirIfEmpty: (p) => { try { rmdirSync(p) } catch { /* not empty - leave it */ } },
  removeFile: unlinkSync,
  mkdir: (p) => mkdirSync(p, { recursive: true }),
  read: (p) => readFileSync(p, 'utf8'),
  write: (p, c) => writeFileSync(p, c, 'utf8'),
}

/**
 * Rewrites v1 import specifiers in a workspace/adapter config source string.
 * Pure — exported for unit tests. All rewrites are idempotent (guarded so a
 * second pass changes nothing).
 */
export function rewriteConfigImports(source: string): string {
  return source
    // schema dir rename — any relative specifier whose next segment is `content`
    // (idempotent: `content-objects` is followed by `-`, so it never re-matches)
    .replace(/(['"](?:\.{1,2}\/)+)content(?=[/'"])/g, '$1content-objects')
    // registry moved out of config/
    .replace(/(['"])\.\/config\/workspaces(\.ts)?(['"])/g, '$1./workspaces$3')
    // roles + api-resources relocated
    .replace(/(['"])((?:\.\.\/)+)roles(['"])/g, '$1$2permissions/roles$3')
    .replace(/(['"])((?:\.\.\/)+)api-resources(['"])/g, '$1$2api/resources$3')
    // per-workspace config renamed (adapter import)
    .replace(/(\.\/workspaces\/[^'"\/]+)\/tangen\.config/g, '$1/workspace.config')
}

/**
 * Migrates `<projectRoot>/app` (plus root tsconfig.schema.json) from the v1
 * to the v2 layout. Returns the operations performed (or, with dryRun, the
 * operations that would be performed).
 */
export function runMigrateLayout(
  projectRoot: string,
  opts: { dryRun?: boolean } = {},
  io: Io = realIo,
): MigrateLayoutResult {
  const app = join(projectRoot, 'app')
  if (!io.exists(app)) throw new Error(`No app/ directory found at ${projectRoot}`)

  const ops: string[] = []
  const dry = opts.dryRun === true
  const act = (desc: string, fn: () => void) => { ops.push(desc); if (!dry) fn() }

  // 1. content/ → content-objects/
  if (io.exists(join(app, 'content')) && !io.exists(join(app, 'content-objects'))) {
    act('move app/content → app/content-objects', () =>
      io.rename(join(app, 'content'), join(app, 'content-objects')))
  }

  // 2. config/workspaces.ts → workspaces/index.ts
  const oldRegistry = join(app, 'config', 'workspaces.ts')
  const newRegistry = join(app, 'workspaces', 'index.ts')
  if (io.exists(oldRegistry) && !io.exists(newRegistry)) {
    act('move app/config/workspaces.ts → app/workspaces/index.ts', () => {
      io.mkdir(join(app, 'workspaces'))
      io.rename(oldRegistry, newRegistry)
    })
  }

  // 3. workspaces/<slug>/tangen.config.ts → workspace.config.ts
  const wsDir = join(app, 'workspaces')
  if (io.exists(wsDir)) {
    for (const slug of io.readDir(wsDir)) {
      const dir = join(wsDir, slug)
      const oldCfg = join(dir, 'tangen.config.ts')
      const newCfg = join(dir, 'workspace.config.ts')
      if (io.exists(oldCfg) && !io.exists(newCfg)) {
        act(`move app/workspaces/${slug}/tangen.config.ts → workspace.config.ts`, () =>
          io.rename(oldCfg, newCfg))
      }
    }
  }

  // 4. roles.ts → permissions/roles.ts (+ index barrel)
  if (io.exists(join(app, 'roles.ts')) && !io.exists(join(app, 'permissions', 'roles.ts'))) {
    act('move app/roles.ts → app/permissions/roles.ts', () => {
      io.mkdir(join(app, 'permissions'))
      io.rename(join(app, 'roles.ts'), join(app, 'permissions', 'roles.ts'))
      io.write(join(app, 'permissions', 'index.ts'),
        "export { default } from './roles'\nexport * from './roles'\n")
    })
  }

  // 5. api-resources.ts → api/resources.ts
  if (io.exists(join(app, 'api-resources.ts')) && !io.exists(join(app, 'api', 'resources.ts'))) {
    act('move app/api-resources.ts → app/api/resources.ts', () => {
      io.mkdir(join(app, 'api'))
      io.rename(join(app, 'api-resources.ts'), join(app, 'api', 'resources.ts'))
    })
  }

  // 6. Unwired v1 duplicate: config/globals.ts loses to globals/index.ts
  if (io.exists(join(app, 'config', 'globals.ts')) && io.exists(join(app, 'globals', 'index.ts'))) {
    act('delete app/config/globals.ts (duplicate of app/globals/index.ts)', () =>
      io.removeFile(join(app, 'config', 'globals.ts')))
  }

  // 7. Import rewrites in the adapter + every workspace config
  const rewriteTargets = [join(app, 'tangen.config.ts')]
  if (io.exists(wsDir)) {
    for (const slug of io.readDir(wsDir)) {
      const cfg = join(wsDir, slug, 'workspace.config.ts')
      if (io.exists(cfg)) rewriteTargets.push(cfg)
    }
  }
  for (const target of rewriteTargets) {
    if (!io.exists(target)) continue
    const before = io.read(target)
    const after = rewriteConfigImports(before)
    if (after !== before) {
      act(`rewrite imports in ${target.slice(projectRoot.length + 1)}`, () => io.write(target, after))
    }
  }

  // 8. Root tsconfig.schema.json include path
  const schemaTsconfig = join(projectRoot, 'tsconfig.schema.json')
  if (io.exists(schemaTsconfig)) {
    const before = io.read(schemaTsconfig)
    const after = before.replace(/app\/content\//g, 'app/content-objects/')
    if (after !== before) {
      act('rewrite tsconfig.schema.json include → app/content-objects', () => io.write(schemaTsconfig, after))
    }
  }

  // 9. Homes for the new conventions (created empty; wired by later tooling)
  if (!io.exists(join(app, 'hooks', 'index.ts'))) {
    act('create app/hooks/index.ts stub', () => {
      io.mkdir(join(app, 'hooks'))
      io.write(join(app, 'hooks', 'index.ts'),
        "import type { ContentHooks } from '@tangen/cms'\n\n" +
        '// Cross-type content hooks + per-type hooks composed here.\n' +
        '// Per-type hooks live next to their schema (content-objects/<name>/hooks.ts).\n' +
        'export default {} as ContentHooks\n')
    })
  }
  if (!io.exists(join(app, 'jobs', 'index.ts'))) {
    act('create app/jobs/index.ts stub', () => {
      io.mkdir(join(app, 'jobs'))
      io.write(join(app, 'jobs', 'index.ts'),
        '// Scheduled jobs + background tasks (defineScheduledJob / defineTask). See docs/jobs.md\n' +
        'export default { scheduled: [], tasks: [] }\n')
    })
  }
  for (const home of ['shared', 'generated']) {
    if (!io.exists(join(app, home))) {
      act(`create app/${home}/`, () => {
        io.mkdir(join(app, home))
        io.write(join(app, home, '.gitkeep'), '')
      })
    }
  }

  return { operations: ops, alreadyMigrated: ops.length === 0 }
}

/** CLI entry — prints the operations and a summary line. */
export function runMigrateLayoutCommand(
  projectRoot: string,
  dryRun: boolean,
  log: (msg: string) => void = console.log,
): void {
  const { operations, alreadyMigrated } = runMigrateLayout(projectRoot, { dryRun })
  if (alreadyMigrated) {
    log('[tangen] Layout already migrated - nothing to do.')
    return
  }
  for (const op of operations) log(`  ${dryRun ? '(dry-run) ' : ''}${op}`)
  log(dryRun
    ? `[tangen] ${operations.length} operation(s) would run. Re-run without --dry-run to apply.`
    : `[tangen] ✓ Migrated to the v2 layout (${operations.length} operation(s)). Run 'tangen check' and boot the dev server to verify.`)
}
