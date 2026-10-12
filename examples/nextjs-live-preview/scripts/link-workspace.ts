/**
 * File Name: link-workspace.ts
 * Purpose: Links every `workspace:*` dependency of this example into its own
 *          node_modules. The example is deliberately NOT a member of the root
 *          workspaces (it models a standalone site, with its own lockfile), so
 *          `bun install` here cannot resolve `workspace:*` and a root install
 *          never reaches it. Without this, adding a package to the example's
 *          dependencies leaves Next.js with "Module not found: Can't resolve
 *          '@tangen/<name>'" and nothing says why.
 * Author: Raghunath J
 * License: MIT
 * Dependencies-Notes: Node built-ins only (fs, path, url), no Bun globals,
 *          because `next build` type-checks this file. Runs from `predev` and
 *          `prebuild`, so `bun run dev` heals the tree by itself. Idempotent:
 *          an existing correct link is left alone, a wrong one is replaced,
 *          and a real directory (a published copy someone installed) is kept
 *          and reported rather than deleted.
 */
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Standard ESM rather than Bun's `import.meta.dir`: `next build` type-checks
// every .ts file under the project, and Bun's globals are not in its tsconfig.
const here = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const repoRoot = resolve(here, '..', '..')

interface Pkg { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

/** The `workspace:*` dependency names of a package.json, in declaration order. */
export function workspaceDeps(pkg: Pkg): string[] {
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  return Object.entries(all).filter(([, v]) => typeof v === 'string' && v.startsWith('workspace:')).map(([k]) => k)
}

/** Where a `@tangen/<name>` package lives in this monorepo. */
export function packageDir(root: string, name: string): string {
  return join(root, 'packages', name.replace(/^@tangen\//, ''))
}

export type LinkOutcome = 'linked' | 'relinked' | 'ok' | 'kept-directory' | 'missing'

/** One link, decided and applied. Exported so the test can drive it on a temp tree. */
export function linkOne(modulesDir: string, target: string, name: string): LinkOutcome {
  const path = join(modulesDir, name)
  if (!existsSync(target)) return 'missing'
  mkdirSync(dirname(path), { recursive: true })
  const rel = relative(dirname(path), target)
  let existing: ReturnType<typeof lstatSync> | null = null
  try { existing = lstatSync(path) } catch { existing = null }
  if (existing?.isSymbolicLink()) {
    if (resolve(dirname(path), readlinkSync(path)) === target) return 'ok'
    rmSync(path)
    symlinkSync(rel, path)
    return 'relinked'
  }
  if (existing) return 'kept-directory'
  symlinkSync(rel, path)
  return 'linked'
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(new URL('link-workspace.ts', import.meta.url)))) {
  const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8')) as Pkg
  const modules = join(here, 'node_modules')
  const problems: string[] = []
  for (const name of workspaceDeps(pkg)) {
    const outcome = linkOne(modules, packageDir(repoRoot, name), name)
    if (outcome === 'linked' || outcome === 'relinked') console.log(`  linked ${name}`)
    if (outcome === 'missing') problems.push(`${name}: no package directory at ${packageDir(repoRoot, name)}`)
    if (outcome === 'kept-directory') console.log(`  ${name} is a real directory here, left as it is`)
  }
  if (problems.length) {
    console.error(`\nworkspace links incomplete:\n  ${problems.join('\n  ')}\n`)
    process.exit(1)
  }
}
