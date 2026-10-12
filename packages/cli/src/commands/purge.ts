/**
 * File Name: purge.ts
 * Purpose: `tangen purge component <component>.<field>` - the explicit, imperative
 *   destruction of historical component sub-field values.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is a command and not a push artefact, deliberately.
 *   Removing a field from a component definition HIDES its stored values; that
 *   must stay true forever, so nothing declarative may ever imply a purge. A
 *   declaration would also be permanent, re-running on every push, when this is
 *   a thing you do once.
 *
 *   It reuses the push's preflight to reach the database, the same read-only
 *   probe the rename uses to count, C2's `classifyOperation` to decide that it
 *   is destructive, and `applyPush` for one transaction. It adds no second
 *   safety model and no second traversal.
 *
 *   Two refusals guard the target, both before the transaction opens: the key
 *   must not be a CURRENT field of the component (deleting every value of a live
 *   field is a different operation), and that check is re-read from code on the
 *   `--confirm` run, so a schema edited between the plan and the apply cannot
 *   turn a historical purge into a live one.
 */
import { preflight } from '../push-preflight'
import { planComponentPurge, purgePlan, isCurrentField, type PurgeTarget } from '../component-migration'
import { classifyOperation } from '../plan-ops'
import { applyPush } from '../apply'
import { evaluateDestructivePolicy, approvalToken } from '../destructive-policy'
import { listGuardedObjects, purgeGuarded } from '../guarded-drops'
import { c, sym } from '../ui'

export interface PurgeOptions {
  planOnly?: boolean
  /** `--approve <token>`, one per operation; `purge-component-field:<component>.<field>` here. */
  approvals?: string[]
  json?: boolean
}

/** `hero.title` - the only accepted spelling, so the target is never a guess. */
export function parsePurgeTarget(arg: string | undefined): PurgeTarget | null {
  if (!arg) return null
  const m = /^([A-Za-z0-9_.-]+)\.([A-Za-z0-9_]+)$/.exec(arg.trim())
  if (!m) return null
  return { component: m[1]!, key: m[2]! }
}

