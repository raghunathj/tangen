/**
 * File Name: create.ts
 * Purpose: Implements `tangen create` — interactive project bootstrapper that scaffolds
 *   a full Tangen project with one workspace inside apps/<slug>/, installs dependencies,
 *   and copies .env.example → .env so the developer only needs to fill in DB URLs.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure scaffold generators are exported for unit testing without I/O.
 * Per-workspace configs live in app/workspaces/<slug>/workspace.config.ts (mandatory).
 * The runner (runCreateCommand) performs file I/O and child-process calls.
 */
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

/** True when `url` answers `select 1` within 6s. */
export async function checkPostgres(url: string): Promise<boolean> {
  try {
    const { SQL } = await import('bun')
    const sql = new SQL(url)
    try {
      await Promise.race([
        sql`select 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
      ])
      return true
    } finally {
      await sql.end().catch(() => {})
    }
  } catch {
    return false
  }
}

export interface WorkspaceScaffoldOptions {
  workspaceName: string
  workspaceSlug: string
  workspaceId: string
  projectFolder: string
  masterSlug?: string
  /** Validated development Postgres URL gathered by the create wizard. */
  databaseUrl?: string
  /** AI Companion Mode — write agent rules + MCP config. Undefined ⇒ prompt;
   *  true/false ⇒ skip the prompt (flags / non-interactive). */
  ai?: boolean
  /** Skip the package-manager install after scaffolding (tests; CI dry runs). */
  skipInstall?: boolean
}

/**
 * Interprets the mode-choice answer. Companion Mode is the default (Enter,
 * "1", or "y"); only an explicit "2"/"n"/"no"/"non-ai" opts out.
 */
export function parseCompanionChoice(answer: string): boolean {
  const a = answer.trim().toLowerCase()
  return !(a === '2' || a === 'n' || a === 'no' || a === 'non-ai' || a === 'clean')
}

// ── Slug / ID derivation ──────────────────────────────────────────────────────

export function deriveSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function deriveWorkspaceId(slug: string): string {
  return `wsp_${slug.replace(/-/g, '_')}`
}

// ── File content generators ───────────────────────────────────────────────────

export function scaffoldTangenConfig(opts: WorkspaceScaffoldOptions): string {
  return `import type { TangenConfig } from '@tangen/cms'

/**
 * Thin project config. The canonical setup lives in
 * app/workspaces/index.ts (the registry the API loads) and
 * app/workspaces/${opts.workspaceSlug}/workspace.config.ts. The CLI reads
 * workspaceId from here for setup URLs — no need to duplicate the workspace or
 * environment lists that app/workspaces/ already owns.
 */
const config: TangenConfig = {
  project: '${opts.workspaceSlug}',
  name: '${opts.workspaceName.replace(/'/g, "\\'")}',
  workspaceId: '${opts.workspaceId}',
  schema: './content-objects/index.ts',
}

export default config
`
}

export function scaffoldWorkspaces(opts: WorkspaceScaffoldOptions): string {
  return `import { defineWorkspaces } from '@tangen/cms'

export default defineWorkspaces([
  {
    id: '${opts.workspaceId}',
    name: '${opts.workspaceName}',
    slug: '${opts.workspaceSlug}',
  },
])
`
}



export function scaffoldSiteConfig(): string {
  return `import { defineSiteConfig } from '@tangen/cms'

/**
 * The site's own configuration keys, declared once. Each key says where it
 * may be set (the workspace in tangen.config.ts, the deployment's
 * variables), whether it is a
 * secret REFERENCE (the name of a variable; never the value), and whether a
 * browser may see it. Routes and jobs read \`ctx.config.site.<key>\` and
 * \`ctx.secrets.get('<key>')\`; \`tangen doctor\` explains where each came from.
 */
export default defineSiteConfig({
  // supportEmail: { type: 'string', scopes: ['workspace', 'deployment'], required: true, clientSafe: true },
  // checkoutMode: { type: 'string', scopes: ['workspace', 'deployment'], default: 'test' },
  // stripeApiKey: { type: 'secretRef', secret: true, scopes: ['deployment'], secretRef: 'STRIPE_API_KEY', required: 'production' },
})
`
}

export function scaffoldMembersConfig(): string {
  return `import { defineMembers } from '@tangen/cms'

/**
 * Desired membership, reconciled into every deployment at boot: who is a
 * member, with which workspace role. A member created from here has NO
 * password until invited or reset - credentials never live in code.
 * Members not listed are left alone.
 */
export default defineMembers([
  // { email: 'alice@example.com', role: 'admin' },
  // { email: 'bob@example.com', role: 'editor' },
])
`
}

export function scaffoldIntegrationsConfig(): string {
  return `import { defineIntegrations } from '@tangen/cms'

/**
 * Third-party services this site talks to, declared once. Settings are
 * values by layer (workspace, deployment); credentials are REFERENCES the
 * deployment supplies - production binds its own (fallback 'forbidden' by
 * default), never a test key inherited from a config file. Routes and jobs
 * read \`ctx.integration('stripe')\`: values, secrets, ready.
 */
export default defineIntegrations({
  // stripe: {
  //   config: { mode: { type: 'string', default: 'test', clientSafe: true } },
  //   secrets: { apiKey: { secretRef: 'STRIPE_API_KEY' }, webhookSecret: { secretRef: 'STRIPE_WEBHOOK_SECRET', required: false } },
  // },
})
`
}

export function scaffoldTsconfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      // Node globals (process.env, etc.) used across config files.
      types: ['node'],
    },
    include: ['app'],
    exclude: ['node_modules'],
  }, null, 2) + '\n'
}

/** `tangen push`/`check` type-check schema files against this project. */
export function scaffoldSchemaTsconfig(): string {
  return JSON.stringify({
    extends: './tsconfig.json',
    compilerOptions: { noEmit: true },
    // app/generated is included ON PURPOSE: those files are written by push's
    // codegen, and a codegen bug that emits invalid TS must fail `tangen
    // check` / dev-boot rather than ship silently (finding #16).
    include: ['app/content-objects/**/*.ts', 'app/generated/**/*.ts'],
    exclude: ['node_modules'],
  }, null, 2) + '\n'
}

