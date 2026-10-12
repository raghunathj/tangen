/**
 * File Name: vite-plugin-app-ui.ts
 * Purpose: Vite plugin that generates the virtual:tangen/app-ui-registry module at build/dev time,
 *          loading APP_UI_REGISTRY and APP_BULK_ACTIONS from the project's app/admin/index.ts file.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Vite Plugin API; falls back to empty objects when app/admin/index.ts is absent.
 *                     HMR invalidates the virtual module on any change under app/admin/.
 *                     When app/admin/pages.ts(x) exists it is DYNAMICALLY imported and string
 *                     component references resolve to React.lazy wrappers, keeping heavy site
 *                     pages out of the admin entry chunk (companion pattern:
 *                     vite-plugin-extension-panels.ts).
 */
import type { Plugin, ViteDevServer } from 'vite'
import path from 'path'
import { existsSync } from 'fs'

const VIRTUAL_ID = 'virtual:tangen/app-ui-registry'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/**
 * Vite plugin that provides the `virtual:tangen/app-ui-registry` module.
 *
 * The virtual module exports `APP_UI_REGISTRY` and `APP_BULK_ACTIONS` — loaded
 * from `app/admin/index.ts` at the project root.
 *
 * That file must export:
 *   APP_UI_REGISTRY  — Record<string, AdminUIComponent>
 *   APP_BULK_ACTIONS — Record<string, DataListBulkAction[]>  (optional)
 *
 * Using a separate file (not tangen.config.ts) avoids pulling React into the
 * CLI / API processes that also load the main config.
 *
 * Falls back to empty objects when the registry file is absent.
 *
 * Lazy pages (optional): when `app/admin/pages.ts` (or `.tsx`) exists next to
 * index.ts, it is loaded via dynamic import() so its page components (and their
 * dependency graphs) split into their own chunk instead of landing in the admin
 * entry chunk. index.ts stays STATICALLY imported — APP_BULK_ACTIONS handlers
 * and any other non-component values keep their synchronous contract. Component
 * slots (ADMIN_EXTENSION.routes[].component, APP_UI_REGISTRY /
 * extension.components values) may then be STRINGS naming an export of
 * pages.ts; each resolves to a React.lazy wrapper (with Suspense baked in).
 * Resolution order: pages.ts export → same-named index.ts export (legacy) →
 * render-nothing component. Without pages.ts the emitted module is exactly the
 * legacy static form — zero behavior change for existing sites.
 *
 * HMR: invalidates the virtual module and triggers a full-reload when any file
 * under `<rootDir>/app/admin/` is added, changed, or removed.
 *
 * @param rootDir Absolute path to the project root (the directory that contains `app/`)
 */
export function appUiRegistryPlugin(rootDir: string): Plugin {
  const adminDir = path.resolve(rootDir, 'app/admin')

  function findRegistryFile() {
    const candidates = [
      path.join(adminDir, 'index.ts'),
      path.join(adminDir, 'index.tsx'),
    ]
    return candidates.find(p => existsSync(p)) ?? null
  }

  function findPagesFile() {
    const candidates = [
      path.join(adminDir, 'pages.ts'),
      path.join(adminDir, 'pages.tsx'),
    ]
    return candidates.find(p => existsSync(p)) ?? null
  }

  return {
    name: 'tangen:app-ui-registry',

    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },

    load(id: string) {
      if (id !== RESOLVED_ID) return

      const registryPath = findRegistryFile()
      if (!registryPath) {
        return [
          'export const APP_UI_REGISTRY = {}',
          'export const APP_BULK_ACTIONS = {}',
          'export const ADMIN_EXTENSION = {}',
        ].join('\n')
      }

      const pagesPath = findPagesFile()
      if (!pagesPath) {
        // Legacy static form — byte-for-byte what this plugin always emitted.
        return [
          `import * as _registry from ${JSON.stringify(registryPath)}`,
          `export const APP_UI_REGISTRY = _registry.APP_UI_REGISTRY ?? {}`,
          `export const APP_BULK_ACTIONS = _registry.APP_BULK_ACTIONS ?? {}`,
          `export const ADMIN_EXTENSION = {`,
          `  ...(_registry.extension ?? {}),`,
          `  components: { ...(_registry.APP_UI_REGISTRY ?? {}), ...(_registry.extension?.components ?? {}) },`,
          `}`,
        ].join('\n')
      }

      // Lazy form: index.ts stays static (sync bulk actions), pages.ts is
      // code-split via dynamic import. String component references resolve to
      // React.lazy wrappers with Suspense baked in, so they are safe wherever
      // a static component was rendered (router pages, DataList modals).
      return [
        `import * as _registry from ${JSON.stringify(registryPath)}`,
        `import { lazy as __lazy, createElement as __h, Suspense as __S } from 'react'`,
        `const __loadPages = () => import(${JSON.stringify(pagesPath)})`,
        `// Lazy component over one named export of app/admin/pages.ts.`,
        `// Falls back to a same-named index.ts export (legacy), then renders nothing.`,
        `function __lazyPage(name) {`,
        `  const C = __lazy(() => __loadPages().then((m) => ({ default: m[name] ?? _registry[name] ?? (() => null) })))`,
        `  const W = (props) => __h(__S, { fallback: null }, __h(C, props))`,
        `  W.displayName = 'LazyAppPage(' + name + ')'`,
        `  return W`,
        `}`,
        `const __resolve = (v) => (typeof v === 'string' ? __lazyPage(v) : v)`,
        `function __resolveMap(map) {`,
        `  const out = {}`,
        `  for (const k of Object.keys(map ?? {})) out[k] = __resolve(map[k])`,
        `  return out`,
        `}`,
        `export const APP_UI_REGISTRY = __resolveMap(_registry.APP_UI_REGISTRY)`,
        `export const APP_BULK_ACTIONS = _registry.APP_BULK_ACTIONS ?? {}`,
        `const __ext = _registry.extension ?? {}`,
        `export const ADMIN_EXTENSION = {`,
        `  ...__ext,`,
        `  routes: (__ext.routes ?? []).map((r) => ({ ...r, component: __resolve(r.component) })),`,
        `  components: { ...__resolveMap(_registry.APP_UI_REGISTRY), ...__resolveMap(__ext.components) },`,
        `}`,
      ].join('\n')
    },

    configureServer(server: ViteDevServer) {
      server.watcher.add(adminDir)
      const invalidate = (changedPath: string) => {
        if (!changedPath.startsWith(adminDir)) return
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) {
          server.moduleGraph.invalidateModule(mod)
          server.ws.send({ type: 'full-reload' })
        }
      }
      // 'add'/'unlink' matter now: creating or deleting pages.ts switches the
      // emitted module between its static and lazy forms.
      server.watcher.on('change', invalidate)
      server.watcher.on('add', invalidate)
      server.watcher.on('unlink', invalidate)
    },
  }
}