export async function runPurgeCommand(
  cwd: string,
  targetArg: string | undefined,
  opts: PurgeOptions = {},
  workspaceId?: string,
): Promise<void> {
  const target = parsePurgeTarget(targetArg)
  if (!target) {
    console.error('tangen: purge needs a target, as <component>.<field> - for example, tangen purge component hero.title')
    process.exit(1)
  }

  const pf = await preflight({ cwd, workspaceId }, { check: false })
  if (!pf.ok) {
    console.error(`  ${c.red('✗')}  ${pf.title}`)
    for (const e of pf.errors) console.error(`     - ${e}`)
    process.exit(1)
  }

  const registry = ((pf.config as { components?: unknown }).components ?? []) as never[]
  if (!registry.some((cd: { name?: string }) => cd.name === target.component)) {
    console.error(`tangen: no component named "${target.component}" in this project`)
    process.exit(1)
  }
  // The line that keeps purge to history. A live field's values are a different
  // operation with different semantics, and this is not that operation.
  if (isCurrentField(registry, target)) {
    console.error(`tangen: "${target.component}.${target.key}" is still a field of the component, so its values are not historical.`)
    console.error('        Purge deletes data the current schema no longer declares. Remove the field from the component first, then purge.')
    process.exit(1)
  }

  const { op } = await planComponentPurge(pf.db, pf.validationSchema as never, registry, target)
  if (!op) {
    console.log(`  ${c.dim(`no content type stores "${target.component}" blocks - nothing to purge`)}`)
    process.exit(0)
  }
  const risk = classifyOperation(op)
  const i = op.impact!
  const localeTotal = Object.values(i.localeEntries).reduce((a, b) => a + b, 0)

  if (opts.json) {
    console.log(JSON.stringify({
      operation: op.op, component: op.component, field: op.key,
      safety: 'needs-approval', approval: approvalToken(op), risk: risk.risk,
      impact: { baseRows: i.baseRows, localeEntries: i.localeEntries, localeOrphans: i.localeOrphans },
      sites: op.sites, applied: false,
    }, null, 2))
  } else {
    console.log()
    console.log(`  ${c.red(c.bold('Historical component data will be permanently deleted.'))}`)
    console.log()
    console.log(`  component ${c.bold(op.component)}`)
    console.log(`  field     ${c.bold(op.key)}`)
    console.log()
    for (const s of op.sites ?? []) console.log(`  ${s.typeName}.${s.column}`)
    console.log(`    ${i.baseRows.toLocaleString()} content ${i.baseRows === 1 ? 'row contains' : 'rows contain'} this value`)
    if (localeTotal > 0) {
      console.log()
      console.log('  translations')
      for (const [loc, n] of Object.entries(i.localeEntries)) console.log(`    ${loc}: ${n.toLocaleString()}`)
    }
    if (i.localeOrphans > 0) {
      console.log()
      console.log(`  ${c.yellow(`${i.localeOrphans} translation ${i.localeOrphans === 1 ? 'entry' : 'entries'} could not be attributed to a "${op.component}" block and will NOT be purged.`)}`)
      console.log(`  ${c.dim('Their block no longer exists in the base value, so nothing proves the translation was ever this component\'s.')}`)
    }
    console.log()
    console.log(`  ${c.dim('Revision history and Porter exports are not modified: an old revision or an')}`)
    console.log(`  ${c.dim('import can bring these values back, and the rename intent that names them stays declared.')}`)
    console.log()
  }

  // C2: the same policy as push - one approval naming this purge, never in production.
  const verdict = evaluateDestructivePolicy({ operations: [op], hasDestructive: true, hasMigrations: true } as never, { approvals: opts.approvals ?? [], role: pf.role })
  if (opts.planOnly || !verdict.allowed) {
    if (!opts.json) {
      console.log(opts.planOnly
        ? `  ${c.dim('dry run - nothing deleted.')}${verdict.allowed ? '' : verdict.message}`
        : `  ${c.yellow('Nothing was deleted.')}${verdict.message}`)
    }
    process.exit(opts.planOnly ? 0 : 1)
  }

  if (i.baseRows === 0 && localeTotal === 0) {
    if (!opts.json) console.log(`  ${c.dim('nothing to purge')}`)
    process.exit(0)
  }

  // ops: [] on purpose - a purge writes no registry rows, it only deletes data.
  const statements = purgePlan(op)
  await applyPush(pf.db, { workspaceId: pf.workspaceId, ops: [], statements })
  if (opts.json) console.log(JSON.stringify({ applied: true, statements: statements.length }, null, 2))
  else console.log(`  ${sym.tick}  purged ${c.bold(`${op.component}.${op.key}`)} ${c.dim(`(${i.baseRows} rows, ${localeTotal} translations)`)}`)
  process.exit(0)
}

export interface ExtensionPurgeOptions {
  planOnly?: boolean
  approvals?: string[]
  json?: boolean
}

/**
 * `tangen purge extension <id> [--plan] [--approve purge-extension:<id>] [--json]`
 * The explicit deletion of what an uninstall retained, in ONE workspace x
 * environment (closure plan Phase 4, Unit 9): extension_data, the rows of
 * the tables the extension owns, its migration ledger, its installation
 * record. Owned tables are kept aside as guarded drops once no installation
 * remains anywhere. One exact approval; production refuses; never a push.
 */
