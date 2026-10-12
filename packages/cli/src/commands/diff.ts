/**
 * File Name: diff.ts
 * Purpose: Implements the `tangen diff` command: the same preflight `push`
 *   runs (read-only), printed as the complete plan - content operations and
 *   every migration statement - without applying anything.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: push-preflight.ts does the work; this command only
 *   prints. The schema type-check is skipped (diff has never run tsc; `push`
 *   and `check` do), everything else is the push's own decision.
 */
import { printPlan } from '../print-plan'
import { preflight } from '../push-preflight'
import { c } from '../ui'

/**
 * Runs the push preflight for the given environment and prints the change plan;
 * exits 0 when the plan could be computed, 1 when the preflight refused the schema.
 * @param cwd - Directory containing `tangen.config.ts`
 * @param workspaceId - The workspace id the CLI resolved
 */
export async function runDiffCommand(cwd: string, workspaceId?: string): Promise<void> {

  const pf = await preflight({ cwd, workspaceId }, { check: false })
  if (!pf.ok) {
    console.error(`  ${c.red('✗')}  ${pf.title}`)
    for (const e of pf.errors) console.error(`     - ${e}`)
    process.exit(1)
  }

  printPlan(pf.plan, pf.migration)
  if (pf.plan.operations.length === 0 && pf.migration.statements.length === 0) console.log(`  ${c.dim('no schema changes')}`)

  process.exit(0)
}
