/**
 * File Name: print-plan.ts
 * Purpose: Renders a ChangePlan to the terminal in a human-readable, color-coded format,
 * grouping field-level operations under their parent type name.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Uses ANSI color helpers from ui.ts. Destructive operations and tier-2 type
 * changes are highlighted with warning symbols.
 */
import type { ChangePlan, ChangeOperation } from './types'
import type { MigrationPlan, PlannedStatement, PlanNote } from './migration-plan'
import { groupStatements } from './migration-plan'
import { classifyOperation, isDestructiveOp, planRisk } from './plan-ops'
import { renameHints } from './diff'
import { c, sym } from './ui'

/** The statements and notes a plan carries beside its content operations. */
export type PlanMigrations = Pick<MigrationPlan, 'statements' | 'notes'>

// ─── Machine-readable plan (tangen push --plan --json) ───────────────────────

/**
 * The published, agent-facing spelling of a risk. It is the wire name for
 * `MigrationRisk`, kept stable so `--plan --json` consumers do not break:
 *  - `safe`          — a plain `tangen push` applies it
 *  - `needs-confirm` — destructive; applies only with its own `--approve <token>`, never in production
 *  - `blocked`       — ambiguous; no flag applies it
 */
export type OpSafety = 'safe' | 'needs-confirm' | 'blocked'

const WIRE: Record<string, OpSafety> = { safe: 'safe', destructive: 'needs-confirm', ambiguous: 'blocked' }

/** Never decides anything: plan-ops classifies, this renames. */
export function classifyOp(op: ChangeOperation): OpSafety {
  return WIRE[classifyOperation(op).risk]!
}

/**
 * What a component rename would move, in one line. The counts are advisory
 * enrichment, exactly like the destructive preview's: `safety` above already
 * came from `classifyOperation`, and nothing here can change it.
 */
function componentRenameDetail(op: Extract<ChangeOperation, { op: 'COMPONENT_FIELD_RENAME' }>): string {
  const head = `stored key ${op.sources.join('/')} → ${op.to}`
  const i = op.impact
  if (!i) return head
  if (op.conflict) return `${head} (${i.baseConflict} rows hold BOTH keys)`
  const locales = Object.values(i.localeSource).reduce((a, b) => a + b, 0)
  const parts = [`${i.baseSource} rows`]
  if (locales > 0) parts.push(`${locales} translations`)
  if (i.baseMigrated > 0) parts.push(`${i.baseMigrated} already moved`)
  return `${head} (${parts.join(', ')})`
}

/** One normalized change for agents/tools — op name, what it touches, safety. */
export interface PlanItem {
  op: ChangeOperation['op']
  /** How this op applies — an agent keys its next command off this. */
  safety: OpSafety
  type?: string
  field?: string
  detail?: string
}

/**
 * The dry-run summary an agent reads before deciding to apply. Stable, versioned
 * shape (bump `version` on any breaking change).
 */
export interface PlanJson {
  version: 1
  hasChanges: boolean
  hasDestructive: boolean
  hasMigrations: boolean
  /** No needs-confirm and no blocked ops — a plain `tangen push` applies it all. */
  canAutoApply: boolean
  /** At least one op is blocked — the push cannot proceed until it is resolved. */
  blocked: boolean
  counts: { added: number; changed: number; removed: number }
  /** Per-safety tallies across every item. */
  safety: { safe: number; needsConfirm: number; blocked: number }
  added: PlanItem[]
  changed: PlanItem[]
  removed: PlanItem[]
  /** Distinct content-type names touched by the plan (for scoped-apply / warnings). */
  affectedTypes: string[]
  /** Raw operations, for full fidelity. */
  operations: ChangeOperation[]
  /** Every statement the apply will run, in execution order, grouped by `group`. */
  statements: PlannedStatement[]
  /** Decisions shown but not executed (a column kept because a sibling environment still registers it). */
  notes: PlanNote[]
  /** A drop + add pair of the same type on one type: probably a rename missing its previousName. */
  hints: string[]
  /** Registry types nobody declares any more because their extension stopped. Never dropped. */
  orphans: Array<{ type: string; providedBy: string }>
}

