/**
 * File Name: build.ts
 * Purpose: `tangen build` - produces the static Admin a deployment serves.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: There was no supported way to deploy the Admin at all:
 *          `tangen start` runs the API only, `@tangen/admin` publishes source
 *          rather than a build, and the only route was telling people to
 *          `cd node_modules/@tangen/admin` - which is exactly the instruction
 *          the documentation guards forbid, and rightly.
 *
 *          The Admin resolves its API host at RUNTIME (lib/api-origin), so this
 *          produces ONE artifact that serves any host. There is deliberately no
 *          environment flag: baking a deployment into the build is the constraint
 *          this exists to remove.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { resolvePackageDir } from './dev'

export interface BuildOptions {
  /** Where the built Admin lands, relative to the project root. */
  out?: string
}

/** The output directory, defaulted and kept inside the project. */
export function resolveBuildOut(cwd: string, out: string | undefined): string {
  const target = (out ?? 'dist/admin').trim() || 'dist/admin'
  const abs = isAbsolute(target) ? target : join(cwd, target)
  // A build that can write anywhere is a build that can overwrite anything.
  if (relative(cwd, abs).startsWith('..')) {
    throw new Error(`--out must stay inside the project: ${target}`)
  }
  return abs
}

export async function runBuildCommand(opts: BuildOptions = {}): Promise<void> {
  const cwd = process.cwd()
  const adminDir = resolvePackageDir('@tangen/admin', cwd)
  if (!adminDir) {
    console.error('\n  \x1b[31m✗\x1b[0m  tangen build: @tangen/admin is not installed - run: bun add @tangen/admin\n')
    process.exit(1)
  }
  const out = resolveBuildOut(cwd, opts.out)

  console.log(`\n  \x1b[2m○\x1b[0m  building the Admin…`)
  const code = await new Promise<number>((resolve) => {
    const child = spawn('bunx', ['vite', 'build'], {
      cwd: adminDir,
      env: { ...process.env, TANGEN_APP_ROOT: cwd },
      stdio: ['inherit', 'inherit', 'inherit'],
    })
    child.on('exit', (c) => resolve(c ?? 1))
    child.on('error', () => resolve(1))
  })
  if (code !== 0) {
    console.error(`\n  \x1b[31m✗\x1b[0m  tangen build: the Admin build failed\n`)
    process.exit(code)
  }

  const built = join(adminDir, 'dist')
  if (!existsSync(built)) {
    console.error(`\n  \x1b[31m✗\x1b[0m  tangen build: the build reported success but wrote no dist/\n`)
    process.exit(1)
  }
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  cpSync(built, out, { recursive: true })

  const shown = relative(cwd, out) || out
  console.log(`\n  \x1b[32m✓\x1b[0m  Admin built  \x1b[2m${shown}\x1b[0m`)
  console.log(`     Serve it as static files - no Admin server, no port of its own. It uses its own`)
  console.log(`     origin for the API (a same-origin proxy configures nothing); for split domains,`)
  console.log(`     rewrite the \x1b[36mtangen:config\x1b[0m meta tag in ${shown}/index.html when you serve it, e.g.`)
  console.log(`     \x1b[2m<meta name="tangen:config" content='{"apiUrl":"https://api.example.com"}'>\x1b[0m - the same build, any deployment.\n`)
}
