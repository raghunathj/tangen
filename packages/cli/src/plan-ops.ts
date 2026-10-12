/**
 * File Name: plan-ops.ts
 * Purpose: The one place that says what a schema operation means for safety.
 *          Every surface - diff, the scoped filter, the plan printer, the push
 *          gate, `--plan` JSON and the admin schema builder - reads its answer
 *          from here, so a full plan and a scoped plan can never disagree and
 *          no surface can invent a second opinion.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure, and deliberately so: classification must not depend
 *          on a database connection, or two callers would classify the same
 *          plan differently depending on what they could reach.
 *
 *          The model is three states, not two (freeze review C2):
 *
 *            safe        deterministic, no data loss; a plain push applies it
 *            destructive understood loss; a per-operation approval authorises it (never in production)
 *            ambiguous   no defined outcome; nothing authorises it
 *
 *          The distinction that matters is the last one. `--confirm` exists to
 *          say "I know what will be destroyed". It cannot say "I accept an
 *          outcome nobody can predict", so it does not apply to ambiguous
 *          operations at all. A single "needs confirmation" bucket forced those
 *          two very different statements through one flag.
 *
 *          A `group` field has no column (column-types.ts), so dropping one is
 *          a registry change, not data loss: neither destructive nor a
 *          migration.
 */
import type { ChangeOperation, ChangePlan } from './types'
import { fieldHasColumn, fieldTypeToSql } from './column-types'

/** What a push may do with an operation. */
export type MigrationRisk = 'safe' | 'destructive' | 'ambiguous'

export interface OpRisk {
  risk: MigrationRisk
  /** One line, in the words the CLI prints. */
  reason: string
  /** What the developer must do instead. Ambiguous operations always carry one; nothing else does. */
  remedy?: string
}

/** Rank for "the worst risk in this plan". */
const RANK: Record<MigrationRisk, number> = { safe: 0, destructive: 1, ambiguous: 2 }

/** The remedy for every cast with no safe automatic form. It is always the same one. */
const CAST_REMEDY =
  'Rename the field instead (new name + previousName): the old column keeps its data and the new one starts clean. ' +
  'A value-by-value conversion is a migration, and a migration has to be written, not inferred.'

/**
 * The column kinds a cast runs between. `diff` stamps these; a caller that
 * omits them is not trusted into the safe bucket, so the field type's own
 * column kind is used instead.
 */
function castKinds(op: Extract<ChangeOperation, { op: 'CHANGE_FIELD_TYPE' }>) {
  return {
    from: op.fromSql !== undefined ? op.fromSql : fieldTypeToSql(op.from),
    to: op.toSql !== undefined ? op.toSql : fieldTypeToSql(op.to),
  }
}

/**
 * Why a tier-2 cast is or is not safe. Postgres will run all of them; the
 * question is whether the result is the same data.
 *
 * Verified against Postgres rather than reasoned about:
 *   array_to_string(ARRAY['a,b','c'], ',') = 'a,b,c'   two values in, three out
 *   a TIMESTAMPTZ ::TEXT reads '...10:00:00+00' under UTC and
 *   '...15:30:00+05:30' under Asia/Kolkata, so the same push writes different
 *   values to different environments.
 */
function classifyCast(op: Extract<ChangeOperation, { op: 'CHANGE_FIELD_TYPE' }>): OpRisk {
  const field = `"${op.fieldName}"`
  const change = `${op.from} → ${op.to}`
  if (op.tier === 1) {
    return { risk: 'safe', reason: `${field}: ${change} - same column kind, registry only` }
  }
  if (op.tier === 3) {
    return {
      risk: 'ambiguous',
      reason: `${field}: ${change} - the formats are unrelated; there is no conversion to run`,
      remedy: CAST_REMEDY,
    }
  }

  const { from, to } = castKinds(op)
  // Widening: every value has exactly one representation in the target and the
  // conversion depends on nothing outside the value itself.
  if (to === 'TEXT' && (from === 'NUMERIC' || from === 'BOOLEAN')) {
    return { risk: 'safe', reason: `${field}: ${change} - every value has one text form` }
  }
  if (from === 'TEXT[]' && to === 'TEXT') {
    return {
      risk: 'ambiguous',
      reason: `${field}: ${change} - the list is joined with commas, so a value containing a comma becomes two`,
      remedy: CAST_REMEDY,
    }
  }
  if (from === 'TIMESTAMPTZ' && to === 'TEXT') {
    return {
      risk: 'ambiguous',
      reason: `${field}: ${change} - the text depends on the database session's time zone, so environments would disagree`,
      remedy: CAST_REMEDY,
    }
  }
  if (from === 'TEXT') {
    return {
      risk: 'ambiguous',
      reason: `${field}: ${change} - existing text that does not parse has no defined result`,
      remedy: CAST_REMEDY,
    }
  }
  // Any tier-2 pair not named above: unrecognised, so not assumed safe.
  return {
    risk: 'ambiguous',
    reason: `${field}: ${change} - this conversion has no reviewed safe form`,
    remedy: CAST_REMEDY,
  }
}