/** The content-type name an operation is scoped to, if any. Field/index/update ops
 *  carry `typeName`; CREATE_TYPE carries the local type; DROP_TYPE carries `name`. */
export function opTypeName(op: ChangeOperation): string | undefined {
  if (op.op === 'CREATE_TYPE') return op.type.name
  if (op.op === 'DROP_TYPE') return op.name
  return (op as { typeName?: string }).typeName
}

/** Bucket a ChangePlan into added/changed/removed with human-readable details. */
export function planToJson(plan: ChangePlan, migrations: PlanMigrations = { statements: [], notes: [] }): PlanJson {
  const added: PlanItem[] = []
  const changed: PlanItem[] = []
  const removed: PlanItem[] = []

  for (const op of plan.operations) {
    const safety = classifyOp(op)
    switch (op.op) {
      case 'CREATE_TYPE':
        added.push({ op: op.op, safety, type: op.type.name, detail: op.type.singleton ? 'singleton' : 'new type' }); break
      case 'CREATE_SINGLETON_OBJECT':
        added.push({ op: op.op, safety, type: op.typeName }); break
      case 'ADD_FIELD':
        // `index: true` on a new field is real DDL, so it belongs in the plan.
        // Stage G11's agent read a plan that said only "region  text", pushed,
        // and got a column with no index (G11-1); the plan has to say what the
        // apply will actually do.
        added.push({ op: op.op, safety, field: op.field.name, detail: (op.field.config as Record<string, unknown> | undefined)?.index === true ? `${op.field.fieldType}, indexed` : op.field.fieldType }); break
      case 'CREATE_INDEX':
        added.push({ op: op.op, safety, type: op.typeName, field: op.field.name, detail: 'index' }); break
      case 'DROP_TYPE':
        removed.push({ op: op.op, safety, type: op.name }); break
      case 'DROP_FIELD':
        removed.push({ op: op.op, safety, field: op.name }); break
      case 'DROP_INDEX':
        removed.push({ op: op.op, safety, type: op.typeName, field: op.fieldName, detail: 'index' }); break
      case 'RENAME_TYPE':
        changed.push({ op: op.op, safety, type: op.to, detail: `renamed from ${op.from}` }); break
      case 'RENAME_FIELD':
        changed.push({ op: op.op, safety, field: op.to, detail: `renamed from ${op.from}` }); break
      case 'UPDATE_FIELD_CONFIG':
        changed.push({ op: op.op, safety, field: op.field.name, detail: 'config updated' }); break
      case 'UPDATE_FIELD_REQUIRED':
        changed.push({ op: op.op, safety, field: op.fieldName, detail: `required: ${op.required}` }); break
      case 'UPDATE_FIELD_DISABLED':
        changed.push({ op: op.op, safety, field: op.fieldName, detail: op.disabled ? 'disabled (hidden from all APIs)' : 're-enabled' }); break
      case 'CHANGE_FIELD_TYPE':
        changed.push({ op: op.op, safety, field: op.fieldName, detail: `${op.from} → ${op.to} (tier ${op.tier}${kindChange(op)})` }); break
      case 'COMPONENT_FIELD_PURGE': {
        const i = op.impact
        const locales = i ? Object.values(i.localeEntries).reduce((a, b) => a + b, 0) : 0
        removed.push({
          op: op.op, safety, type: op.component, field: op.key,
          detail: i ? `historical values deleted (${i.baseRows} rows${locales > 0 ? `, ${locales} translations` : ''})` : 'historical values deleted',
        }); break
      }
      case 'COMPONENT_FIELD_RENAME':
        changed.push({
          op: op.op, safety, type: op.component, field: op.to,
          detail: componentRenameDetail(op),
        }); break
      case 'UPDATE_TYPE_SINGLETON':
        changed.push({ op: op.op, safety, detail: `singleton: ${op.singleton}` }); break
      case 'UPDATE_TYPE_DISABLED':
        changed.push({ op: op.op, safety, detail: op.disabled ? 'disabled (content APIs 404)' : 're-enabled' }); break
      case 'UPDATE_TYPE_PLURAL':
        changed.push({ op: op.op, safety, detail: op.plural ? `plural: ${op.plural}` : 'plural: (inferred)' }); break
      case 'UPDATE_TYPE_LABEL':
        changed.push({ op: op.op, safety, type: op.typeName, detail: `label: ${op.label}` }); break
      case 'UPDATE_TYPE_ADMIN_CONFIG':
        changed.push({ op: op.op, safety, detail: 'admin config updated' }); break
      case 'UPDATE_TYPE_PROVIDED_BY':
        changed.push({ op: op.op, safety, type: op.typeName, detail: describeProvidedBy(op.providedBy) }); break
    }
  }

  const all = [...added, ...changed, ...removed]
  const safety = {
    safe: all.filter((i) => i.safety === 'safe').length,
    needsConfirm: all.filter((i) => i.safety === 'needs-confirm').length,
    blocked: all.filter((i) => i.safety === 'blocked').length,
  }

  return {
    version: 1,
    hasChanges: plan.operations.length > 0,
    hasDestructive: plan.hasDestructive,
    hasMigrations: plan.hasMigrations,
    canAutoApply: safety.needsConfirm === 0 && safety.blocked === 0,
    blocked: safety.blocked > 0,
    counts: { added: added.length, changed: changed.length, removed: removed.length },
    safety,
    added, changed, removed,
    affectedTypes: [...new Set(plan.operations.map(opTypeName).filter((n): n is string => !!n))],
    operations: plan.operations,
    statements: migrations.statements,
    notes: migrations.notes,
    hints: renameHints(plan.operations),
    orphans: plan.orphans ?? [],
  }
}

