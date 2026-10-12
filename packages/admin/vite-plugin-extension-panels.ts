/**
 * File Name: vite-plugin-extension-panels.ts
 * Purpose: Vite plugin generating `virtual:tangen/extension-panels` — the
 *          build-time resolution of extension sidebar panels. It statically
 *          extracts `resolve: '<literal>'` strings from the workspace config
 *          files (never imports them — they read process.env secrets) and
 *          emits imports of each extension's browser-safe manifest + client
 *          entry, building { [extensionId]: { [panelId]: Component } }.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Companion to vite-plugin-app-ui.ts. Panel `component`
 *          values in the manifest are NAMED EXPORTS of the extension's
 *          src/index.ts client entry.
 */
import type { Plugin, ViteDevServer } from 'vite'
import path from 'path'
import { existsSync, readFileSync, readdirSync } from 'fs'

const VIRTUAL_ID = 'virtual:tangen/extension-panels'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/**
 * Extracts `resolve: '<literal>'` strings from config source text.
 * Static string literals only — dynamic expressions are ignored (documented
 * constraint: extension resolve paths must be literals).
 */
export function extractResolveLiterals(source: string): string[] {
  const out: string[] = []
  const re = /resolve\s*:\s*(['"`])([^'"`]+)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    if (m[2].includes('${')) continue   // template interpolation - not a static literal
    out.push(m[2])
  }
  return out
}

/** Config files scanned for extension resolve entries. */
function configFiles(rootDir: string): string[] {
  const app = path.resolve(rootDir, 'app')
  const files = [path.join(app, 'config', 'extensions.ts')]
  const wsDir = path.join(app, 'workspaces')
  if (existsSync(wsDir)) {
    for (const entry of readdirSync(wsDir)) {
      const cfg = path.join(wsDir, entry, 'workspace.config.ts')
      if (existsSync(cfg)) files.push(cfg)
    }
  }
  return files.filter(existsSync)
}

/** Resolves a literal to an extension dir containing tangen.extension.ts. */
function resolveExtensionDir(rootDir: string, literal: string): string | null {
  if (!literal.startsWith('.')) {
    // Bare npm specifier (@tangen/ext-porter): the package ships its
    // manifest + src, so resolve it straight out of node_modules.
    const pkgDir = path.join(rootDir, 'node_modules', literal)
    return existsSync(path.join(pkgDir, 'tangen.extension.ts')) ? pkgDir : null
  }
  const app = path.resolve(rootDir, 'app')
  const candidates = [
    path.resolve(app, 'config', literal),
    path.resolve(app, literal),
    path.resolve(rootDir, literal),
  ]
  return candidates.find((c) => existsSync(path.join(c, 'tangen.extension.ts'))) ?? null
}

/** Every extension dir the project's config resolves to (literal `resolve:` entries only), deduplicated. */
export function configuredExtensionDirs(rootDir: string): string[] {
  const dirs = new Set<string>()
  for (const file of configFiles(rootDir)) {
    let src = ''
    try { src = readFileSync(file, 'utf8') } catch { continue }
    for (const literal of extractResolveLiterals(src)) {
      const dir = resolveExtensionDir(rootDir, literal)
      if (dir) dirs.add(dir)
    }
  }
  return [...dirs]
}

/**
 * The runtime dependencies the configured extensions bring (their
 * package.json `dependencies`, the platform's own packages excluded), so a
 * consumer install pre-bundles them with the admin's. Vite serves an
 * un-optimized CommonJS module without a `default` export, which is how
 * Flows' canvas (@xyflow/react → zustand → use-sync-external-store) broke in
 * a consumer install while the monorepo, which lets Vite discover deps, did
 * not. Sorted, deduplicated, tolerant of a missing or broken package.json.
 */
export function extensionRuntimeDependencies(rootDir: string): string[] {
  const deps = new Set<string>()
  for (const dir of configuredExtensionDirs(rootDir)) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
      for (const name of Object.keys(pkg.dependencies ?? {})) if (!name.startsWith('@tangen/')) deps.add(name)
    } catch { /* an extension without a package.json brings nothing */ }
  }
  return [...deps].sort()
}

/**
 * Vite plugin providing `virtual:tangen/extension-panels`:
 *   export const EXTENSION_PANELS: Record<extensionId, Record<panelId, Component>>
 *   export const EXTENSION_PAGES:  Record<extensionId, Array<{ path, component, nav?, access? }>>
 *   export const EXTENSION_SLOTS:  Record<extensionId, Array<{ extensionId, slot, id, component, label?, priority?, access? }>> (K7.2)
 *
 * @param rootDir Absolute path to the project root (contains `app/` and `extensions/`)
 */