export function scaffoldContentTablesStub(): string {
  return `// Generated by \`tangen push\` - the Drizzle table registry for your content
// types. COMMITTED to git on purpose: it survives \`npm i\` / Tangen upgrades and
// is shared between developers. Empty until your first push.
export const contentTables = {}
`
}

export function scaffoldContentIndex(): string {
  return `import { defineSchema } from '@tangen/cms'

// Add your content types here.
// Example:
// import { Post } from './post'
// export default defineSchema({ types: [Post] })

export default defineSchema({ types: [] })
`
}

export function scaffoldApiIndex(): string {
  return `import { helloRoute } from './hello/route'

// Register all custom routes here.
// Each route file exports a CustomRoute object — add the import and include it below.
// Routes are served under /api/v1/custom/<path> (workspace + env resolved from the key).
export default [
  helloRoute,
]
`
}

export function scaffoldAdminIndex(): string {
  return `// Admin panel extension surface - custom pages, bulk actions, shared UI.
// pages/  → full admin pages (register below via extension.routes)
// actions/ → bulk/row-action modal components (APP_UI_REGISTRY)
// components/ → shared React components used by your pages
// Reference: docs/extending-admin.md
import type { AdminExtension, AdminUIComponent } from '@tangen/cms'

export const APP_UI_REGISTRY: Record<string, AdminUIComponent> = {}
export const APP_BULK_ACTIONS: Record<string, unknown> = {}
export const extension: AdminExtension = { routes: [] }
`
}

export function scaffoldApiHelloRoute(): string {
  return `import type { CustomRoute } from '@tangen/cms'

/**
 * GET /hello
 *
 * Example custom route — replace or delete this file when you add real routes.
 *
 * URL:  GET /api/v1/custom/hello
 * Auth: any valid API Manager key
 *
 * Example:
 *   curl https://your-domain.com/api/v1/custom/hello \\
 *     -H "Authorization: Bearer tgn_..."
 *
 * To scope this route to a specific permission in the API Manager, add apiGroup:
 *   apiGroup: { id: 'hello', label: 'Hello API', action: 'Read' }
 */
export const helloRoute: CustomRoute = {
  method: 'GET',
  path: '/hello',
  auth: 'key',

  async handler(ctx) {
    // Return a plain value — the router serializes it to JSON.
    return { message: 'Hello from Tangen!', workspace: ctx.workspaceId }
  },
}
`
}

/**
 * The platform range a fresh project pins. The platform packages
 * (cms / api / admin / cli) move together, so one range covers them: a new
 * project takes patch and minor updates and never a major without a
 * deliberate edit. See docs/public-contract.md.
 *
 * On a 0.x line a MINOR is where a breaking change belongs, so `^0.1` does
 * not admit `0.2.0` and this constant moves with the line. It went to `^0.2`
 * for the 0.2.0 release (the Gateway enforcing CORS and rate limits).
 * `scripts/release.test.ts` fails with the exact mismatch when it is stale,
 * which is why `release:version` ends by running the release guards.
 */
export const PLATFORM_RANGE = '^0.2'

export function scaffoldPackageJson(opts: WorkspaceScaffoldOptions): string {
  return JSON.stringify(
    {
      name: opts.projectFolder === '.' ? opts.workspaceSlug : opts.projectFolder,
      private: true,
      type: 'module',
      scripts: {
        dev: 'tangen dev',
        start: 'tangen start',
        push: 'tangen push',
        types: 'tangen types',
      },
      // A compatible RANGE, not `latest`: two projects scaffolded a week
      // apart should be the same project, and a breaking platform release
      // should not arrive silently in the next `bun install`. The platform
      // packages move together, so they carry one range (Phase 7, Unit 6).
      dependencies: {
        '@tangen/cms': PLATFORM_RANGE,
        '@tangen/api': PLATFORM_RANGE,
        '@tangen/admin': PLATFORM_RANGE,
      },
      // The scripts above call `tangen`; without this they only work when the
      // CLI happens to be installed globally.
      // Type-checking the config + schema (used by `tangen check`/`push`, your
      // editor, and `tangen dev`'s startup check). @types/node provides the
      // `process`/global types the config files rely on.
      devDependencies: {
        '@tangen/cli': PLATFORM_RANGE,
        typescript: '^5',
        '@types/node': '^22',
      },
    },
    null,
    2,
  ) + '\n'
}

/**
 * First free port at or after `start` (checks up to 20 candidates).
 * A wildcard bind alone misses listeners bound to a single loopback (e.g. a
 * vite on [::1]), so a port only counts as free when nothing ACCEPTS on
 * either loopback AND the wildcard bind succeeds.
 */
export async function findFreePort(start: number): Promise<number> {
  const net = await import('node:net')
  const accepts = (host: string, port: number) => new Promise<boolean>((resolve) => {
    const sock = net.connect({ host, port, timeout: 300 })
    sock.once('connect', () => { sock.destroy(); resolve(true) })
    sock.once('error', () => resolve(false))
    sock.once('timeout', () => { sock.destroy(); resolve(false) })
  })
  for (let port = start; port < start + 20; port++) {
    if (await accepts('127.0.0.1', port) || await accepts('::1', port)) continue
    const bindable = await new Promise<boolean>((resolve) => {
      const srv = net.createServer()
      srv.once('error', () => resolve(false))
      srv.listen(port, () => srv.close(() => resolve(true)))
    })
    if (bindable) return port
  }
  return start
}

/**
 * The real .env — ports probed free at scaffold time and a generated
 * JWT_SECRET, so the only thing left for the user is the database URL.
 */