/** How an ownership change reads in a plan. */
export function describeProvidedBy(providedBy: string | null): string {
  return providedBy ? `now provided by extension ${providedBy}` : 'now declared by this site'
}

/** `, TEXT[] to TEXT` when the column kind changes; '' for a registry-only change. */
function kindChange(op: Extract<ChangeOperation, { op: 'CHANGE_FIELD_TYPE' }>): string {
  if (op.fromSql === undefined || op.toSql === undefined || op.fromSql === op.toSql) return ''
  return `, ${op.fromSql ?? 'no column'} to ${op.toSql ?? 'no column'}`
}

/** Print the plan as JSON (for `--plan --json`). */
export function printPlanJson(plan: ChangePlan, migrations?: PlanMigrations, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ok: true, ...planToJson(plan, migrations), ...extra }, null, 2))
}

function fieldType(ft: string) {
  return c.dim(`[${ft}]`)
}

function pad(name: string, width: number) {
  return name + ' '.repeat(Math.max(1, width - name.length))
}

export function printPlan(plan: ChangePlan, migrations?: PlanMigrations): void {
  printContentOps(plan)
  printOrphans(plan)
  if (migrations) printMigrations(migrations)
}

/**
 * Types the registry still carries that no extension declares any more. They
 * are printed even when the plan is otherwise empty, because "no schema
 * changes" would be a true sentence hiding a table nobody owns.
 */
export function printOrphans(plan: ChangePlan): void {
  const orphans = plan.orphans ?? []
  if (orphans.length === 0) return
  console.log()
  console.log(`  ${c.dim('Not declared here any more')}`)
  console.log()
  for (const o of orphans) {
    console.log(`  ${sym.bullet}  ${c.bold(o.type)}  ${c.dim(`extension ${o.providedBy} no longer declares it - table, rows and registry row are KEPT`)}`)
  }
  console.log(`     ${c.dim('Re-enable the extension to own it again, or declare the type in your own schema to take it over (then it drops like any other type, with --confirm).')}`)
  console.log()
}

