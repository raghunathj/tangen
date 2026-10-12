/**
 * File Name: custom-tables-loader.ts
 * Purpose: The `@tangen/db/custom-tables` entry — resolves the GENERATED
 *          custom-tables Drizzle registry project-first, mirroring the
 *          content-tables loader. A consumer project's
 *          `app/generated/custom-tables.ts` (written by `tangen push`,
 *          committed to git) wins; otherwise the package's bundled
 *          `generated/custom-tables.ts` (monorepo / tests) is used; otherwise
 *          an empty registry. The API additionally falls back to building the
 *          pgTable from the boot-loaded CustomTableDefinition (schema-kit's
 *          customTablePg), so a missing/partial file never breaks queries.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Project-first: the project's generated file, then the bundled one —
 *          the generated schema lives in the PROJECT, not node_modules (which
 *          `npm i` wipes). Top-level await makes this an async module.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

type TableMap = Record<string, unknown>
interface GeneratedModule { customTables?: TableMap }

/**
 * Resolve the generated custom-tables MODULE (project-first, then bundled
 * fallback, then empty).
 */
async function resolveGenerated(
  workspaceRoot: string | undefined,
  bundled: () => Promise<GeneratedModule>,
): Promise<GeneratedModule> {
  if (workspaceRoot) {
    const projectFile = join(workspaceRoot, 'app', 'generated', 'custom-tables.ts')
    if (existsSync(projectFile)) {
      try {
        return await import(projectFile)
      } catch {
        // Fall through to the bundled fallback on a bad/partial project file.
      }
    }
  }
  try {
    return await bundled()
  } catch {
    return {}
  }
}

/** Resolve just the custom-tables registry (project-first). Exposed for tests. */
export async function loadCustomTables(
  workspaceRoot: string | undefined,
  bundled: () => Promise<GeneratedModule>,
): Promise<TableMap> {
  return (await resolveGenerated(workspaceRoot, bundled)).customTables ?? {}
}

const _generated: GeneratedModule = await resolveGenerated(
  process.env.TANGEN_WORKSPACE_DIR,
  () => import('./generated/custom-tables'),
)

/** Drizzle pgTable per custom table, keyed by table name. */
export const customTables: TableMap = _generated.customTables ?? {}