export function scaffoldEnv(opts: WorkspaceScaffoldOptions, ports: { api: number; admin: number }, jwtSecret: string): string {
  return `# ${opts.workspaceName} - local environment (never commit this file)

# This deployment's Postgres connection${opts.databaseUrl ? ' (verified by tangen create)' : ' - the one thing left to fill in'}.
# One deployment holds one database; a staging or production deployment sets
# its own DATABASE_URL (and TANGEN_DEPLOYMENT_ROLE=staging|production).
DATABASE_URL=${opts.databaseUrl ?? ''}

# Ports were checked free when this project was scaffolded.
PORT=${ports.api}
ADMIN_PORT=${ports.admin}

# Your FRONT-END site (any framework). Live preview loads + targets this URL - see
# docs/live-preview.md. Defaults to :4321 if unset; this is NOT the admin (:${ports.admin}).
FRONTEND_URL=http://localhost:4321
# FRONTEND_PREVIEW_URL=http://localhost:4321/preview?id={id}&type={type}

JWT_SECRET=${jwtSecret}
`
}

export function scaffoldEnvExample(opts: WorkspaceScaffoldOptions): string {
  return `# ${opts.workspaceName} - environment variables
# Copy this file to .env and fill in your values.
# Never commit .env to version control.

# ── This deployment ────────────────────────────────────────────────────────────
# One deployment = one build, one database, one role. Every deployment of this
# project (your machine, staging, production) sets these for itself.
DATABASE_URL=postgres://localhost:5432/${opts.workspaceSlug}_dev
# TANGEN_DEPLOYMENT_ROLE=development   # staging | production on those deployments

# ── Ports and URLs ─────────────────────────────────────────────────────────────
PORT=3000
ADMIN_PORT=3001
SERVER_URL=
ADMIN_URL=
# Your FRONT-END site (any framework) - used by live preview + CORS. Not the admin. :4321 default.
FRONTEND_URL=http://localhost:4321
# FRONTEND_PREVIEW_URL=http://localhost:4321/preview?id={id}&type={type}
# Required - min 32 chars: openssl rand -hex 32
JWT_SECRET=

# ── Redis (optional - background task queue, caching, locks) ──────────────────
# Unset means Redis is missing (reported; PostgreSQL serves instead).
# REDIS_ENABLED=false means you switched it off on purpose.
# REDIS_URL=redis://localhost:6379
# REDIS_ENABLED=false

# ── Media storage (optional - docs/storage.md; default: local public/media) ───
# MEDIA_DIR=
# MEDIA_PUBLIC_BASE_URL=
# For storage: { adapter: 's3' } in an environment:
# AWS_S3_BUCKET=
# AWS_S3_REGION=
# AWS_S3_ENDPOINT=
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=

# ── Mail (optional - docs/mail.md) ─────────────────────────────────────────────
# MAIL_FROM=noreply@example.com
# SMTP_HOST=localhost
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# The SendGrid or Resend key: config/mail.ts names the variable (apiKey: 'RESEND_API_KEY')
# RESEND_API_KEY=

# ── Content AI provider keys (optional - docs/content-ai.md) ──────────────────
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
# GEMINI_API_KEY=
`
}

export function scaffoldGitignore(): string {
  return `.env
node_modules/
dist/
.turbo/
*.log

# Generated: derived TS types regenerate on push (ignore); the content-tables
# registry (app/generated/content-tables.ts) IS committed - it's your schema.
app/generated/*.d.ts
`
}

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Scaffolds all project files for a new Tangen workspace, installs dependencies,
 * and copies .env.example → .env ready to fill in.
 */
