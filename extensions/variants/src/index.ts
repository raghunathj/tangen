/**
 * File Name: index.ts
 * Purpose: Browser-safe client entry for the Variants extension - every
 *          component the manifest names (the editor panel and the
 *          Experiments page) is a named export the admin build resolves
 *          statically.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Keep free of server imports (db, node APIs, secrets);
 *          server logic lives in ./server.ts.
 */
export { VariantLineagePanel } from './panels'
export { ExperimentsPage } from './pages/experiments'
