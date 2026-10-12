/**
 * File Name: import-graph.ts
 * Purpose: What a module actually pulls in when it is imported. Walks STATIC
 *          imports and re-exports from an entry file and returns everything
 *          reachable, deliberately NOT following `await import()`.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This exists to make one invariant testable instead of
 *          approximate: "an optional capability must not make a simple
 *          deployment pay its startup cost when it is not enabled" (user,
 *          2026-08-27). Measuring RSS cannot prove that. A barrel file that
 *          re-exports a capability's implementation pulls the whole subtree in
 *          at boot, and the megabytes hide inside normal measurement variance;
 *          reachability answers it exactly, and answers it in milliseconds.
 *
 *          The dynamic-import exclusion IS the point. `await import('./x')`
 *          defers resolution to the moment it runs, so a capability behind one
 *          costs nothing at boot; a static `import ... from './x'` at the top
 *          of any reachable file costs everything. The walker's whole job is
 *          to tell those two apart.
 *
 *          Source-level, not runtime: no module is executed, so walking a
 *          graph has no side effects and cannot start a server, open a socket
 *          or touch a database.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** A static edge out of a file: `import from`, `export from`, or a bare side-effect import. */
const STATIC_EDGE = /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?'([^']+)'/g

/** `await import('x')` and `import('x')`: deliberately NOT an edge. */
const DYNAMIC_EDGE = /\bimport\s*\(\s*'([^']+)'/g

export interface GraphOptions {
  /** Bare specifiers to follow (workspace packages). Anything else is a leaf. */
  followPackages?: (spec: string) => string | null
  /** Guard against a pathological tree; a real one is a few thousand files. */
  maxFiles?: number
}

/** The static import specifiers of one source text, in source order. */
export function staticSpecifiers(source: string): string[] {
  const out: string[] = []
  for (const m of source.matchAll(STATIC_EDGE)) out.push(m[1]!)
  return out
}

/** The dynamic import specifiers of one source text: what is DEFERRED. */
export function dynamicSpecifiers(source: string): string[] {
  const out: string[] = []
  for (const m of source.matchAll(DYNAMIC_EDGE)) out.push(m[1]!)
  return out
}

function isFile(path: string): boolean {
  try { return statSync(path).isFile() } catch { return false }
}

/** A relative specifier resolved to a file on disk, or null when it is not one. */
export function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
  // A FILE, never a directory: `existsSync` says yes to `./routes/media`, and
  // returning the directory would end the walk one step before the barrel that
  // is usually the thing leaking.
  for (const c of candidates) if (isFile(c)) return c
  return null
}

/**
 * Every file statically reachable from `entry`, including `entry` itself.
 *
 * A file that is only ever reached through `await import()` is absent, which
 * is exactly what "this capability is not loaded at boot" means.
 */
export function staticallyReachable(entry: string, opts: GraphOptions = {}): Set<string> {
  const max = opts.maxFiles ?? 10_000
  const seen = new Set<string>()
  const queue = [resolve(entry)]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    if (seen.size >= max) throw new Error(`import graph exceeded ${max} files from ${entry}`)
    if (!isFile(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    for (const spec of staticSpecifiers(source)) {
      const rel = resolveRelative(file, spec)
      if (rel) { queue.push(rel); continue }
      const pkg = opts.followPackages?.(spec)
      if (pkg) queue.push(pkg)
    }
  }
  return seen
}

/**
 * Whether `target` is statically reachable from `entry`, and the shortest path
 * that proves it. A failing isolation test that cannot say HOW the module got
 * in sends someone hunting through 163 imports by hand.
 */
export function pathTo(entry: string, target: string, opts: GraphOptions = {}): string[] | null {
  const goal = resolve(target)
  const start = resolve(entry)
  const seen = new Set<string>([start])
  // Breadth first, so the path returned is the shortest and reads as the
  // clearest explanation of the leak.
  const queue: Array<{ file: string; path: string[] }> = [{ file: start, path: [start] }]
  while (queue.length > 0) {
    const { file, path } = queue.shift()!
    if (file === goal) return path
    if (!isFile(file)) continue
    for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
      const next = resolveRelative(file, spec) ?? opts.followPackages?.(spec) ?? null
      if (!next || seen.has(next)) continue
      seen.add(next)
      queue.push({ file: next, path: [...path, next] })
    }
  }
  return null
}
