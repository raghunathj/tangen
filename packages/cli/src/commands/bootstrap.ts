/**
 * File Name: bootstrap.ts
 * Purpose: `tangen bootstrap` — the first-run command for a fresh site. Asks
 *          for the workspace name, resets the app surface to an empty starter
 *          (zero content types), creates the database schema, and prints the
 *          admin setup-wizard URL. Seeds NO members and NO API keys — the
 *          first owner account is created in the admin's setup wizard.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: --with-demo keeps the legacy behavior (demo app surface
 *          + seeded admin/API key) for platform development. Idempotent.
 */
import { resolveDeploymentDatabase, describeDatabaseError, deploymentRole } from '../deployment-database'
import { readdirSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { deploymentPolicy, type DeploymentRole } from '@tangen/types'
import { join, dirname } from 'node:path'
import { CRITICAL_CONVENTIONS } from '../agent-conventions'

/** The AI-companion files written only in AI Companion Mode. */
export const AI_COMPANION_FILES = ['CLAUDE.md', 'AGENTS.md', '.claude/settings.json', '.mcp.json'] as const

export interface BootstrapStep {
  label: string
  cmd: string[]
  cwd: string
}

/** The database plan, in dependency order (no seeding — push creates the
 *  workspace row itself, and the admin wizard creates the first member). */
export function bootstrapSteps(): BootstrapStep[] {
  return [
    {
      label: 'system tables (migrations)',
      cmd: ['bun', 'src/migrate.ts'],
      cwd: 'packages/db',
    },
    {
      label: 'workspace + content tables (tangen push)',
      cmd: ['bun', 'packages/cli/src/index.ts', 'push'],
      cwd: '.',
    },
  ]
}

/** Legacy plan for --with-demo: additionally seeds admin@example.com + dev API key. */
export function bootstrapDemoSteps(): BootstrapStep[] {
  const [system, push] = bootstrapSteps()
  return [
    system,
    { label: 'seed demo workspace + admin + API key', cmd: ['bun', 'run', 'seed:skeleton'], cwd: 'packages/db' },
    push,
  ]
}

/**
 * Why `--with-demo` cannot run on this deployment, or null. The demo seed
 * (admin@example.com, a full-access key, sample content) is developer
 * convenience; a production role refuses seeds (`deploymentPolicy`), and a
 * bootstrap that writes them there would be the first thing an attacker
 * looks for.
 */
export function demoSeedRefusal(role: DeploymentRole, opts: { withDemo?: boolean }): string | null {
  if (!opts.withDemo) return null
  if (deploymentPolicy(role).seed !== 'refused') return null
  return `a ${role} deployment refuses the demo seed (TANGEN_DEPLOYMENT_ROLE=${role}); bootstrap without --with-demo and create the first owner through the setup wizard.`
}

/** The deployment's database, or undefined with the reason on `error`. */
export function resolveDatabaseUrl(env: Record<string, string | undefined>): { url?: string; error?: string } {
  try { return { url: resolveDeploymentDatabase(env).url } } catch (e) { return { error: describeDatabaseError(e) } }
}

// ─── Fresh app surface ────────────────────────────────────────────────────────

export interface WorkspaceIdentity {
  name: string
  slug: string
  workspaceId: string
}

/** Derives slug + workspace id from a human name ("Demo Bakery" → demo-bakery / wsp_demo_bakery). */
export function deriveWorkspaceIdentity(name: string): WorkspaceIdentity {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return { name: name.trim(), slug, workspaceId: `wsp_${slug.replace(/-/g, '_')}` }
}

/**
 * Files (re)written for a fresh site, parameterized by the workspace identity.
 * `ai` (default true) controls AI Companion Mode: when false, the agent files
 * (CLAUDE.md/AGENTS.md/.claude/settings.json/.mcp.json) are omitted for a clean,
 * non-AI project.
 */
export function freshTemplates(ws: WorkspaceIdentity, opts: { ai?: boolean } = {}): Record<string, string> {
  const agentGuide = `# ${ws.name} - Tangen site, agent guide

This repo is a **Tangen site** (a platform clone used as a site runtime).
Build in \`app/\` and \`extensions/\` only - \`packages/*\` is the runtime
you pull (\`git pull upstream master\`), never edit.

Skills live in \`skills/\`; **follow \`skills/tangen-developer/SKILL.md\`**
for every task (content types, custom routes, custom tables, extensions,
Content AI config).

Commands: \`bun packages/cli/src/index.ts check|push|types\`
· \`bun run dev\` (PORT/ADMIN_PORT from .env). Give every AI-eligible field an
\`ai.hint\`; refresh the admin browser tab after a push.

${CRITICAL_CONVENTIONS}

## Connect your AI over MCP

A running instance exposes agent-operable content tools. Bridge your editor to
it (config in \`.mcp.json\`):

    bun packages/cli/src/index.ts mcp
`
  const settings = JSON.stringify({
    permissions: {
      deny: [
        'Edit(./packages/**)',
        'Write(./packages/**)',
        'Edit(./node_modules/**)',
        'Write(./node_modules/**)',
        'Edit(./.env*)',
        'Write(./.env*)',
        'Edit(./bun.lock*)',
      ],
    },
  }, null, 2) + '\n'
  const mcpConfig = JSON.stringify({
    mcpServers: {
      tangen: { command: 'bun', args: ['packages/cli/src/index.ts', 'mcp'] },
    },
  }, null, 2) + '\n'
  const templates: Record<string, string> = {
    'CLAUDE.md': agentGuide,
    'AGENTS.md': agentGuide,
    '.claude/settings.json': settings,
    '.mcp.json': mcpConfig,
    'app/content-objects/index.ts': `import { defineSchema } from '@tangen/cms'

// Add your content types here: create app/content-objects/<name>/schema.ts with
// defineObjectType + field.* builders, import it, and list it in types.
// Optional co-files per type: hooks.ts, access.ts, validation.ts.
// Reference: docs/fields.md
export default defineSchema({
  types: [],
})
`,
    'app/api/index.ts': `import type { CustomRoute } from '@tangen/cms'

// Register your custom routes here — see docs/api-routes.md and docs/tangenql.md
export default [] as CustomRoute[]
`,
    'app/globals/index.ts': `import { defineGlobals } from '@tangen/cms'

// Workspace-level globals (Options / Metafields) — see docs/fields.md
export default defineGlobals([])
`,
    'app/config/extensions.ts': `import { defineExtensions } from '@tangen/cms'

// Enable extensions per workspace, e.g.:
//   { resolve: '../../extensions/seo', options: { ai: true } }
// See docs/content-ai.md § Extensions and \`tangen extension create\`.
export default defineExtensions([])
`,
    'app/workspaces/index.ts': `import { defineWorkspaces } from '@tangen/cms'

export default defineWorkspaces([
  { id: '${ws.workspaceId}', name: '${ws.name}', slug: '${ws.slug}' },
])
`,
    'app/hooks/index.ts': `import type { ContentHooks } from '@tangen/cms'

// Cross-type content hooks + per-type hooks composed here.
// Per-type hooks live next to their schema (content-objects/<name>/hooks.ts);
// compose them with composeContentHooks(...) as they appear.
export default {} as ContentHooks
`,
    'app/permissions/roles.ts': `// Code-defined roles - defineRole() seeds shipped with the site.
// export const publisher = defineRole({ slug: 'publisher', name: 'Publisher', extends: 'editor' })
export default []
`,
    'app/jobs/index.ts': `// Scheduled jobs + background tasks (defineScheduledJob / defineTask).
// See docs/jobs.md
export default { scheduled: [], tasks: [] }
`,
    'app/config/storage.ts': `import { defineStorageConfig } from '@tangen/cms'

// Media storage — local disk by default; adapter 's3' covers S3/R2/Spaces/
// MinIO/GCS-interop (Bun-native, zero deps). See docs/storage.md
export const storageConfig = defineStorageConfig({ adapter: 'local' })
`,
    [`app/workspaces/${ws.slug}/workspace.config.ts`]: `import { defineWorkspace } from '@tangen/cms'
import schema from '../../content-objects'
import extensions from '../../config/extensions'
import globals from '../../globals'
import routes from '../../api'
import contentHooks from '../../hooks'
import roles from '../../permissions/roles'
import { aiConfig } from '../../config/ai'
// tangen:imports

export default defineWorkspace({
  name: '${ws.name}',
  workspaceId: '${ws.workspaceId}',
  schemas: schema.types,
  extensions,
  // tangen:features
  routes,
  globals,
  contentHooks,
  roles,
  ai: aiConfig,
})
`,
    'app/tangen.config.ts': `/**
 * Thin adapter — the canonical config lives in
 * app/workspaces/${ws.slug}/workspace.config.ts.
 */
import type { TangenConfig } from '@tangen/cms'
import workspaceConfig from './workspaces/${ws.slug}/workspace.config'

const config: TangenConfig = {
  project: '${ws.slug}',
  schema: './content-objects/index.ts',
  ...(workspaceConfig as any),
}

export default config
`,
  }

  // Non-AI Mode: strip the AI-companion files, leaving a clean project.
  if (opts.ai === false) {
    for (const f of AI_COMPANION_FILES) delete templates[f]
  }
  return templates
}

export interface FreshenResult {
  written: string[]
  removed: string[]
}

/**
 * Resets the app surface to an empty starter for the given workspace: zero
 * content types, no routes, no globals; all infra config kept; demo workspace
 * directories replaced with the new workspace's config.
 */
export function runFreshen(
  rootDir: string,
  ws: WorkspaceIdentity,
  opts: { ai?: boolean } = {},
): FreshenResult {
  const removed: string[] = []

  const removeEntriesExcept = (dirRel: string, keep: Set<string>) => {
    const dir = join(rootDir, dirRel)
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      if (keep.has(entry)) continue
      rmSync(join(dir, entry), { recursive: true, force: true })
      removed.push(`${dirRel}/${entry}`)
    }
  }

  removeEntriesExcept('app/content-objects', new Set(['index.ts']))
  removeEntriesExcept('app/api', new Set(['index.ts']))
  removeEntriesExcept('app/workspaces', new Set([ws.slug]))

  const written: string[] = []
  for (const [rel, content] of Object.entries(freshTemplates(ws, opts))) {
    const dest = join(rootDir, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, content)
    written.push(rel)
  }

  return { written, removed }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function prompt(question: string): Promise<string> {
  const { createInterface } = await import('node:readline')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve))
  rl.close()
  return answer.trim()
}