/**
 * The risk of one operation. This is the classification; everything else in
 * this file, and every surface outside it, is a view of this function.
 */
export function classifyOperation(op: ChangeOperation): OpRisk {
  switch (op.op) {
    case 'DROP_TYPE':
      return { risk: 'destructive', reason: `type "${op.name}" - the table and every row in it` }
    case 'DROP_FIELD':
      return fieldHasColumn(op.fieldType)
        // typeName is absent on ops built by hand (tests, tooling); the message
        // must degrade to the field alone rather than print "undefined".
        ? { risk: 'destructive', reason: `field "${op.name}"${op.typeName ? ` on ${op.typeName}` : ''} - the column and every value in it` }
        : { risk: 'safe', reason: `field "${op.name}" - a group owns no column, so this is a registry change` }
    case 'CHANGE_FIELD_TYPE':
      return classifyCast(op)
    case 'PURGE_EXTENSION':
      return { risk: 'destructive', reason: `extension "${op.extensionId}" - its extension_data, its rows in ${op.tables.length > 0 ? op.tables.map((t) => `"${t}"`).join(', ') : 'no owned table'}, its migration ledger and its installation record` }
    case 'PURGE_GUARDED':
      return { risk: 'destructive', reason: op.kind === 'table'
        ? `guarded table "${op.name}" (was "${op.original}") - the table and every row kept in it`
        : `guarded column "${op.table}"."${op.name}" (was "${op.original}") - every value kept in it` }
    case 'COMPONENT_FIELD_PURGE':
      // Destructive, not ambiguous: there is no undefined winner, only a value
      // that will not exist afterwards. The count is impact, never the verdict -
      // nought, a hundred and a million occurrences classify identically.
      return {
        risk: 'destructive',
        reason: `component "${op.component}": every historical "${op.key}" value, and the translations of those blocks`,
      }
    case 'COMPONENT_FIELD_RENAME': {
      const what = `component "${op.component}": "${op.sources.join('"/"')}" → "${op.to}"`
      // The probe established the fact; this decides what it means. A block
      // holding both keys has two values and no defined winner, and --confirm
      // cannot pick one: that is not known destruction, it is an unknown
      // outcome, so it is ambiguous rather than destructive.
      if (op.conflict) {
        return {
          risk: 'ambiguous',
          reason: `${what} - stored blocks hold BOTH keys, so there are two values and no rule for which survives`,
          remedy: `Decide per value before migrating: rename to a name nothing uses, or purge the historical "${op.sources.join('"/"')}" values explicitly.`,
        }
      }
      // Moving a value from one key to another loses nothing, and the same
      // migration run twice is a no-op, so there is nothing to authorise.
      return { risk: 'safe', reason: `${what} - the stored value moves to the new key` }
    }
    default:
      // Everything else adds, renames, indexes or edits the registry. None of
      // it removes a column, a table or a value.
      return { risk: 'safe', reason: op.op }
  }
}

/** The worst risk in a set of operations. An empty plan is safe. */
export function planRisk(operations: ChangeOperation[]): MigrationRisk {
  let worst: MigrationRisk = 'safe'
  for (const op of operations) {
    const { risk } = classifyOperation(op)
    if (RANK[risk] > RANK[worst]) worst = risk
  }
  return worst
}

/** Destructive: the op removes stored data. A group drop is not one. */
export function isDestructiveOp(op: ChangeOperation): boolean {
  return classifyOperation(op).risk === 'destructive'
}

/** Ambiguous: no flag applies it. */
export function isBlockedOp(op: ChangeOperation): boolean {
  return classifyOperation(op).risk === 'ambiguous'
}

/**
 * Migration: the op changes the physical schema (DDL), as opposed to a
 * registry-only metadata change. This is what `hasMigrations` means for every
 * plan, full or scoped. Independent of risk: a rename is a migration and safe,
 * a label change is neither.
 */
export function isMigrationOp(op: ChangeOperation): boolean {
  switch (op.op) {
    case 'CREATE_TYPE':
    case 'RENAME_TYPE':
    case 'RENAME_FIELD':
    case 'CREATE_INDEX':
    case 'DROP_INDEX':
    case 'DROP_TYPE':
      return true
    case 'ADD_FIELD':
      return fieldHasColumn(op.field.fieldType, op.field.config as Record<string, unknown>)
    case 'DROP_FIELD':
      return fieldHasColumn(op.fieldType)
    case 'CHANGE_FIELD_TYPE':
      return op.tier === 2
    case 'COMPONENT_FIELD_RENAME':
    case 'COMPONENT_FIELD_PURGE':
      // They write to the database, so a plan carrying one has work to do, even
      // though they alter no table.
      return true
    default:
      return false
  }
}

/** The plan flags, computed the same way for every plan. */
export function planFlags(operations: ChangeOperation[]): Pick<ChangePlan, 'hasDestructive' | 'hasMigrations'> {
  return {
    hasDestructive: operations.some(isDestructiveOp),
    hasMigrations: operations.some(isMigrationOp),
  }
}

// The operations a push applies live in destructive-policy.ts
// (`filterApprovedOps`): safe always, destructive only with its own approval
// and never in production, ambiguous never.
