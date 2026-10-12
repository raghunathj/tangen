/**
 * File Name: extension-bundle-ui.ts
 * Purpose: `tangen extension bundle [<dir>]` (Extension Kernel K7.3).
 *          Builds an extension's client module into ONE ES module the Admin
 *          loads at runtime - the `ui` file its manifest names - so
 *          installing the extension needs no Admin rebuild. The modules the
 *          Admin already ships (SHARED_UI_MODULES: React, the router, the
 *          UI kit) are never bundled again: every import of one is rewritten
 *          to read the Admin's shared runtime global, with the module's
 *          named exports enumerated at build time from the project's own
 *          copy. Run by the extension author before publishing, or by a
 *          site after installing a source-only extension.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { SHARED_UI_GLOBAL, SHARED_UI_MODULES } from '@tangen/types'
import { c, sym } from '../ui'

export interface BundleUiOptions {
  /** The extension directory (holds tangen.extension.ts). */
  dir: string
  /** The client entry, relative to `dir`. Default: the manifest's `client`, else src/index.tsx or src/index.ts. */
  entry?: string
  /** Where the bundle goes, relative to `dir`. Default: the manifest's `ui`, else dist/admin.js. */
  outfile?: string
  /** Where the shared modules resolve from for export enumeration (the project root). Default: `dir`. */
  resolveDir?: string
  minify?: boolean
}

export interface BundleUiResult { outfile: string; shared: string[]; bytes: number }

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** The shim a shared import becomes: every named export the real module has, read from the Admin's global at load. */
async function sharedShim(name: string, resolveDir: string): Promise<string> {
  let keys: string[] = []
  try {
    // The project root first; then the installed Admin package, which depends on every shared module.
    let path: string | null = null
    for (const from of [resolveDir, join(resolveDir, 'node_modules', '@tangen', 'admin')]) {
      try { path = Bun.resolveSync(name, from); break } catch { /* next */ }
    }
    if (!path) throw new Error(`cannot resolve ${name}`)
    const mod = await import(path) as Record<string, unknown>
    // A CommonJS module (React is one) arrives as { default: exports }: enumerate the exports themselves.
    const named = Object.keys(mod).filter((k) => k !== 'default' && k !== '__esModule')
    const source = named.length ? mod : (mod.default && typeof mod.default === 'object' ? (mod.default as Record<string, unknown>) : mod)
    keys = Object.keys(source).filter((k) => k !== 'default' && k !== '__esModule' && IDENT.test(k))
  } catch {
    // Not installed where we look: the default export and a namespace still work; named imports will not.
    keys = []
  }
  const lines = [
    `const m = globalThis[${JSON.stringify(SHARED_UI_GLOBAL)}]?.[${JSON.stringify(name)}];`,
    `if (!m) throw new Error(${JSON.stringify(`The Admin did not expose ${name} on ${SHARED_UI_GLOBAL}; this bundle needs a Tangen Admin that shares its runtime`)});`,
    `export default (m.default ?? m);`,
    ...keys.map((k) => `export const ${k} = m[${JSON.stringify(k)}];`),
  ]
  return lines.join('\n')
}

export async function bundleExtensionUi(opts: BundleUiOptions): Promise<BundleUiResult> {
  const dir = resolve(opts.dir)
  const resolveDir = opts.resolveDir ? resolve(opts.resolveDir) : dir
  const entry = opts.entry ?? ['src/index.tsx', 'src/index.ts'].find((f) => existsSync(join(dir, f)))
  if (!entry || !existsSync(join(dir, entry))) throw new Error(`No client entry to bundle in ${dir} (looked for ${opts.entry ?? 'src/index.tsx, src/index.ts'})`)
  const outfile = join(dir, opts.outfile ?? 'dist/admin.js')
  const shared = new Set<string>()
  const escaped = SHARED_UI_MODULES.map((m) => m.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
  const filter = new RegExp(`^(${escaped.join('|')})$`)

  const result = await Bun.build({
    entrypoints: [join(dir, entry)],
    target: 'browser',
    format: 'esm',
    minify: opts.minify ?? false,
    sourcemap: 'none',
    plugins: [{
      name: 'tangen-shared-runtime',
      setup(build) {
        build.onResolve({ filter }, (args) => { shared.add(args.path); return { path: args.path, namespace: 'tangen-shared' } })
        build.onLoad({ filter: /.*/, namespace: 'tangen-shared' }, async (args) => ({ contents: await sharedShim(args.path, resolveDir), loader: 'js' }))
      },
    }],
  })
  if (!result.success) {
    throw new Error(`Bundling failed:\n${result.logs.map((l) => `  ${l.message}`).join('\n')}`)
  }
  const code = await result.outputs[0]!.text()
  mkdirSync(dirname(outfile), { recursive: true })
  writeFileSync(outfile, code)
  return { outfile, shared: [...shared], bytes: Buffer.byteLength(code) }
}

export interface BundleUiCommandOptions { json?: boolean; minify?: boolean }

/** Reads the manifest for `client` and `ui`, bundles, prints. Exit 0 done, 2 could not. */
export async function runExtensionBundleUiCommand(cwd: string, target: string | undefined, opts: BundleUiCommandOptions = {}): Promise<BundleUiResult | null> {
  const dir = resolve(cwd, target ?? '.')
  const fail = (message: string): null => {
    if (opts.json) console.log(JSON.stringify({ ok: false, exitCode: 2, error: message }, null, 2))
    else console.error(`  ${sym.cross}  ${c.red(message)}`)
    process.exitCode = 2
    return null
  }
  const manifestPath = ['tangen.extension.ts', 'tangen.extension.js'].map((f) => join(dir, f)).find(existsSync)
  if (!manifestPath) return fail(`No tangen.extension.ts in ${dir}`)
  let manifest: { client?: string; ui?: string; id?: string }
  try {
    manifest = ((await import(`${manifestPath}?t=${Date.now()}`)).default ?? {}) as typeof manifest
  } catch (e) {
    return fail(`Could not load ${manifestPath}: ${e instanceof Error ? e.message : String(e)}`)
  }
  try {
    const result = await bundleExtensionUi({ dir, entry: manifest.client, outfile: manifest.ui ?? 'dist/admin.js', resolveDir: cwd, minify: opts.minify })
    if (opts.json) console.log(JSON.stringify({ ok: true, exitCode: 0, id: manifest.id, ...result }, null, 2))
    else {
      console.log(`  ${sym.tick}  Bundled ${manifest.id ?? dir} → ${result.outfile} (${(result.bytes / 1024).toFixed(1)} KB; shared: ${result.shared.join(', ') || 'none'})`)
      if (!manifest.ui) console.log(`     Add ${c.bold("ui: './dist/admin.js'")} to the manifest so the Admin loads it at runtime.`)
    }
    process.exitCode = 0
    return result
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}
