/**
 * File Name: dev.ts
 * Purpose: `tangen dev` — run the API server and admin panel for THIS project,
 *          whether it's the platform monorepo or an npm-consumer install
 *          (Strapi model: the packages ship source; bun runs the API's
 *          TypeScript, vite runs the admin per-project so app/admin
 *          extensions compile in). `tangen start` runs the API alone.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { resolveProcessDatabase, resolveDeploymentRole } from '@tangen/types'
import { existsSync, readFileSync, watch } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn, type ChildProcess } from 'node:child_process'

/** Minimal .env parser — KEY=VALUE per line, `#` comments, optional quotes. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key) out[key] = val
  }
  return out
}

/** `DATABASE_URL` as the .env file or the process sets it; empty strings count as unset. */
export function resolveDevDatabaseUrl(env: Record<string, string | undefined>): string | undefined {
  const url = env.DATABASE_URL?.trim()
  return url || undefined
}

/**
 * The database a SERVING process uses: `DATABASE_URL`, through the resolver
 * the API boots with. A development process without one gets the local
 * default; a staging or production process is refused there, never served
 * a database it was not given.
 */
export function serveDatabaseUrl(env: Record<string, string | undefined>): string {
  return resolveProcessDatabase(env).url
}


/** Hide the password before printing a connection string. */
export function redactDbUrl(url: string): string {
  return url.replace(/:\/\/([^:/@]+):[^@]*@/, '://$1:***@')
}

/**
 * Whether a change under app/ should restart the API. Schema, config, route and
 * the generated content-tables.ts do (the API loads them via dynamic import,
 * which bun --watch doesn't track from a node_modules entry). The derived
 * *.d.ts types don't — `tangen push` regenerates them, and restarting on them
 * would loop; the API never reads them at runtime.
 */
export function shouldTriggerRestart(filename: string | undefined | null): boolean {
  if (!filename) return false
  if (filename.endsWith('.d.ts')) return false
  return /\.(ts|tsx|js|mjs|json)$/.test(filename)
}

/** Resolve an installed (or workspace) package's directory from the project. */
export function resolvePackageDir(name: string, cwd: string): string | null {
  // Consumer install / hoisted workspace
  try {
    const req = createRequire(join(cwd, 'noop.js'))
    return dirname(req.resolve(`${name}/package.json`))
  } catch { /* fall through */ }
  // Monorepo layout (running inside the platform repo)
  const short = name.replace('@tangen/', '')
  const mono = { api: 'api', admin: 'admin' }[short]
  if (mono) {
    const candidate = resolve(cwd, 'packages', mono)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return null
}

function prefix(child: ChildProcess, tag: string): void {
  const pipe = (stream: NodeJS.ReadableStream | null) => {
    if (!stream) return
    let buf = ''
    stream.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const l of lines) process.stdout.write(`${tag} ${l}\n`)
    })
  }
  pipe(child.stdout)
  pipe(child.stderr)
}

/**
 * Resolves once something answers on the port - any status counts, a
 * listening server is the fact - or false when `gaveUp` says so first (the
 * API child exited) or the deadline passes. The admin's dev server proxies
 * /api to this port from its first request, and starting it before the API
 * had bound the port logged ECONNREFUSED on every boot (2026-09-13).
 */
export async function waitForListening(port: number, opts: { timeoutMs?: number; gaveUp?: () => boolean; intervalMs?: number } = {}): Promise<boolean> {
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000)
  const interval = opts.intervalMs ?? 250
  while (Date.now() < deadline) {
    if (opts.gaveUp?.()) return false
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, interval))
    }
  }
  return false
}

