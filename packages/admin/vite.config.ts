/**
 * File Name: vite.config.ts
 * Purpose: Vite build and dev-server configuration for the Tangen admin panel, including a custom
 *          LogTape-compatible logger, workspace aliases, dev proxy, and the app-ui-registry plugin.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @vitejs/plugin-react; proxies /api and /media to the API server on port 3000.
 */
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import type { Logger as ViteLogger, LogType, LogErrorOptions, Rollup } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { appUiRegistryPlugin } from './vite-plugin-app-ui.ts'
import { extensionPanelsPlugin, extensionRuntimeDependencies } from './vite-plugin-extension-panels.ts'
import { fieldTypeUiPlugin } from './vite-plugin-field-type-ui.ts'

// Vite's config loader runs in Node CJS context — ESM-only packages (@logtape/logtape)
// and workspace TS sources can't be required. Inline the same format LogTape uses so
// admin output is visually consistent with the API's LogTape console sink.
/**
 * Builds a custom ViteLogger that formats output to match the LogTape console sink used by the API,
 * strips ANSI codes, and suppresses noisy HMR/reload messages.
 * @returns A ViteLogger implementation compatible with Vite's customLogger option
 */
function makeLogger(): ViteLogger {
  const isTTY = process.stdout.isTTY && !process.env.NO_COLOR
  const a = (code: string, s: string) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s)
  const dim  = (s: string) => a('2', s)
  const bold = (s: string) => a('1', s)

  const levelTag: Record<string, string> = {
    info:  isTTY ? a('32;1', 'INF') : 'INF',
    warn:  isTTY ? a('33;1', 'WRN') : 'WRN',
    error: isTTY ? a('31;1', 'ERR') : 'ERR',
  }

  // eslint-disable-next-line no-control-regex
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').trim()

  function ts() {
    return dim(new Date().toISOString().replace('T', ' ').slice(0, 23))
  }

  function write(level: 'info' | 'warn' | 'error', msg: string) {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    fn(`${ts()} ${levelTag[level]} ${bold('tangen')}${dim('·')}${bold('admin')} ${strip(msg)}`)
  }

  return {
    hasWarned: false,

    info(msg: string) {
      const m = strip(msg)
      if (
        m.includes('hmr update') ||
        m.includes('page reload') ||
        m.includes('client connected') ||
        m.includes('optimized dependencies changed') ||
        m.startsWith('Pre-bundling') ||
        // vite's own welcome banner — the Tangen API banner already prints
        // the app/api URLs, so this is duplicate noise in `tangen dev`.
        m.startsWith('VITE v') ||
        m.includes('ready in') ||
        m.includes('Local:') ||
        m.includes('Network:') ||
        m.includes('press h + enter')
      ) return
      write('info', m)
    },

    warn(msg: string) {
      this.hasWarned = true
      write('warn', msg)
    },

    warnOnce(msg: string) {
      this.warn(msg)
    },

    error(msg: string, _options?: LogErrorOptions) {
      write('error', msg)
    },

    clearScreen(_type: LogType) {
      // no-op: don't let Vite clear between rebuilds
    },

    hasErrorLogged(_error: Error | Rollup.RollupError) {
      return false
    },
  }
}