export async function runCreateCommand(
  opts: WorkspaceScaffoldOptions,
  targetDir: string,
): Promise<void> {
  const { c, sym } = await import('../ui')

  const inPlace = opts.projectFolder === '.'
  const projectRoot = inPlace ? targetDir : join(targetDir, opts.projectFolder)
  const workspaceDir = join(projectRoot, 'app')

  if (inPlace) {
    // Scaffolding into cwd is fine as long as it holds nothing but dotfiles
    // (.npmrc, .git…) — anything else and we might clobber real work.
    const { readdirSync } = await import('fs')
    const visible = readdirSync(projectRoot).filter((f) => !f.startsWith('.'))
    if (visible.length > 0) {
      throw new Error(`Current directory is not empty (found: ${visible.slice(0, 3).join(', ')}${visible.length > 3 ? ', …' : ''})`)
    }
  } else if (existsSync(projectRoot)) {
    throw new Error(`Folder "${opts.projectFolder}" already exists`)
  }

  console.log()
  console.log(
    `  ${c.bold(c.cyan('◆'))} ${c.bold('tangen')}  ${c.dim('creating workspace')} ${c.cyan(opts.workspaceName)}`,
  )
  console.log()

  // Probe free ports up front so the printed URLs and the scaffolded .env are
  // honest even when another stack already holds 3000/3001.
  const apiPort = await findFreePort(3000)
  const adminPort = await findFreePort(Math.max(3001, apiPort + 1))
  const { randomBytes } = await import('node:crypto')
  const jwtSecret = randomBytes(32).toString('hex')

  const files: Array<[string, string]> = [
    [join(projectRoot, 'package.json'), scaffoldPackageJson(opts)],
    [join(projectRoot, '.env'), scaffoldEnv(opts, { api: apiPort, admin: adminPort }, jwtSecret)],
    [join(projectRoot, '.env.example'), scaffoldEnvExample(opts)],
    [join(projectRoot, '.gitignore'), scaffoldGitignore()],
    [join(projectRoot, 'tsconfig.json'), scaffoldTsconfig()],
    [join(projectRoot, 'tsconfig.schema.json'), scaffoldSchemaTsconfig()],
    // Primary workspace — everything the site developer touches lives here
    [join(workspaceDir, 'tangen.config.ts'), scaffoldTangenConfig(opts)],
    // The site's own configuration keys (Stage 2: one resolver for everything).
    [join(workspaceDir, 'config', 'site.ts'), scaffoldSiteConfig()],
    // Desired membership (Stage 3 D): reconciled into each deployment at boot.
    [join(workspaceDir, 'config', 'members.ts'), scaffoldMembersConfig()],
    // Code-declared integrations (Stage 3 E): registry fragments on the same resolver.
    [join(workspaceDir, 'config', 'integrations.ts'), scaffoldIntegrationsConfig()],
    // The extension registry - the one place a project declares extensions.
    // `tangen extension create` and `tangen extension install` patch THIS file.
    [join(workspaceDir, 'config', 'extensions.ts'), scaffoldExtensionsConfig()],
    [join(workspaceDir, 'workspaces', 'index.ts'), scaffoldWorkspaces(opts)],
    [join(workspaceDir, 'content-objects', 'index.ts'), scaffoldContentIndex()],
    // Committed generated schema registry (survives npm i; the loader reads it)
    [join(workspaceDir, 'generated', 'content-tables.ts'), scaffoldContentTablesStub()],
    // Reusable-component registry — the schema builder rewrites this barrel
    [join(workspaceDir, 'components', 'index.ts'), 'export default []\n'],
    // Custom API routes barrel and example route
    [join(workspaceDir, 'api', 'index.ts'), scaffoldApiIndex()],
    [join(workspaceDir, 'api', 'hello', 'route.ts'), scaffoldApiHelloRoute()],
    // Admin extension registry — pages/, components/, actions/ grow from here
    [join(workspaceDir, 'admin', 'index.ts'), scaffoldAdminIndex()],
    // Per-workspace config — extensions, routes, and env overrides for the master workspace
    [join(workspaceDir, 'workspaces', opts.workspaceSlug, 'workspace.config.ts'), scaffoldMasterWorkspaceConfig(opts)],
  ]

  for (const [filePath, content] of files) {
    // In-place scaffolds tolerate pre-existing dotfiles — never clobber a .env the user brought.
    if (filePath.endsWith('/.env') && existsSync(filePath)) continue
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, content, 'utf8')
    const rel = filePath.replace(projectRoot + '/', '')
    console.log(`  ${sym.tick}  ${c.dim(rel)}`)
  }

  // Install dependencies (skippable - tests and CI dry runs scaffold only)
  let installFailed = false
  if (!opts.skipInstall) {
    console.log()
    console.log(`  ${c.dim('○')}  Installing dependencies...`)
    const pm = detectPackageManager()
    try {
      // Array argv — no shell involved, no injection surface
      const proc = Bun.spawnSync([pm, 'install'], {
        cwd: projectRoot,
        stdout: 'ignore',
        stderr: 'pipe',
      })
      if (proc.exitCode !== 0) throw new Error(proc.stderr?.toString().trim().split('\n').slice(-4).join('\n') || `${pm} install exited ${proc.exitCode}`)
      console.log(`  ${sym.tick}  ${pm} install`)
    } catch (err: any) {
      installFailed = true
      console.log(`  ${sym.warn}  Install failed - run ${pm} install manually`)
      if (err?.message) console.log(c.dim(String(err.message).replace(/^/gm, '     ')))
    }
  }

  // AI Companion Mode — write agent rules + MCP config (same writer as
  // `tangen ai init`, so the two never drift). Opt out with --no-ai / Non-AI Mode.
  const companion = opts.ai !== false
  if (companion) {
    console.log()
    console.log(`  ${c.dim('○')}  AI Companion Mode - agent rules + MCP config…`)
    const { runAiInit } = await import('./ai')
    const { written } = runAiInit(projectRoot, { force: false })
    for (const f of written) console.log(`  ${sym.tick}  ${c.dim(f)}`)
  }

  // Next steps
  console.log()
  console.log(`  ${sym.tick}  ${c.bold(`Workspace "${opts.workspaceName}" created`)}${companion ? c.dim('  · AI Companion Mode') : ''}`)
  console.log()
  console.log(`  ${c.bold('Next steps:')}`)
  console.log()
  let step = 0
  const cdHint = opts.projectFolder === '.' ? '' : `      ${c.cyan(`cd ${opts.projectFolder}`)}\n`
  if (!opts.databaseUrl) {
    console.log(
      `  ${c.dim(`${++step}.`)}  Configure your database\n` + cdHint +
      `      Open ${c.cyan('.env')} and set ${c.yellow('DATABASE_URL')}\n` +
      `      ${c.dim(`(ports ${apiPort}/${adminPort} and a JWT secret are already filled in)`)}`,
    )
  } else if (cdHint) {
    console.log(`  ${c.dim(`${++step}.`)}  ${cdHint.trim()}`)
  }
  // The files exist either way, so the workspace WAS created. But every step
  // below needs the dependencies, so a failed install leads rather than being
  // a warning the reader has already scrolled past.
  if (installFailed) {
    console.log(
      `  ${c.dim(`${++step}.`)}  ${c.bold('Install the dependencies')} ${c.dim('- the steps below need them')}\n` +
      (opts.projectFolder === '.' ? '' : `      ${c.cyan(`cd ${opts.projectFolder}`)}\n`) +
      `      ${c.cyan(`${detectPackageManager()} install`)}`,
    )
  }
  console.log()
  console.log(
    `  ${c.dim(`${++step}.`)}  Create the database tables\n` +
    `      ${c.cyan('npx tangen bootstrap development')}`,
  )
  console.log()
  console.log(
    `  ${c.dim(`${++step}.`)}  Start the API + admin\n` +
    `      ${c.cyan('npm run dev')}`,
  )
  console.log()
  console.log(
    `  ${c.dim(`${++step}.`)}  Open the admin panel and create your admin account\n` +
    `      ${c.cyan(`http://localhost:${adminPort}`)}`,
  )
  // Companion Mode writes skills and MCP config, but every AI feature is dead
  // until a provider key exists - say so HERE instead of letting the first
  // "generate" click fail mysteriously (finding #8).
  if (companion) {
    console.log()
    console.log(
      `  ${c.dim(`${++step}.`)}  Give the AI a provider key (Companion Mode needs one)\n` +
      `      Uncomment ${c.yellow('ANTHROPIC_API_KEY')} or ${c.yellow('OPENAI_API_KEY')} in ${c.cyan('.env')} and set it`,
    )
  }
  console.log()
}

