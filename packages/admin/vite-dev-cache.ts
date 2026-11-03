/**
 * File Name: vite-dev-cache.ts
 * Purpose: Stops the dev server promising that the admin's own source will
 *          never change. In a consumer install that source lives inside
 *          node_modules, so Vite stamps its modules with the dep-optimizer's
 *          `?v=<hash>` and then, because the query is there, serves them
 *          `Cache-Control: max-age=31536000,immutable`.
 *
 *          The hash is computed from the DEPENDENCY metadata (the lockfile and
 *          the optimizeDeps config), not from file contents. `tangen patch`
 *          rewrites a file and the URL is byte-for-byte the same, so the
 *          browser keeps its cached copy for a year while the server holds the
 *          new one. The tab then dies on an export the file demonstrably has:
 *
 *            Uncaught SyntaxError: The requested module
 *            '/lib/field-presentation.ts?v=af9fb6d8' does not provide an
 *            export named 'subFieldSelectPlaceholder'
 *
 *          Restarting the server does not help, because the hash is
 *          deterministic: two incidents a day apart both carried `af9fb6d8`.
 *          Clearing `.vite` does not help either, for the same reason. Only a
 *          hard reload does, and only until the next patch.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Measured against the running server before the fix -
 *          `/lib/field-presentation.ts` answered `no-cache`, the same path with
 *          `?v=` answered immutable - so the version query alone decides it.
 *          Only `.vite/deps` has earned that promise: those files are rebuilt
 *          from scratch when the directory is cleared, and nothing patches
 *          them in place. A 304 on everything else costs one conditional
 *          request, which is what dev servers are for.
 */
import type { Plugin } from 'vite'

/**
 * Whether a dev URL may be served with a year-long immutable cache.
 *
 * @param url - The request URL, with or without a query string.
 * @returns True only for Vite's pre-bundled dependencies.
 */
export function mayCacheImmutably(url: string): boolean {
  const pathname = (url ?? '').split('?')[0] ?? ''
  return pathname.includes('/node_modules/.vite/deps/')
}

/**
 * Dev-only: downgrades `immutable` to `no-cache` for everything that is not a
 * pre-bundled dependency, so a file the patch script can overwrite is always
 * revalidated.
 *
 * It wraps `setHeader` rather than appending a later middleware, because the
 * header is written by Vite's own transform middleware as it responds - a
 * middleware registered after it never runs for a request it already handled.
 * The ETag Vite sets is left alone, so an unchanged module still answers 304.
 */
export function devSourceCachePlugin(): Plugin {
  return {
    name: 'tangen:dev-source-cache',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const original = res.setHeader.bind(res)
        res.setHeader = ((name: string, value: unknown) => {
          if (String(name).toLowerCase() === 'cache-control' && !mayCacheImmutably(req.url ?? '')) {
            return original(name, 'no-cache')
          }
          return original(name, value as never)
        }) as typeof res.setHeader
        next()
      })
    },
  }
}