const promptWorkspaceName = () => prompt('  Workspace name (e.g. "Demo Bakery"): ')

/** Ask whether to enable AI Companion Mode. Anything but an explicit "2"/"n" ⇒ AI on. */
async function promptAiMode(): Promise<boolean> {
  console.log('  Development mode:')
  console.log('    1) AI Companion Mode  - agent rules + MCP config for faster AI-assisted coding')
  console.log('    2) Non-AI Mode        - a clean project, no agent files')
  const answer = (await prompt('  Choose [1]: ')).toLowerCase()
  return !(answer === '2' || answer === 'n' || answer === 'no' || answer.startsWith('non'))
}

export interface BootstrapOptions {
  /** Legacy demo mode: keep the demo app surface and seed admin + API key. */
  withDemo?: boolean
  /** Non-interactive workspace name (skips the prompt). */
  name?: string
  /** AI Companion Mode. Undefined ⇒ prompt interactively; true/false ⇒ skip prompt. */
  ai?: boolean
  /** Resolved project config dir (app/) — used by installed-project mode. */
  configCwd?: string
  /** Resolved workspace id — used by installed-project mode. */
  workspaceId?: string
}

/**
 * Bootstrap for a project installed from npm (`tangen create` scaffold): the
 * workspace identity already lives in app/, so there is nothing to prompt or
 * freshen — apply the system-table migrations shipped inside the installed
 * @tangen/db, then push the workspace + content schema. Idempotent.
 */