export function extensionPanelsPlugin(rootDir: string): Plugin {
  function buildModule(): string {
    const dirs = new Set<string>()
    for (const file of configFiles(rootDir)) {
      let src = ''
      try { src = readFileSync(file, 'utf8') } catch { continue }
      for (const literal of extractResolveLiterals(src)) {
        const dir = resolveExtensionDir(rootDir, literal)
        if (dir) dirs.add(dir)
      }
    }

    const lines: string[] = []
    const entries: string[] = []
    let i = 0
    for (const dir of dirs) {
      const manifestPath = path.join(dir, 'tangen.extension.ts')
      const clientCandidates = [path.join(dir, 'src', 'index.ts'), path.join(dir, 'src', 'index.tsx')]
      const clientPath = clientCandidates.find(existsSync)
      if (!clientPath) continue
      lines.push(`import m${i} from ${JSON.stringify(manifestPath)}`)
      // Dynamic import: extension client bundles (and their deps - the flows
      // canvas alone pulls @xyflow + d3 + dnd-kit) must NOT land in the entry
      // chunk. Components become React.lazy wrappers over the loader.
      lines.push(`const c${i} = () => import(${JSON.stringify(clientPath)})`)
      entries.push(`[m${i}, c${i}]`)
      i++
    }

    lines.push(
      "import { lazy as __lazy } from 'react'",
      '// A lazy component over one named export of the extension client module.',
      '// Missing exports render nothing (the old static build skipped them).',
      'function lazyMember(load, name) {',
      '  return __lazy(() => load().then((m) => ({ default: m[name] ?? (() => null) })))',
      '}',
      'function buildRegistry(pairs) {',
      '  const out = {}',
      '  for (const [manifest, load] of pairs) {',
      '    if (!manifest?.id) continue',
      '    const panels = {}',
      '    for (const panel of manifest.sidebarPanels ?? []) {',
      '      if (panel.component) panels[panel.id] = lazyMember(load, panel.component)',
      '    }',
      '    out[manifest.id] = panels',
      '  }',
      '  return out',
      '}',
      'function buildPages(pairs) {',
      '  const out = {}',
      '  for (const [manifest, load] of pairs) {',
      '    if (!manifest?.id) continue',
      '    const pages = []',
      '    for (const page of manifest.pages ?? []) {',
      '      if (!page.component) continue',
      '      pages.push({ path: page.path, component: lazyMember(load, page.component), nav: page.nav, access: page.access })',
      '    }',
      '    if (pages.length) out[manifest.id] = pages',
      '  }',
      '  return out',
      '}',
      'function buildSlots(pairs) {',
      '  const out = {}',
      '  for (const [manifest, load] of pairs) {',
      '    if (!manifest?.id) continue',
      '    const items = []',
      '    for (const item of manifest.slots ?? []) {',
      '      if (!item.component) continue',
      '      items.push({ extensionId: manifest.id, slot: item.slot, id: item.id, component: lazyMember(load, item.component), label: item.label, priority: item.priority, access: item.access })',
      '    }',
      '    if (items.length) out[manifest.id] = items',
      '  }',
      '  return out',
      '}',
      'function buildCommands(pairs) {',
      '  const out = {}',
      '  for (const [manifest] of pairs) {',
      '    if (!manifest?.id) continue',
      '    if (manifest.commands?.length) out[manifest.id] = manifest.commands',
      '  }',
      '  return out',
      '}',
      `export const EXTENSION_PANELS = buildRegistry([${entries.join(', ')}])`,
      `export const EXTENSION_PAGES = buildPages([${entries.join(', ')}])`,
      `export const EXTENSION_COMMANDS = buildCommands([${entries.join(', ')}])`,
      `export const EXTENSION_SLOTS = buildSlots([${entries.join(', ')}])`,
    )
    return lines.join('\n')
  }

  return {
    name: 'tangen:extension-panels',

    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },

    load(id: string) {
      if (id !== RESOLVED_ID) return
      return buildModule()
    },

    configureServer(server: ViteDevServer) {
      const watched = [
        ...configFiles(rootDir),
        path.resolve(rootDir, 'extensions'),
      ]
      for (const w of watched) server.watcher.add(w)
      server.watcher.on('change', (changedPath: string) => {
        const relevant = watched.some((w) => changedPath.startsWith(w))
        if (!relevant) return
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) {
          server.moduleGraph.invalidateModule(mod)
          server.ws.send({ type: 'full-reload' })
        }
      })
    },
  }
}