/**
 * Detects the package manager to use for dependency installation.
 * @returns 'bun' when the bun binary is available, otherwise 'npm'.
 */
export function detectPackageManager(userAgent = process.env.npm_config_user_agent): string {
  // Whoever invoked us (npx → npm, bunx → bun) already resolved this registry
  // successfully — install with the same tool so .npmrc/bunfig semantics match.
  if (userAgent) {
    const tool = userAgent.split('/')[0]
    if (['npm', 'bun', 'pnpm', 'yarn'].includes(tool)) return tool
  }
  try {
    const proc = Bun.spawnSync(['bun', '--version'], { stdout: 'ignore', stderr: 'ignore' })
    return proc.exitCode === 0 ? 'bun' : 'npm'
  } catch {
    return 'npm'
  }
}

// ── Workspace registry helpers ────────────────────────────────────────────────

/**
 * Extracts workspaceId and slug (project) from the text of a tangen.config.ts file.
 * Uses regex — no import/eval needed. Returns null if either field is absent.
 */
export function readWorkspaceBasics(configText: string): { workspaceId: string; slug: string } | null {
  const idMatch = configText.match(/workspaceId:\s*['"]([^'"]+)['"]/)
  const slugMatch = configText.match(/project:\s*['"]([^'"]+)['"]/)
  if (!idMatch || !slugMatch) return null
  return { workspaceId: idMatch[1], slug: slugMatch[1] }
}

/**
 * Bootstraps app/workspaces/index.ts from an existing app/tangen.config.ts.
 * No-op if the registry already exists.
 */
export function initializeWorkspacesConfig(projectRoot: string): void {
  const registryPath = join(projectRoot, 'app', 'workspaces', 'index.ts')
  if (existsSync(registryPath)) return

  const found: Array<{ workspaceId: string; slug: string }> = []

  // Check app/tangen.config.ts first
  const appConfig = join(projectRoot, 'app', 'tangen.config.ts')
  if (existsSync(appConfig)) {
    const basics = readWorkspaceBasics(readFileSync(appConfig, 'utf8'))
    if (basics) found.push(basics)
  }


  function slugToName(slug: string): string {
    return slug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const entryBlocks = found.map(({ workspaceId, slug }) =>
    '  {\n' +
    "    id: '" + workspaceId + "',\n" +
    "    name: '" + slugToName(slug) + "',\n" +
    "    slug: '" + slug + "',\n" +
    '  },'
  )

  const body = entryBlocks.length > 0
    ? '[\n' + entryBlocks.join('\n') + '\n]'
    : '[]'

  const content =
    "import { defineWorkspaces } from '@tangen/cms'\n\n" +
    'export default defineWorkspaces(' + body + ')\n'

  mkdirSync(join(projectRoot, 'app', 'workspaces'), { recursive: true })
  writeFileSync(registryPath, content, 'utf8')
}

/**
 * Template for a child workspace config (created by `tangen workspace create`).
 * Passes masterSlug so the JSDoc reference points at the right master file.
 */
export function scaffoldPerWorkspaceConfig(
  opts: WorkspaceScaffoldOptions,
  masterSlug?: string,
): string {
  const slugConst = opts.workspaceSlug.toUpperCase().replace(/-/g, '_')
  const masterRef = masterSlug
    ? ` * Reference: app/workspaces/${masterSlug}/workspace.config.ts  ← master config\n`
    : ''
  return `import { defineWorkspace } from '@tangen/cms'

/**
 * "${opts.workspaceName}" workspace config
 *
 * This extends the "${masterSlug ?? 'master'}" workspace — extensions and routes defined here
 * are MERGED with (appended to) the master's list, not replaced.
 *
${masterRef} * To override completely, explicitly list every plugin/route you want.
 */
export default defineWorkspace({
  name: '${opts.workspaceName}',
  workspaceId: '${opts.workspaceId}',

  // ── Schemas ───────────────────────────────────────────────────────────────────
  // Content types are defined in app/content-objects/index.ts and shared across all workspaces.
  // Each workspace is row-isolated (separate data), not structure-isolated.
  // Do not define schemas here — they are ignored on child workspaces.

  // ── Additional extensions (optional) ─────────────────────────────────────────
  // MERGED with the master workspace's extensions — does not replace them.
  // The master's run first; these run after.
  //
  // extensions: [
  //   myPlugin({ option: true }),
  // ],

  // ── Exclude master extensions (optional) ─────────────────────────────────────
  // Drop specific master extensions for this workspace only.
  //
  // excludeExtensions: [
  //   '../../extensions/seo',   // ← resolve path as declared in the master config
  // ],

  // ── Additional routes (optional) ─────────────────────────────────────────────
  // Appended after master routes — does not replace them.
  // Assign a 'group' so other workspaces can drop these via excludeRouteGroups.
  //
  // routes: [
  //   {
  //     method: 'GET',
  //     path: '/api/${opts.workspaceSlug}/hello',
  //     group: '${opts.workspaceSlug}-api',
  //     auth: 'key',
  //     handler: async (ctx) => ctx.json({ workspace: '${opts.workspaceSlug}' }),
  //   },
  // ],

  // ── Exclude master route groups (optional) ───────────────────────────────────
  // Drop a route group inherited from the master.
  //
  // excludeRouteGroups: [
  //   'blog-api',   // ← 'group' value as declared in the master routes
  // ],
})
`
}

/**
 * Template for the master workspace config (created by `tangen create`).
 * Plugins and routes here are inherited by all child workspaces.
 */
/** app/config/extensions.ts - the one place a project declares extensions. */
export function scaffoldExtensionsConfig(): string {
  return `import { defineExtensions } from '@tangen/cms'

// Extensions this project declares. SEO, Flows and Notes ARRIVE WITH @tangen/cms -
// they are not dependencies of this project and you never install them.
//
// Declaring one makes it available. Installing and enabling it lives in
// the database, per workspace:
//   tangen extension install seo                      # this workspace
//   tangen extension install seo --workspace shop     # one named in app/workspaces/index.ts
//   tangen extension list
//
// Add your own with a package specifier, e.g. { resolve: '@acme/analytics' } -
// or just \`bun add\` the package and \`tangen extension install <id>\`: install
// declares a package the project has. \`tangen extension create\` appends here.
export default defineExtensions([
  { resolve: '@tangen/ext-seo' },
  { resolve: '@tangen/ext-flows' },
  { resolve: '@tangen/ext-notes' },
  { resolve: '@tangen/ext-forms' },
  { resolve: '@tangen/ext-auth' },
])
`
}

export function scaffoldMasterWorkspaceConfig(opts: WorkspaceScaffoldOptions): string {
  return `import { defineWorkspace } from '@tangen/cms'
import schema from '../../content-objects'
import components from '../../components'
import extensions from '../../config/extensions'
import routes from '../../api'
// tangen:imports

/**
 * "${opts.workspaceName}" master workspace config
 *
 * Extensions and routes defined here are inherited by every child workspace.
 * A child can extend, exclude, or add to them via its own
 * app/workspaces/<slug>/workspace.config.ts.
 *
 * Custom routes live in app/api/ — add new files there and export them from
 * app/api/index.ts. They are served under /api/v1/custom/<path>.
 */
export default defineWorkspace({
  name: '${opts.workspaceName}',
  workspaceId: '${opts.workspaceId}',

  // ── Schemas ───────────────────────────────────────────────────────────────────
  // Imported in-process so field-level behavior (hooks, dynamic options,
  // validate functions) reaches the API. Structure still flows through
  // \`tangen push\` into the database.
  schemas: schema.types,

  // ── Reusable components ──────────────────────────────────────────────────────
  // app/components/index.ts — the schema builder maintains this registry.
  components,

  // ── Extensions ───────────────────────────────────────────────────────────────
  // Declared in app/config/extensions.ts. All child workspaces inherit these
  // unless they call excludeExtensions. Installing and enabling lives in the
  // database - declaring one here only makes it available.
  extensions,

  // ── Routes ───────────────────────────────────────────────────────────────────
  // Loaded from app/api/index.ts. All child workspaces inherit these unless they
  // call excludeRouteGroups. Assign a 'group' to each route in app/api/ so
  // children can selectively exclude them.
  routes,

  // ── Features ─────────────────────────────────────────────────────────────────
  // \`tangen enable <feature>\` wires optional packages (graphql, auth, …)
  // in right here. Keep the marker below so enabling stays deterministic.
  // tangen:features
})
`
}

// ── Workspace add (existing project) ─────────────────────────────────────────

/**
 * Appends a new workspace entry to app/workspaces/index.ts.
 * Inserts before the closing ]) of the defineWorkspaces([...]) call.
 * No-op if the file does not exist.
 */
export function appendWorkspaceToConfig(
  projectRoot: string,
  opts: WorkspaceScaffoldOptions,
  masterSlug?: string,
): void {
  const configPath = join(projectRoot, 'app', 'workspaces', 'index.ts')
  if (!existsSync(configPath)) return

  const existing = readFileSync(configPath, 'utf8')
  const entryParts = [
    '  {',
    "    id: '" + opts.workspaceId + "',",
    "    name: '" + opts.workspaceName + "',",
    "    slug: '" + opts.workspaceSlug + "',",
    masterSlug ? ("    master: '" + masterSlug + "',") : null,
    '  },',
  ].filter(Boolean) as string[]

  const newEntry = entryParts.join('\n')
  const updated = existing.replace(/(\])\s*\)\s*$/, newEntry + '\n$1)')
  writeFileSync(configPath, updated + (existing.endsWith('\n') ? '' : '\n'), 'utf8')
}