export async function runDevCommand(opts: { apiOnly?: boolean; typecheck?: boolean; skipDbCheck?: boolean } = {}): Promise<void> {
  const cwd = process.cwd()
  const apiDir = resolvePackageDir('@tangen/api', cwd)
  if (!apiDir) {
    console.error('✗ @tangen/api is not installed - run: npm i @tangen/api')
    process.exit(1)
  }
  const envFile = join(cwd, '.env')
  const envArgs = existsSync(envFile) ? ['--env-file', envFile] : []

  // Preflight: a dev server with no reachable database boots but 500s on every
  // request — fail fast with a clear reason instead. Also exports the resolved
  // URL as the generic DATABASE_URL so the API's boot auto-migrate (which reads
  // that var) actually runs for a freshly scaffolded project.
  const command = opts.apiOnly ? 'tangen start' : 'tangen dev'
  if (!opts.skipDbCheck && process.env.TANGEN_SKIP_DB_CHECK !== '1') {
    const fileEnv = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, 'utf8')) : {}
    const variables = { ...fileEnv, ...process.env }
    let dbUrl: string
    try {
      dbUrl = serveDatabaseUrl(variables)
    } catch (e) {
      console.error(`\n  \x1b[31m✗\x1b[0m  ${command}: ${e instanceof Error ? e.message : String(e)}`)
      console.error(`     Set \x1b[33mDATABASE_URL\x1b[0m in .env - or pass \x1b[36m--skip-db-check\x1b[0m to start anyway.\n`)
      process.exit(1)
    }
    const role = resolveDeploymentRole(variables)
    console.log(`  \x1b[2m○\x1b[0m  deployment role \x1b[36m${role}\x1b[0m  \x1b[2m${redactDbUrl(dbUrl)}\x1b[0m`)
    process.stdout.write('  \x1b[2m○\x1b[0m  checking database… ')
    const { checkPostgres } = await import('./create')
    if (!(await checkPostgres(dbUrl))) {
      console.error('\x1b[31mcould not connect\x1b[0m')
      console.error(`\n  \x1b[31m✗\x1b[0m  ${command}: can't reach the database - is Postgres running?`)
      console.error(`     \x1b[2m${redactDbUrl(dbUrl)}\x1b[0m`)
      console.error('     Fix the connection - or pass \x1b[36m--skip-db-check\x1b[0m to start anyway.\n')
      process.exit(1)
    }
    console.log('\x1b[32mconnected\x1b[0m')
    process.env.DATABASE_URL = dbUrl
  }
  const children: ChildProcess[] = []
  // The background type-checker (if any) must not end dev when it exits or
  // reports errors — it's advisory. Tracked separately from api/admin.
  let typeChild: ChildProcess | null = null
  let checkChild: ChildProcess | null = null
  let done: () => void = () => {}

  let restarting = false
  const spawnApi = (): ChildProcess => {
    const child = spawn('bun', [...envArgs, '--watch', join(apiDir, 'src', 'index.ts')], {
      cwd,
      env: { ...process.env, TANGEN_WORKSPACE_DIR: cwd },
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    prefix(child, '\x1b[36m[api]\x1b[0m  ')
    // A crash (not an intentional restart) ends the dev command.
    child.on('exit', () => { if (!restarting) done() })
    return child
  }
  let api = spawnApi()
  children.push(api)

  // bun --watch (entry in node_modules) doesn't track the project's app/ files,
  // which the API loads via dynamic import — so a `tangen push` or a schema/route
  // edit wouldn't reload. Watch app/ ourselves and restart the API child.
  const appDir = join(cwd, 'app')
  if (existsSync(appDir)) {
    let debounce: ReturnType<typeof setTimeout> | null = null
    try {
      watch(appDir, { recursive: true }, (_event, filename) => {
        if (!shouldTriggerRestart(filename?.toString())) return
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          process.stdout.write(`\x1b[36m[api]\x1b[0m  app/ changed - restarting…\n`)
          restarting = true
          const idx = children.indexOf(api)
          api.kill('SIGTERM')
          api = spawnApi()
          if (idx !== -1) children[idx] = api
          else children.push(api)
          restarting = false
        }, 250)
      })
    } catch { /* recursive watch unsupported - bun --watch still covers monorepo */ }
  }

  if (!opts.apiOnly) {
    const adminDir = resolvePackageDir('@tangen/admin', cwd)
    if (!adminDir) {
      console.error('✗ @tangen/admin is not installed - run: npm i @tangen/admin (API continues alone)')
    } else {
      // The admin proxies /api to the API's port from its first request, so it
      // starts once the API is listening (or after a minute, whichever is first).
      const fileEnv = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, 'utf8')) : {}
      const apiPort = Number(process.env.PORT ?? fileEnv.PORT ?? 3000)
      let apiExited = false
      api.once('exit', () => { apiExited = true })
      process.stdout.write(`\x1b[35m[admin]\x1b[0m waiting for the API on :${apiPort}…\n`)
      const up = await waitForListening(apiPort, { gaveUp: () => apiExited })
      if (!up && !apiExited) process.stdout.write(`\x1b[35m[admin]\x1b[0m the API has not answered on :${apiPort} yet; starting anyway\n`)
      if (apiExited) return
      const admin = spawn('bunx', ['vite'], {
        cwd: adminDir,
        env: { ...process.env, TANGEN_APP_ROOT: cwd },
        stdio: ['inherit', 'pipe', 'pipe'],
      })
      prefix(admin, '\x1b[35m[admin]\x1b[0m ')
      children.push(admin)
    }
  }

  // Type surfacing. bun transpiles TS but never type-checks, so config/schema
  // type errors stay invisible until `push`. We surface them in the dev log
  // WITHOUT blocking the server (a stray error can't kill your session):
  //   • default        → a ONE-SHOT check at startup (fast feedback, then quiet)
  //   • --typecheck     → a continuous `tsc --watch` instead
  const tsconfig = join(cwd, 'tsconfig.json')
  if (!existsSync(tsconfig)) {
    if (opts.typecheck) process.stdout.write('\x1b[33m[types]\x1b[0m no tsconfig.json found - skipping type-check\n')
  } else if (opts.typecheck) {
    typeChild = spawn('bunx', ['tsc', '--noEmit', '--watch', '--preserveWatchOutput', '--pretty'], {
      cwd, env: { ...process.env }, stdio: ['inherit', 'pipe', 'pipe'],
    })
    prefix(typeChild, '\x1b[33m[types]\x1b[0m ')
    children.push(typeChild)
  } else {
    // One-shot at startup — advisory. Not tracked in `children` for the done()
    // wiring, so its exit never ends dev; killed on stop via checkChild.
    checkChild = spawn('bunx', ['tsc', '--noEmit', '-p', tsconfig, '--pretty'], {
      cwd, env: { ...process.env }, stdio: ['inherit', 'pipe', 'pipe'],
    })
    prefix(checkChild, '\x1b[33m[types]\x1b[0m ')
    checkChild.on('exit', (code) => {
      process.stdout.write(code === 0
        ? '\x1b[33m[types]\x1b[0m \x1b[32m✓ no type errors\x1b[0m\n'
        : '\x1b[33m[types]\x1b[0m \x1b[31m✗ type errors above - dev keeps running; fix before push (or run `tangen check`)\x1b[0m\n')
    })
    children.push(checkChild)
  }

  // Admin dying (not restarted here) ends the dev command — but a type error or
  // the type-checker exiting must not (both are advisory).
  for (const c of children) if (c !== api && c !== typeChild && c !== checkChild) c.on('exit', () => done())

  const stop = () => { for (const c of children) c.kill('SIGTERM') }
  process.on('SIGINT', () => { stop(); process.exit(0) })
  process.on('SIGTERM', () => { stop(); process.exit(0) })
  await new Promise<void>((resolveDone) => { done = resolveDone })
}