async function runInstalledBootstrap(
  dbUrl: string,
  configCwd: string,
  workspaceId: string | undefined,
): Promise<void> {
  const { c, sym } = await import('../ui')

  console.log(`  ${c.dim('○')}  system tables (migrations)…`)
  try {
    const { createRequire } = await import('node:module')
    const req = createRequire(join(process.cwd(), 'noop.js'))
    const { runMigrations } = await import(req.resolve('@tangen/db/migrate'))
    await runMigrations(dbUrl)
  } catch (err: any) {
    console.error(`  ✗  system tables failed: ${err.message} - fix and re-run; bootstrap is idempotent`)
    process.exitCode = 1
    return
  }
  console.log(`  ${sym.tick}  system tables (migrations)`)

  console.log(`  ${c.dim('○')}  workspace + content tables (tangen push)…`)
  const { runPushCommand } = await import('./push')
  await runPushCommand([], configCwd, workspaceId, { keepAlive: true })
  if (process.exitCode === 1) return
  console.log(`  ${sym.tick}  workspace + content tables`)

  // resolveProject's workspaceId is a directory-name guess ("app" → wsp_app);
  // the config holds the real one — never print a wrong /setup URL.
  let realWorkspaceId = workspaceId
  try {
    const mod = await import(join(configCwd, 'tangen.config.ts'))
    realWorkspaceId = (mod.default as { workspaceId?: string })?.workspaceId ?? workspaceId
  } catch { /* keep the guess */ }

  const adminPort = process.env.ADMIN_PORT ?? '3001'
  console.log()
  console.log(`  ${sym.tick}  Bootstrap complete. Next:`)
  console.log(`     1. ${c.cyan('npm run dev')}`)
  if (realWorkspaceId) {
    console.log(`     2. Create your admin account: ${c.cyan(`http://localhost:${adminPort}/${realWorkspaceId}/setup`)}`)
  }
  console.log()
  // Push/migrate leave pooled DB connections open — without exit(0) the
  // process hangs here after everything is done.
  process.exit(0)
}

/**
 * Runs the first-run flow, stopping at the first failure.
 */
export async function runBootstrapCommand(opts: BootstrapOptions = {}): Promise<void> {
  const { c, sym } = await import('../ui')

  // The deployment's database: DATABASE_URL, through the one resolver every
  // command uses. A monorepo bootstrap has no project config; the variables answer.
  const resolvedDb = resolveDatabaseUrl(process.env)
  const dbUrl = resolvedDb.url
  if (!dbUrl) {
    console.error(`tangen: ${resolvedDb.error}`)
    process.exitCode = 1
    return
  }
  const role = deploymentRole()
  const seedRefusal = demoSeedRefusal(role, opts)
  if (seedRefusal) {
    console.error(`tangen: ${seedRefusal}`)
    process.exitCode = 1
    return
  }

  console.log()
  console.log(`  ${c.bold(c.cyan('◆'))} ${c.bold('tangen bootstrap')}  ${c.dim('role:')} ${c.cyan(role)}`)
  console.log(`  ${c.dim('database:')} ${dbUrl.replace(/\/\/[^@]*@/, '//***@')}`)
  console.log()

  // Installed-project mode (npm consumer): no packages/db beside us, but a
  // scaffolded app/ config — the workspace identity is already on disk, so
  // never prompt or freshen. Monorepo/site-clone keeps the legacy flow below.
  const inMonorepo = existsSync(join(process.cwd(), 'packages', 'db', 'package.json'))
  if (!inMonorepo && !opts.withDemo) {
    const configCwd = opts.configCwd ?? join(process.cwd(), 'app')
    if (!existsSync(join(configCwd, 'tangen.config.ts'))) {
      console.error('tangen: no app/tangen.config.ts found - run `tangen create` first')
      process.exitCode = 1
      return
    }
    await runInstalledBootstrap(dbUrl, configCwd, opts.workspaceId)
    return
  }

  let ws: WorkspaceIdentity | null = null
  let aiMode = false
  if (!opts.withDemo) {
    // 1) AI mode → 2) workspace → (push) → 3) user-creation link
    aiMode = opts.ai ?? (await promptAiMode())
    console.log(`  ${sym.tick}  ${aiMode ? 'AI Companion Mode' : 'Non-AI Mode'}`)
    console.log()
    const name = opts.name?.trim() || (await promptWorkspaceName())
    if (!name) {
      console.error('tangen: a workspace name is required')
      process.exitCode = 1
      return
    }
    ws = deriveWorkspaceIdentity(name)
    const { written, removed } = runFreshen(process.cwd(), ws, { ai: aiMode })
    console.log(`  ${sym.tick}  workspace "${ws.name}" (${ws.workspaceId}) - empty app surface`)
    for (const r of removed) console.log(`     ${c.dim('- removed ' + r)}`)
    for (const w of written) console.log(`     ${c.dim('~ wrote ' + w)}`)
    console.log()
  }

  const steps = opts.withDemo ? bootstrapDemoSteps() : bootstrapSteps()
  for (const step of steps) {
    console.log(`  ${c.dim('○')}  ${step.label}…`)
    const proc = Bun.spawnSync(step.cmd, {
      cwd: step.cwd,
      stdout: 'inherit',
      stderr: 'inherit',
      env: process.env,
    })
    if (proc.exitCode !== 0) {
      console.error(`  ✗  ${step.label} failed (exit ${proc.exitCode}) - fix and re-run; bootstrap is idempotent`)
      process.exitCode = 1
      return
    }
    console.log(`  ${sym.tick}  ${step.label}`)
  }

  console.log()
  if (opts.withDemo) {
    console.log(`  ${sym.tick}  Bootstrap complete. Log in as admin@example.com / password after ${c.cyan('bun run dev')}`)
  } else if (ws) {
    const adminPort = process.env.ADMIN_PORT ?? '3001'
    console.log(`  ${sym.tick}  Bootstrap complete. Next:`)
    console.log(`     1. ${c.cyan('bun run dev')}`)
    console.log(`     2. Create your admin account: ${c.cyan(`http://localhost:${adminPort}/${ws.workspaceId}/setup`)}`)
    if (aiMode) {
      console.log(`     3. Point your AI at ${c.cyan('CLAUDE.md')} / ${c.cyan('.mcp.json')}, then connect it:`)
      console.log(`        ${c.cyan('bun packages/cli/src/index.ts mcp')}`)
    }
  }
}