/**
 * Removes a workspace entry from app/workspaces/index.ts by slug.
 * Matches the entire { ... } block that contains `slug: '<slug>'`.
 * Returns the removed workspace's name, or null if not found.
 */
export function removeWorkspaceFromConfig(
  projectRoot: string,
  slug: string,
): string | null {
  const configPath = join(projectRoot, 'app', 'workspaces', 'index.ts')
  if (!existsSync(configPath)) return null

  const source = readFileSync(configPath, 'utf8')

  // Match the object block containing this slug — handles multi-line blocks with trailing comma
  const blockRe = /\n?\s*\{[^{}]*slug:\s*['"]SLUG['"][^{}]*\},?/g.source.replace('SLUG', slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const nameMatch = source.match(new RegExp(`name:\\s*['"]([^'"]+)['"]`))
  const blockMatch = source.match(new RegExp(blockRe))
  if (!blockMatch) return null

  // Extract the name before removing (for the confirmation message)
  // Find the name within the matched block
  const block = blockMatch[0]
  const nameInBlock = block.match(/name:\s*['"]([^'"]+)['"]/)
  const removedName = nameInBlock?.[1] ?? slug

  const updated = source.replace(new RegExp(blockRe), '')
  writeFileSync(configPath, updated, 'utf8')
  return removedName
}

/**
 * Removes a workspace from the project:
 * 1. Shows warnings (master inheritance, destructive nature)
 * 2. Asks for confirmation
 * 3. Removes the registry entry and deletes app/workspaces/<slug>/
 */
export async function runWorkspaceRemoveCommand(
  slug: string,
  projectRoot: string,
  { skipConfirm = false }: { skipConfirm?: boolean } = {},
): Promise<void> {
  const { rmSync } = await import('fs')
  const { createInterface } = await import('readline')
  const { c, sym } = await import('../ui')

  const configPath = join(projectRoot, 'app', 'workspaces', 'index.ts')
  if (!existsSync(configPath)) {
    throw new Error('No workspace registry found at app/workspaces/index.ts')
  }

  const source = readFileSync(configPath, 'utf8')

  if (!source.includes(`slug: '${slug}'`) && !source.includes(`slug: "${slug}"`)) {
    throw new Error(`Workspace "${slug}" not found in the registry`)
  }

  // Find child workspaces that inherit from this one
  const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const childMatches = [...source.matchAll(
    new RegExp(`slug:\\s*['"]([^'"]+)['"][^}]*master:\\s*['"]${escapedSlug}['"]|master:\\s*['"]${escapedSlug}['"][^}]*slug:\\s*['"]([^'"]+)['"]`, 'g'),
  )]
  const childSlugs = childMatches.map(m => m[1] ?? m[2]).filter(Boolean)

  console.log()
  console.log(
    `  ${c.bold(c.red('◆'))} ${c.bold('tangen')}  ${c.dim('removing workspace')} ${c.red(slug)}`,
  )
  console.log()

  // Warning: master inheritance
  if (childSlugs.length > 0) {
    console.log(`  ${sym.warn}  ${c.yellow(`This workspace is the master for: ${c.bold(childSlugs.join(', '))}`)}'`)
    console.log(`     Those workspaces will no longer inherit its extensions and routes.`)
    console.log(`     Update their registry entries (remove the 'master' field) after removal.`)
    console.log()
  }

  // Warning: destructive action
  console.log(`  ${sym.warn}  ${c.yellow('This will remove the workspace from the registry and delete')}`)
  console.log(`     ${c.yellow(`app/workspaces/${slug}/`)}`)
  console.log(`     Data in the database is ${c.bold('NOT')} deleted.`)
  console.log()

  // Confirmation prompt
  if (!skipConfirm) {
    const confirmed = await new Promise<boolean>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      rl.question(`  Type the workspace slug to confirm removal (${c.red(slug)}): `, (answer) => {
        rl.close()
        resolve(answer.trim() === slug)
      })
    })
    if (!confirmed) {
      console.log()
      console.log(`  ${c.dim('Aborted - slug did not match. No changes made.')}`)
      console.log()
      return
    }
    console.log()
  }

  // 1. Remove from registry
  const removedName = removeWorkspaceFromConfig(projectRoot, slug)
  console.log(`  ${sym.tick}  ${c.dim('app/workspaces/index.ts  (entry removed)')}`)

  // 2. Delete workspace directory
  const workspaceDir = join(projectRoot, 'app', 'workspaces', slug)
  if (existsSync(workspaceDir)) {
    rmSync(workspaceDir, { recursive: true, force: true })
    console.log(`  ${sym.tick}  ${c.dim(`app/workspaces/${slug}/  (deleted)`)}`)
  }

  console.log()
  console.log(`  ${sym.tick}  ${c.bold(`Workspace "${removedName ?? slug}" removed`)}`)
  if (childSlugs.length > 0) {
    console.log()
    console.log(
      `  ${sym.warn}  Update ${c.cyan('app/workspaces/index.ts')} - remove or change the` +
      ` ${c.cyan('master')} field on: ${childSlugs.join(', ')}`,
    )
  }
  console.log()
}

export interface WorkspaceCreateOptions {
  noPush?: boolean
  pushFn?: (slug: string, cwd: string) => void | Promise<void>
}

async function defaultPushFn(slug: string, cwd: string): Promise<void> {
  const { runPushForWorkspace } = await import('./push')
  await runPushForWorkspace(slug, [], cwd)
}

/**
 * Adds a new workspace entry to app/workspaces/index.ts.
 * A workspace is a data boundary — no directory is created unless the workspace
 * needs its own extensions or routes (scaffolded via the masterSlug + withCustomCode path).
 */
export async function runWorkspaceCreateCommand(
  opts: WorkspaceScaffoldOptions,
  projectRoot: string,
  masterSlug?: string,
  createOptions: WorkspaceCreateOptions = {},
): Promise<void> {
  const { c, sym } = await import('../ui')

  // Guard: duplicate slug check
  const registryPath = join(projectRoot, 'app', 'workspaces', 'index.ts')
  if (existsSync(registryPath)) {
    const existing = readFileSync(registryPath, 'utf8')
    if (existing.includes("slug: '" + opts.workspaceSlug + "'")) {
      throw new Error('Workspace "' + opts.workspaceSlug + '" already exists in the registry')
    }
  }

  console.log()
  console.log(
    `  ${c.bold(c.cyan('◆'))} ${c.bold('tangen')}  ${c.dim('adding workspace')} ${c.cyan(opts.workspaceName)}`,
  )
  console.log()

  // Bootstrap registry if this is the first workspace being added to an existing project
  if (!existsSync(registryPath)) {
    initializeWorkspacesConfig(projectRoot)
    console.log(`  ${sym.tick}  ${c.dim('app/workspaces/index.ts  (initialized)')}`)
  }

  appendWorkspaceToConfig(projectRoot, opts, masterSlug)
  console.log(`  ${sym.tick}  ${c.dim('app/workspaces/index.ts  (workspace added)')}`)

  // Always scaffold the per-workspace config — standardised layout, not optional
  const workspaceConfigDir = join(projectRoot, 'app', 'workspaces', opts.workspaceSlug)
  const workspaceConfigPath = join(workspaceConfigDir, 'workspace.config.ts')
  mkdirSync(workspaceConfigDir, { recursive: true })
  writeFileSync(workspaceConfigPath, scaffoldPerWorkspaceConfig(opts, masterSlug), 'utf8')
  console.log(`  ${sym.tick}  ${c.dim(`app/workspaces/${opts.workspaceSlug}/workspace.config.ts`)}`)

  const { noPush = false, pushFn = defaultPushFn } = createOptions

  let pushSucceeded = false
  if (noPush) {
    console.log()
    console.log(`  ${sym.warn}  ${c.dim('Skipped push (--no-push). Run')} ${c.cyan(`tangen push --workspace ${opts.workspaceSlug}`)} ${c.dim('to activate.')}`)
  } else {
    console.log()
    console.log(`  ${c.dim('○')}  Registering workspace "${opts.workspaceSlug}"...`)
    try {
      await pushFn(opts.workspaceSlug, projectRoot)
      console.log(`  ${sym.tick}  ${c.dim('tangen push --workspace')} ${c.cyan(opts.workspaceSlug)}`)
      pushSucceeded = true
    } catch {
      console.log(`  ${sym.warn}  Push failed - run ${c.cyan(`tangen push --workspace ${opts.workspaceSlug}`)} manually`)
    }
  }

  // The setup URL from the deployment's frontend URL (best-effort)
  let setupUrl: string | null = null
  try {
    const { resolveProjectDeployment } = await import('@tangen/types')
    const frontendUrl = resolveProjectDeployment({ project: { workspaceId: opts.workspaceId } }).get<string>('frontend.url')
    if (frontendUrl) setupUrl = `${frontendUrl.replace(/\/$/, '')}/${opts.workspaceId}/setup`
  } catch { /* best-effort */ }

  console.log()
  console.log(`  ${sym.tick}  ${c.bold(`Workspace "${opts.workspaceName}" added`)}`)
  console.log()
  console.log(`  ${c.bold('Next steps:')}`)
  console.log()

  let step = 1

  if (!pushSucceeded && !noPush) {
    console.log(
      `  ${c.dim(`${step++}.`)}  Push the workspace to the database\n` +
      `      ${c.cyan(`tangen push --workspace ${opts.workspaceSlug}`)}`,
    )
    console.log()
  }

  if (setupUrl) {
    console.log(
      `  ${c.dim(`${step++}.`)}  ${c.yellow('Complete workspace setup')} - creates the first admin member\n` +
      `      ${c.cyan(setupUrl)}`,
    )
  } else {
    console.log(
      `  ${c.dim(`${step++}.`)}  ${c.yellow('Complete workspace setup')} - open the admin panel and go to\n` +
      `      ${c.cyan(`/${opts.workspaceId}/setup`)} to create the first member`,
    )
  }

  if (masterSlug) {
    console.log()
    console.log(
      `  ${c.dim('Tip:')}  This workspace inherits extensions and routes from "${masterSlug}".\n` +
      `       Customise ${c.cyan(`app/workspaces/${opts.workspaceSlug}/workspace.config.ts`)} to add or exclude extensions.\n` +
      `       Restart the server after adding extensions or routes.`,
    )
  }
  console.log()
}

// ── Interactive prompt ────────────────────────────────────────────────────────

export async function promptForWorkspaceDetails(folderArg?: string, aiFlag?: boolean): Promise<WorkspaceScaffoldOptions> {
  const { createInterface } = await import('readline')
  const { c } = await import('../ui')
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  function ask(question: string, defaultValue = ''): Promise<string> {
    return new Promise((resolve) => {
      const hint = defaultValue ? c.dim(` (${defaultValue})`) : ''
      rl.question(`  ${c.bold('?')}  ${question}${hint}:  `, (answer) => {
        resolve(answer.trim() || defaultValue)
      })
    })
  }

  console.log()
  console.log(
    `  ${c.bold(c.cyan('◆'))} ${c.bold('tangen')}  ${c.dim('workspace setup')}`,
  )
  console.log()

  // Folder first (where the code lives), then workspace identity — the slug
  // always derives from the workspace NAME, never from the folder.
  const projectFolder = folderArg ?? (await ask('Project folder', 'my-tangen-app'))
  const humanized = projectFolder === '.'
    ? 'My Workspace'
    : projectFolder.replace(/[-_]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
  const workspaceName = await ask('Workspace name', humanized)
  const workspaceSlug = deriveSlug(workspaceName)
  const workspaceId = deriveWorkspaceId(workspaceSlug)

  // Optional but validated: a working DB string means .env is complete and
  // bootstrap can run immediately. Blank skips — fill .env later.
  let databaseUrl: string | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = (await ask(attempt === 0 ? 'Postgres connection string (Enter to skip)' : 'Try again (Enter to skip)')).trim()
    if (!url) break
    process.stdout.write(`     ${c.dim('checking connection…')} `)
    if (await checkPostgres(url)) {
      console.log(c.dim('connected'))
      databaseUrl = url
      break
    }
    console.log(c.dim('could not connect'))
  }

  // Development mode — AI Companion Mode writes agent rules + MCP config so a
  // coding agent (Claude Code, Codex, …) starts with correct context.
  let ai = aiFlag
  if (ai === undefined) {
    console.log()
    console.log(`  ${c.bold('Development mode:')}`)
    console.log(`    ${c.cyan('1)')} AI Companion Mode  ${c.dim('(recommended)')} - agent rules + MCP config`)
    console.log(`    ${c.dim('2)')} Non-AI Mode        ${c.dim('- a clean project, no agent files')}`)
    ai = parseCompanionChoice(await ask('Choose', '1'))
  }

  rl.close()

  return { workspaceName, workspaceSlug, workspaceId, projectFolder, databaseUrl, ai }
}

/**
 * Prompt for `tangen workspace create` — runs inside an existing project,
 * so no project folder question (the cwd is already the project root).
 */
export async function promptForNewWorkspace(): Promise<WorkspaceScaffoldOptions> {
  const { createInterface } = await import('readline')
  const { c } = await import('../ui')
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  function ask(question: string, defaultValue = ''): Promise<string> {
    return new Promise((resolve) => {
      const hint = defaultValue ? c.dim(` (${defaultValue})`) : ''
      rl.question(`  ${c.bold('?')}  ${question}${hint}:  `, (answer) => {
        resolve(answer.trim() || defaultValue)
      })
    })
  }

  console.log()
  console.log(
    `  ${c.bold(c.cyan('◆'))} ${c.bold('tangen')}  ${c.dim('add workspace')}`,
  )
  console.log()

  const workspaceName = await ask('Workspace name')
  if (!workspaceName) {
    rl.close()
    throw new Error('Workspace name is required')
  }
  const derivedSlug = deriveSlug(workspaceName)
  const workspaceSlug = await ask('Workspace slug', derivedSlug)
  const workspaceId = deriveWorkspaceId(workspaceSlug)
  const masterSlug = await ask('Master workspace slug (optional - leave blank for none)', '')

  rl.close()

  return { workspaceName, workspaceSlug, workspaceId, projectFolder: workspaceSlug, masterSlug: masterSlug || undefined }
}
