/**
 * File Name: vite-plugin-field-type-ui.ts
 * Purpose: Vite plugin generating `virtual:tangen/field-type-ui` — the build-time
 *          resolution of custom field type admin inputs. It reuses the same
 *          `resolve: '<literal>'` config scan as vite-plugin-extension-panels,
 *          imports each extension's browser-safe client entry, and collects its
 *          `fieldTypeUIs` (defineFieldTypeUI descriptors) into
 *          { [fieldTypeName]: { Input, validate } }.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Companion to vite-plugin-extension-panels.ts. An extension's
 *          client entry (src/index.ts) contributes custom inputs by exporting a
 *          `fieldTypeUIs` array of `defineFieldTypeUI(...)` descriptors.
 */
import type { Plugin, ViteDevServer } from 'vite'
import path from 'path'
import { existsSync, readFileSync, readdirSync } from 'fs'

const VIRTUAL_ID = 'virtual:tangen/field-type-ui'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/** Extracts `resolve: '<literal>'` strings from config source (static literals only). */
export function extractResolveLiterals(source: string): string[] {
  const out: string[] = []
  const re = /resolve\s*:\s*(['"`])([^'"`]+)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    if (m[2].includes('${')) continue
    out.push(m[2])
  }
  return out
}

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

/**
 * Pure registry builder — given [manifest, client] pairs, collects every client's
 * `fieldTypeUIs` descriptors into a name → { Input, validate } map. Later pairs win
 * on name collision (deterministic with the import order). Exported for unit tests.
 */
export function buildFieldTypeUIRegistry(
  pairs: Array<[any, any]>,
): Record<string, { Input: unknown; validate?: unknown }> {
  const out: Record<string, { Input: unknown; validate?: unknown }> = {}
  for (const [, client] of pairs) {
    for (const desc of client?.fieldTypeUIs ?? []) {
      if (!desc?.name || !desc?.Input) continue
      out[desc.name] = { Input: desc.Input, validate: desc.validate }
    }
  }
  return out
}

/**
 * Pure registry builder for SITE field types — given [def, Input] pairs (the
 * `app/fields/<name>/index.ts` default + its `input.tsx` default), builds the same
 * name → { Input, validate } map. The site `validate(value)` is adapted to the UI
 * registry's `(value, field)` shape. Only fields with an input are registered.
 */
export function buildSiteFieldTypeUIRegistry(
  pairs: Array<[any, any]>,
): Record<string, { Input: unknown; validate?: unknown }> {
  const out: Record<string, { Input: unknown; validate?: unknown }> = {}
  for (const [def, Input] of pairs) {
    if (!def?.name || !Input) continue
    out[def.name] = { Input, validate: def.validate ? (value: unknown) => def.validate(value) : undefined }
  }
  return out
}

/** Site field folders under app/fields (each a dir with an index.ts). */
function siteFieldDirs(rootDir: string): string[] {
  const base = path.resolve(rootDir, 'app', 'fields')
  if (!existsSync(base)) return []
  const out: string[] = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(base, entry.name)
    if (['index.ts', 'index.tsx'].some((f) => existsSync(path.join(dir, f)))) out.push(dir)
  }
  return out
}

/**
 * Vite plugin providing `virtual:tangen/field-type-ui`:
 *   export const FIELD_TYPE_UI: Record<fieldTypeName, { Input, validate? }>
 */
/**
 * The virtual module's source. Exported so a test can pin that the registry
 * is built LAZILY - an eager build reads extension client exports during
 * module evaluation, which throws inside an import cycle.
 */