export async function runExtensionPurgeCommand(
  cwd: string,
  extensionId: string | undefined,
  opts: ExtensionPurgeOptions = {},
  workspaceId?: string,
): Promise<void> {
  if (!extensionId) {
    console.error('tangen: usage - tangen purge extension <id> [--plan] [--approve purge-extension:<id>] [--json]')
    process.exit(1)
  }
  const { purgeExtension, inventoryExtension, extensionPurgeToken } = await import('../extension-purge')
  const pf = await preflight({ cwd, workspaceId }, { check: false })
  if (!pf.ok) {
    console.error(`  ${c.red('✗')}  ${pf.title}`)
    for (const e of pf.errors) console.error(`     - ${e}`)
    process.exit(1)
  }
  const scope = { workspaceId: pf.workspaceId, extensionId }
  if (opts.planOnly) {
    const inventory = await inventoryExtension(pf.db, scope)
    if (opts.json) { console.log(JSON.stringify({ applied: false, inventory, token: extensionPurgeToken(scope) }, null, 2)); process.exit(0) }
    console.log()
    console.log(`  ${c.bold(extensionId)}: ${inventory.install ? `${inventory.install.state}${inventory.install.uninstalledAt ? ` since ${inventory.install.uninstalledAt}` : ''}` : 'no installation record'}`)
    console.log(`    extension_data rows: ${inventory.extensionDataRows}   migration ledger rows: ${inventory.ledgerRows}   installed elsewhere: ${inventory.installedElsewhere}`)
    for (const t of inventory.tables) console.log(`    "${t.table}": ${t.rows === null ? 'cannot be scoped (no workspace_id column); left alone' : `${t.rows} rows in this workspace`}`)
    console.log(`    delete with: tangen purge extension ${extensionId} --approve ${extensionPurgeToken(scope)}`)
    console.log(`  ${c.dim('dry run - nothing deleted.')}`)
    process.exit(0)
  }
  const result = await purgeExtension(pf.db, {
    ...scope, role: pf.role, approvals: opts.approvals ?? [],
    apply: async (statements) => { await applyPush(pf.db, { workspaceId: pf.workspaceId, ops: [], statements }) },
  })
  if (opts.json) {
    console.log(JSON.stringify({ applied: result.applied, inventory: result.inventory, statements: result.statements.map((s) => s.sql), message: result.message }, null, 2))
    process.exit(result.applied ? 0 : 1)
  }
  if (!result.applied) { console.log(result.message); process.exit(1) }
  for (const s of result.statements) console.log(`  ${sym.tick}  ${s.label}`)
  console.log(`  ${c.dim(`purged ${extensionId}; a reinstall starts fresh.`)}`)
  process.exit(0)
}

export interface GuardedPurgeOptions {
  list?: boolean
  planOnly?: boolean
  approvals?: string[]
  json?: boolean
}

/**
 * `tangen purge guarded [<table>.<column> | <table>] ... [--list] [--plan] [--approve purge-guarded:<name>]`
 * - the explicit, individually approved physical deletion of what a guarded
 * drop kept aside. `--list` names every guarded object with its row count.
 */
export async function runGuardedPurgeCommand(
  cwd: string,
  targets: string[],
  opts: GuardedPurgeOptions = {},
  workspaceId?: string,
): Promise<void> {
  const pf = await preflight({ cwd, workspaceId }, { check: false })
  if (!pf.ok) {
    console.error(`  ${c.red('✗')}  ${pf.title}`)
    for (const e of pf.errors) console.error(`     - ${e}`)
    process.exit(1)
  }
  if (opts.list || targets.length === 0) {
    const objects = await listGuardedObjects(pf.db)
    if (opts.json) { console.log(JSON.stringify({ guarded: objects }, null, 2)); process.exit(0) }
    if (objects.length === 0) { console.log(`  ${c.dim('no guarded drops: nothing was kept aside')}`); process.exit(0) }
    console.log()
    for (const o of objects) {
      const where = o.kind === 'table' ? o.name : `${o.table}.${o.name}`
      console.log(`  ${where}  ${c.dim(`was "${o.original}"; ${o.rows === null ? 'uncounted' : `${o.rows.toLocaleString()} ${o.kind === 'table' ? 'rows' : 'values'}`}`)}`)
      console.log(`    recover: declare "${o.original}" again and push     delete: tangen purge guarded ${where} --approve purge-guarded:${o.name}`)
    }
    console.log()
    process.exit(0)
  }
  const result = await purgeGuarded(pf.db, {
    role: pf.role, targets, approvals: opts.approvals ?? [],
    apply: opts.planOnly
      ? async () => {}
      : async (statements) => { await applyPush(pf.db, { workspaceId: pf.workspaceId, ops: [], statements }) },
  })
  if (opts.json) {
    console.log(JSON.stringify({ applied: result.applied && !opts.planOnly, objects: result.objects, statements: result.statements.map((s) => s.sql), message: result.message }, null, 2))
    process.exit(result.applied ? 0 : 1)
  }
  if (!result.applied) { console.log(result.message); process.exit(1) }
  if (opts.planOnly) { for (const s of result.statements) console.log(`  ${c.dim(s.sql)}`); console.log(`  ${c.dim('dry run - nothing deleted.')}`); process.exit(0) }
  for (const o of result.objects) console.log(`  ${sym.tick}  purged ${c.bold(o.kind === 'table' ? o.name : `${o.table}.${o.name}`)} ${c.dim(`(was "${o.original}")`)}`)
  process.exit(0)
}