/**
 * The statements the apply will run beyond the content operations, grouped
 * in execution order: what `--plan` shows is exactly what `push` executes.
 */
export function printMigrations(migrations: PlanMigrations): void {
  const groups = groupStatements(migrations)
  if (groups.length === 0) return
  console.log(`  ${c.dim('Migrations')}`)
  console.log()
  for (const g of groups) {
    console.log(`  ${sym.change}  ${c.bold(g.label)}`)
    for (const s of g.statements) {
      // Ownership is never hidden behind a generic "updating extension" line:
      // the operator sees the concrete database change and who asked for it.
      const from = s.owner ? `  ${c.cyan(`extension ${s.owner.id}@${s.owner.version}`)}` : ''
      console.log(`       ${sym.add} ${s.label}${from}`)
    }
    for (const n of g.notes) console.log(`       ${sym.bullet} ${c.dim(n.label)}`)
    console.log()
  }
}

function printContentOps(plan: ChangePlan): void {
  if (plan.operations.length === 0) return

  // ── Group field-level ops under their parent type name ───────────────────
  const typeOrder: string[] = []   // stable order from ops list
  const byType = new Map<string, ChangeOperation[]>()
  const topLevel: ChangeOperation[] = []

  // A rename and the metadata ops that ride with it are ONE type. The update
  // ops carry the runtime (old) name and the create/provenance ops the new one,
  // so without this the same type prints as two blocks under two names.
  const renamedTo = new Map<string, string>()
  for (const op of plan.operations) if (op.op === 'RENAME_TYPE') renamedTo.set(op.from, op.to)
  const groupKey = (name: string) => renamedTo.get(name) ?? name

  for (const op of plan.operations) {
    if (op.op === 'CREATE_TYPE') {
      if (!byType.has(op.type.name)) { typeOrder.push(op.type.name); byType.set(op.type.name, []) }
      byType.get(op.type.name)!.push(op)
    } else if (op.op === 'DROP_TYPE' || op.op === 'RENAME_TYPE') {
      topLevel.push(op)
    } else if ('typeName' in op) {
      const name = groupKey((op as any).typeName as string)
      if (!byType.has(name)) { typeOrder.push(name); byType.set(name, []) }
      byType.get(name)!.push(op)
    } else if ('typeId' in op) {
      // fallback: use typeId as key
      const key = (op as any).typeId as string
      if (!byType.has(key)) { typeOrder.push(key); byType.set(key, []) }
      byType.get(key)!.push(op)
    } else {
      topLevel.push(op)
    }
  }

  console.log()
  console.log(`  ${c.dim('Changes')}`)
  console.log()

  // ── Top-level ops (drop/rename type) ────────────────────────────────────
  for (const op of topLevel) {
    if (op.op === 'DROP_TYPE') {
      console.log(`  ${sym.remove}  ${c.bold(c.red(op.name))}  ${c.red('drop type')}`)
    } else if (op.op === 'RENAME_TYPE') {
      console.log(`  ${sym.change}  ${c.bold(op.from)} ${sym.arrow} ${c.bold(c.cyan(op.to))}  ${c.dim('rename')}`)
    } else if (op.op === 'COMPONENT_FIELD_RENAME') {
      // Not under a content type: one component rename moves stored values in
      // every column that can hold its blocks.
      const i = op.impact
      const where = op.sites?.length ? op.sites.map((s) => `${s.typeName}.${s.column}`).join(', ') : ''
      console.log(`  ${sym.change}  ${c.bold(`component ${op.component}`)}  ${c.bold(op.sources.join('/'))} ${sym.arrow} ${c.bold(c.cyan(op.to))}  ${c.dim('stored key')}`)
      if (where) console.log(`       ${c.dim(`in ${where}`)}`)
      if (op.conflict) {
        const n = i?.baseConflict ?? 0
        console.log(`       ${c.red(`${n} ${n === 1 ? 'row holds' : 'rows hold'} BOTH keys - blocked, see below`)}`)
      } else if (i) {
        const locales = Object.entries(i.localeSource).map(([l, n]) => `${l}: ${n}`).join(', ')
        console.log(`       ${c.dim(`${i.baseSource} ${i.baseSource === 1 ? 'row moves' : 'rows move'}`)}${i.baseMigrated > 0 ? c.dim(`, ${i.baseMigrated} already moved`) : ''}`)
        if (locales) console.log(`       ${c.dim(`translations - ${locales}`)}`)
      }
    }
  }

  // ── Per-type blocks ───────────────────────────────────────────────────────
  for (const typeName of typeOrder) {
    const ops = byType.get(typeName)!
    const createOp = ops.find(o => o.op === 'CREATE_TYPE') as Extract<ChangeOperation, { op: 'CREATE_TYPE' }> | undefined
    const fieldOps = ops.filter(o => o.op !== 'CREATE_TYPE')

    if (createOp) {
      // New type — print header + all initial fields. A type an extension
      // provisions says so: nobody should go looking for the schema file that
      // declares it, and nobody should think they forgot to write one.
      const label = createOp.type.singleton ? c.dim('singleton') : c.dim('new type')
      const from = createOp.type.providedBy ? `  ${c.cyan(`from extension ${createOp.type.providedBy}`)}` : ''
      console.log(`  ${sym.add}  ${c.bold(c.green(typeName))}  ${label}${from}`)

      const nameWidth = Math.max(...createOp.type.fields.map(f => f.name.length), 0)
      for (const f of createOp.type.fields) {
        console.log(`       ${c.green(pad(f.name, nameWidth))}  ${fieldType(f.fieldType)}`)
      }
    } else if (fieldOps.length > 0) {
      // Existing type with mutations
      console.log(`  ${sym.change}  ${c.bold(typeName)}`)
    }

    // Field-level ops (for existing types, or extra ops on new types)
    const nameWidth = Math.max(...fieldOps.map(o => {
      if ('field' in o) return (o as any).field?.name?.length ?? 0
      if ('name' in o) return (o as any).name?.length ?? 0
      if ('from' in o) return (o as any).from?.length ?? 0
      if ('fieldName' in o) return (o as any).fieldName?.length ?? 0
      return 0
    }), 0)

    for (const op of fieldOps) {
      if (op.op === 'ADD_FIELD') {
        console.log(`       ${sym.add} ${c.green(pad(op.field.name, nameWidth))}  ${fieldType(op.field.fieldType)}${(op.field.config as Record<string, unknown> | undefined)?.index === true ? `  ${c.dim('indexed')}` : ''}`)
      } else if (op.op === 'DROP_FIELD') {
        // A group has no column: removing it is a registry change, not data loss.
        const what = isDestructiveOp(op) ? c.red('drop') : c.dim('drop (group - no column, registry only)')
        console.log(`       ${sym.remove} ${c.red(pad(op.name, nameWidth))}  ${what}`)
      } else if (op.op === 'RENAME_FIELD') {
        console.log(`       ${sym.change} ${c.yellow(op.from)} ${sym.arrow} ${c.cyan(op.to)}`)
      } else if (op.op === 'UPDATE_FIELD_CONFIG') {
        console.log(`       ${sym.change} ${c.yellow(pad(op.field.name, nameWidth))}  ${fieldType(op.field.fieldType)}  ${c.dim('config updated')}`)
      } else if (op.op === 'CHANGE_FIELD_TYPE') {
        const tier =
          op.tier === 1 ? c.dim('auto') :
          op.tier === 2 ? c.yellow('cast; see the gate') :
          c.red('blocked')
        const kinds = op.tier === 1 ? c.dim(' (same column kind, registry only)') : c.dim(kindChange(op).replace(/^, /, ' (') + (kindChange(op) ? ')' : ''))
        console.log(
          `       ${sym.change} ${c.yellow(pad(op.fieldName, nameWidth))}  ` +
          `${c.dim(op.from)} ${sym.arrow} ${c.cyan(op.to)}  ${c.dim(`tier ${op.tier}:`)} ${tier}${kinds}`,
        )
      } else if (op.op === 'UPDATE_FIELD_REQUIRED') {
        console.log(`       ${sym.change} ${c.yellow(pad(op.fieldName ?? op.fieldId, nameWidth))}  ${c.dim(`required: ${op.required}`)}`)
      } else if (op.op === 'UPDATE_FIELD_DISABLED') {
        console.log(`       ${sym.change} ${c.yellow(pad(op.fieldName ?? op.fieldId, nameWidth))}  ${c.dim(op.disabled ? 'disabled (hidden from all APIs)' : 're-enabled')}`)
      } else if (op.op === 'UPDATE_TYPE_LABEL') {
        console.log(`       ${sym.change} ${c.dim(`label: ${op.label}`)}`)
      } else if (op.op === 'UPDATE_TYPE_SINGLETON') {
        console.log(`       ${sym.change} ${c.dim(`singleton: ${op.singleton}`)}`)
      } else if (op.op === 'UPDATE_TYPE_DISABLED') {
        console.log(`       ${sym.change} ${c.dim(op.disabled ? 'type disabled (content APIs 404)' : 'type re-enabled')}`)
      } else if (op.op === 'UPDATE_TYPE_LOCALIZED') {
        console.log(`       ${sym.change} ${c.dim(`localized: ${op.localized}`)}`)
      } else if (op.op === 'UPDATE_TYPE_PLURAL') {
        console.log(`       ${sym.change} ${c.dim(op.plural ? `plural: ${op.plural}` : 'plural: (inferred)')}`)
      } else if (op.op === 'UPDATE_TYPE_ADMIN_CONFIG') {
        console.log(`       ${sym.change} ${c.dim('admin config updated')}`)
      } else if (op.op === 'UPDATE_TYPE_PROVIDED_BY') {
        console.log(`       ${sym.change} ${c.dim(describeProvidedBy(op.providedBy))}`)
      } else if (op.op === 'CREATE_SINGLETON_OBJECT') {
        console.log(`       ${sym.add} ${c.dim('singleton row seeded')}`)
      } else if (op.op === 'CREATE_INDEX') {
        console.log(`       ${sym.add} ${c.dim('index on')} ${c.green(op.field.name)}`)
      } else if (op.op === 'DROP_INDEX') {
        console.log(`       ${sym.remove} ${c.dim('index on')} ${c.red(op.fieldName)}`)
      }
    }

    if (createOp || fieldOps.length > 0) console.log()
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  const dropCount = plan.operations.filter(o => (o.op === 'DROP_FIELD' || o.op === 'DROP_TYPE') && isDestructiveOp(o)).length
  const tier2Count = plan.operations.filter(o => o.op === 'CHANGE_FIELD_TYPE' && (o as any).tier === 2).length

  if (plan.hasDestructive && dropCount > 0) {
    console.log(`  ${sym.warn}  ${c.yellow(`${dropCount} destructive operation(s) skipped - approve each with ${c.bold('--approve <token>')} (never in production)`)}`)
  }
  if (tier2Count > 0) {
    console.log(`  ${sym.warn}  ${c.yellow(`${tier2Count} type change(s) cast data; see the gate above`)}`)
  }
  for (const hint of renameHints(plan.operations)) {
    console.log(`  ${sym.warn}  ${c.yellow(hint)}`)
  }
}