export function buildFieldTypeUiModule(rootDir: string): string {
  {
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
      // Only extensions that actually declare fieldTypeUIs get their client
      // imported here - this module is STATIC (validate must be callable
      // synchronously), and importing every extension's client dragged whole
      // page bundles (the flows canvas + @xyflow + d3) into the entry chunk.
      let clientSrc = ''
      try { clientSrc = readFileSync(clientPath, 'utf8') } catch { /* unreadable - skip */ }
      if (!/\bfieldTypeUIs\b/.test(clientSrc)) continue
      lines.push(`import m${i} from ${JSON.stringify(manifestPath)}`)
      lines.push(`import * as c${i} from ${JSON.stringify(clientPath)}`)
      entries.push(`[m${i}, c${i}]`)
      i++
    }

    // Site field types: app/fields/<name>/index.ts (+ optional input.tsx).
    const siteEntries: string[] = []
    let s = 0
    for (const dir of siteFieldDirs(rootDir)) {
      const indexPath = ['index.ts', 'index.tsx'].map((f) => path.join(dir, f)).find(existsSync)!
      const inputPath = ['input.tsx', 'input.ts'].map((f) => path.join(dir, f)).find(existsSync)
      lines.push(`import si${s} from ${JSON.stringify(indexPath)}`)
      if (inputPath) {
        lines.push(`import sinput${s} from ${JSON.stringify(inputPath)}`)
        siteEntries.push(`[si${s}, sinput${s}]`)
      } else {
        siteEntries.push(`[si${s}, undefined]`)
      }
      s++
    }

    lines.push(
      'function buildFieldTypeUI(pairs) {',
      '  const out = {}',
      '  for (const [, client] of pairs) {',
      '    for (const desc of client?.fieldTypeUIs ?? []) {',
      '      if (!desc?.name || !desc?.Input) continue',
      '      out[desc.name] = { Input: desc.Input, validate: desc.validate }',
      '    }',
      '  }',
      '  return out',
      '}',
      'function buildSiteFieldTypeUI(pairs) {',
      '  const out = {}',
      '  for (const [def, Input] of pairs) {',
      '    if (!def?.name || !Input) continue',
      '    out[def.name] = { Input, validate: def.validate ? (value) => def.validate(value) : undefined }',
      '  }',
      '  return out',
      '}',
      // Built LAZILY on first lookup, not at module evaluation. An extension
      // client entry that also exports pages can import back into this
      // registry (page -> @/kit -> field-control -> here -> that same client),
      // and reading `client.fieldTypeUIs` mid-cycle threw "Cannot access
      // 'fieldTypeUIs' before initialization". Consumers only ever do
      // FIELD_TYPE_UI[name] at render time, which is long after every module
      // has settled.
      `let _fieldTypeUICache = null`,
      `function allFieldTypeUI() {`,
      `  if (!_fieldTypeUICache) {`,
      `    _fieldTypeUICache = {`,
      `      ...buildFieldTypeUI([${entries.join(', ')}]),`,
      `      ...buildSiteFieldTypeUI([${siteEntries.join(', ')}]),`,
      `    }`,
      `  }`,
      `  return _fieldTypeUICache`,
      `}`,
      `export const FIELD_TYPE_UI = new Proxy({}, {`,
      `  get: (_t, k) => allFieldTypeUI()[k],`,
      `  has: (_t, k) => k in allFieldTypeUI(),`,
      `  ownKeys: () => Reflect.ownKeys(allFieldTypeUI()),`,
      `  getOwnPropertyDescriptor: (_t, k) => {`,
      `    const all = allFieldTypeUI()`,
      `    return k in all ? { value: all[k], enumerable: true, configurable: true } : undefined`,
      `  },`,
      `})`,
    )
    return lines.join('\n')
  }
}

export function fieldTypeUiPlugin(rootDir: string): Plugin {
  const buildModule = () => buildFieldTypeUiModule(rootDir)

  return {
    name: 'tangen:field-type-ui',

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
        path.resolve(rootDir, 'app', 'fields'),
      ]
      for (const w of watched) server.watcher.add(w)
      server.watcher.on('change', (changedPath: string) => {
        if (!watched.some((w) => changedPath.startsWith(w))) return
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) {
          server.moduleGraph.invalidateModule(mod)
          server.ws.send({ type: 'full-reload' })
        }
      })
    },
  }
}