// Load the repo-root .env so PORT/ADMIN_PORT/TANGEN_DEV_API_URL configure the
// whole stack from one file (the API's dev script already loads it; vite does
// not). Fill-only: values already present in the shell environment win.
const rootEnvPath = path.resolve(process.env.TANGEN_APP_ROOT ?? path.resolve(import.meta.dirname, '../..'), '.env')
if (existsSync(rootEnvPath)) {
  for (const line of readFileSync(rootEnvPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

// ── Consumer mode (packaged installs) ─────────────────────────────────────────
// In the monorepo the site root is two dirs up; in an npm-consumer project
// `tangen dev` sets TANGEN_APP_ROOT to the project root and this package runs
// from node_modules/@tangen/admin. Monorepo-only aliases drop away when their
// source paths don't exist — normal node_modules resolution takes over.
const APP_ROOT = process.env.TANGEN_APP_ROOT ?? path.resolve(import.meta.dirname, '../..')
// node_modules/@tangen/admin/../ui is @tangen/ui (which also ships src/), so
// sibling-existence checks misfire in consumer installs — the package's own
// path is the only reliable signal.
const IN_MONOREPO = !import.meta.dirname.includes('node_modules')
const monorepoAliases = IN_MONOREPO ? {
  '@tangen/ui':      path.resolve(import.meta.dirname, '../ui/src/index.ts'),
  '@tangen/types':   path.resolve(import.meta.dirname, '../types/src/index.ts'),
  // Subpath first - the bare alias below would otherwise mangle it.
  '@tangen/icons/all': path.resolve(import.meta.dirname, '../icons/src/all.ts'),
  '@tangen/icons':   path.resolve(import.meta.dirname, '../icons/src/index.ts'),
  '@tangen/cms':     path.resolve(import.meta.dirname, '../tangen/src/index.ts'),
  '@tangen/schema':  path.resolve(import.meta.dirname, '../schema/src/index.ts'),
  '@tangen/helpers': path.resolve(import.meta.dirname, '../helpers/src/index.ts'),
  // Studio (and any extension) shares the SDK's postMessage protocol modules.
  '@tangen/sdk':     path.resolve(import.meta.dirname, '../sdk/src/index.ts'),
} : {}

// Consumer installs serve the admin's TS source from inside node_modules, so
// vite's scanner discovers "dependencies" lazily at runtime — each wave
// re-optimizes and 504s ("Outdated Optimize Dep") every module the browser
// already holds. Kill the churn: no discovery, pre-bundle the real deps.
const adminPkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
// @tiptap/pm exports only subpaths (no "."), so it can't be force-included.
const TOOLING = new Set(['vite', 'tailwindcss', '@tailwindcss/forms', '@tailwindcss/postcss', '@vitejs/plugin-react', '@types/react', '@types/react-dom', '@tiptap/pm'])
const consumerOptimizeDeps = {
  noDiscovery: true,
  include: [
    ...Object.keys(adminPkg.dependencies ?? {}).filter((d) => !d.startsWith('@tangen/') && !TOOLING.has(d)),
    'react/jsx-dev-runtime',
    'react/jsx-runtime',
    'react-dom/client',
    // The configured extensions' own runtime deps (Flows' @xyflow/react, Studio's @dnd-kit): with discovery off,
    // anything not listed here is served raw, and a CommonJS module served raw has no default export.
    ...extensionRuntimeDependencies(APP_ROOT),
  ],
}

/**
 * Consumer-mode guard: with the admin's TS source living in node_modules,
 * rolldown-vite classifies bare internal specifiers ('@/lib/x', '@tangen/ui')
 * as third-party deps — pre-bundling duplicate copies of stateful modules
 * (auth/locale stores split) and 504-churning the dev server. Rewriting the
 * specifiers to absolute /@fs/ URLs before any other plugin sees them makes
 * classification impossible, independent of resolver semantics.
 */
function internalSpecifierRewrite(adminDir: string) {
  const req = createRequire(import.meta.url)
  const exts = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']
  const fileCache = new Map<string, string | null>()
  const resolveFile = (abs: string): string | null => {
    if (fileCache.has(abs)) return fileCache.get(abs)!
    let hit: string | null = null
    if (path.extname(abs) && existsSync(abs)) hit = abs
    else for (const e of exts) { if (existsSync(abs + e)) { hit = abs + e; break } }
    fileCache.set(abs, hit)
    return hit
  }
  const pkgEntry = (name: string): string | null => {
    if (fileCache.has(name)) return fileCache.get(name)!
    let hit: string | null = null
    try {
      const dir = path.dirname(req.resolve(`${name}/package.json`))
      const pj = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { main?: string }
      hit = resolveFile(path.join(dir, pj.main ?? 'index.js'))
    } catch { /* leave unrewritten */ }
    fileCache.set(name, hit)
    return hit
  }
  const SPEC = /(["'])(@\/[^"']+|@tangen\/(?:ui|icons|types|cms|schema|helpers|sdk))\1/g
  return {
    name: 'tangen:internal-specifier-rewrite',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!/\.(tsx?|jsx?)(\?|$)/.test(id) && !id.includes('virtual:tangen')) return
      if (!code.includes("'@/") && !code.includes('"@/') && !code.includes('@tangen/')) return
      let changed = false
      const out = code.replace(SPEC, (full, q: string, spec: string) => {
        const abs = spec.startsWith('@/') ? resolveFile(path.join(adminDir, spec.slice(2))) : pkgEntry(spec)
        if (!abs) return full
        changed = true
        return `${q}/@fs${abs}${q}`
      })
      return changed ? out : undefined
    },
  }
}

export default defineConfig(({ command }) => ({
  optimizeDeps: IN_MONOREPO ? undefined : consumerOptimizeDeps,
  customLogger: makeLogger(),
  plugins: [
    ...(IN_MONOREPO ? [] : [internalSpecifierRewrite(path.resolve(import.meta.dirname))]),
    react(),
    appUiRegistryPlugin(APP_ROOT),
    extensionPanelsPlugin(APP_ROOT),
    fieldTypeUiPlugin(APP_ROOT),
  ],
  resolve: {
    // Files under app/admin/ live outside packages/admin's node_modules scope —
    // dedupe pins react resolution to the admin's copy so the build never fails
    // resolving react from site-provided components.
    dedupe: ['react', 'react-dom', 'react-router-dom'],
    // Array/regex form: rolldown-vite's dependency scanner misses object-form
    // prefix aliases when the admin source itself sits in node_modules
    // (consumer installs), then treats '@/lib/*' as bare deps — pre-bundling
    // duplicate copies of stateful modules and 504-churning the dev server.
    alias: [
      // Internal admin shorthand
      { find: /^@\//, replacement: path.resolve(import.meta.dirname) + '/' },
      // react-router ships its exports map pointing at dist/development (dev
      // warnings are NOT env-guarded there; a separate dist/production
      // exists). Pin the production files for builds only.
      ...(command === 'build'
        ? (() => {
            // Resolve react-router THROUGH react-router-dom so the pinned
            // production files match the version rrd actually re-exports
            // (the store may hold multiple react-router majors).
            const req = createRequire(import.meta.url)
            const rrd = req.resolve('react-router-dom/package.json')
            const rr = path.dirname(createRequire(rrd).resolve('react-router/package.json'))
            return [
              { find: 'react-router/dom', replacement: path.join(rr, 'dist/production/dom-export.mjs') },
              { find: /^react-router$/, replacement: path.join(rr, 'dist/production/index.mjs') },
            ]
          })()
        : []),
      // Pinned so extension sources (extensions/*) outside packages/admin's
      // node_modules scope resolve the SAME router instance — React context
      // (useParams/Link) breaks across copies. Resolved dynamically: npm
      // hoists the dep to the project root in consumer installs.
      { find: 'react-router-dom', replacement: path.dirname(createRequire(import.meta.url).resolve('react-router-dom/package.json')) },
      ...Object.entries(monorepoAliases).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  server: {
    // The user's app/ dir sits outside the package root in consumer mode
    fs: { allow: [import.meta.dirname, APP_ROOT] },
    // Consumer mode: pre-transform the whole admin graph at boot so every
    // third-party dep is discovered in ONE optimize pass before the browser
    // connects — otherwise lazy routes trigger re-optimize waves (504s).
    ...(IN_MONOREPO ? {} : { warmup: { clientFiles: ['./src/**/*.tsx', './src/**/*.ts', './app/**/*.tsx', './components/**/*.tsx', './kit/**/*.tsx', './lib/**/*.ts'] } }),
    // Second instances (different site/DB on one machine) override both:
    //   ADMIN_PORT=3006 TANGEN_DEV_API_URL=http://localhost:3005 bun run dev
    port: Number(process.env.ADMIN_PORT ?? 3001),
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.TANGEN_DEV_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
        changeOrigin: true,
        // The realtime socket (/api/v1/realtime) upgrades through this proxy
        // in dev; without `ws` the upgrade is refused, the client falls back
        // to SSE, and presence - WebSocket-only - never appears.
        ws: true,
      },
      '/media': {
        target: process.env.TANGEN_DEV_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
        changeOrigin: true,
      },
      // Public form pages are served by the API at /embed/* (no /api prefix) —
      // forward them so a same-origin direct form URL works in dev instead of
      // falling through to the SPA (which would redirect to /workspaces).
      '/embed': {
        target: process.env.TANGEN_DEV_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
}))
