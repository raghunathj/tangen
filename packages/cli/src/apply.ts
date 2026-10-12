/**
 * File Name: apply.ts
 * Purpose: Executes a push against a live Postgres database in ONE transaction:
 *          the workspace row, the registry rows for every content operation
 *          (object_types, fields), and every statement the planner rendered
 *          (system columns, heals, content DDL, indexes, i18n side tables,
 *          auth profile columns, custom tables). A failure anywhere rolls back everything, so the
 *          database is never left between two pushes: no table without a
 *          primary key, no half-upgraded i18n table, no registry row whose
 *          column does not exist.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm for the registry rows and `sql.raw` for the
 *          planned statements. No index is created CONCURRENTLY, which is why
 *          indexes can sit inside the transaction; if a CONCURRENTLY escape
 *          hatch is ever added it must run after the commit as its own step.
 *          Extension push hooks run as separate transactions in push.ts. The
 *          reconcile* helpers at the bottom keep their old one-call shape for
 *          callers outside push (plan then execute on the given client).
 */
import { eq, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import type { DbClient } from '@tangen/db'
import { objectTypes, fields, workspaces, fullSchemaCacheKey, SCHEMA_CHANNEL } from '@tangen/db'
import type { ChangePlan, ChangeOperation } from './types'
import { evaluateDestructivePolicy } from './destructive-policy'
import { classifyOperation, type MigrationRisk } from './plan-ops'
import {
  planI18nTables, destructionKey, type PlannedStatement, type PlanSchemaType,
  type SqlReader, type DestructionCount,
} from './migration-plan'
import type { DeploymentRole } from '@tangen/types'

export { fieldTypeToSql } from './column-types'

/** Why a push is not going to run, and which class of reason it is. */
export interface SafetyGate {
  /** `ambiguous` is never openable; `destructive` opens with one --approve per operation, never in production. */
  risk: Exclude<MigrationRisk, 'safe'>
  /** The whole message, ready to print. */
  message: string
  /** The operations that caused it, for a caller that wants to render its own. */
  operations: ChangeOperation[]
}

/**
 * The push gate (freeze review C2). Three answers, not two:
 *
 *   null                    nothing stands in the way
 *   risk 'ambiguous'        blocked, and no approval changes it
 *   risk 'destructive'      blocked until every operation carries its own --approve; production refuses
 *
 * Ambiguity is checked first and answered on its own. A plan that both drops a
 * column and contains an unconvertible cast must not report "re-run with
 * --confirm", because re-running with --confirm would fail again: the user
 * would have authorised a destruction that was never the obstacle.
 *
 * `counts` is optional. Without it the message names the operations; with it,
 * it also says how much data each one removes. It is optional because
 * classification must not depend on a database being reachable.
 */
export function checkMigrationSafety(
  plan: ChangePlan,
  policy: { approvals: string[]; role: DeploymentRole },
  counts?: DestructionCount[],
): SafetyGate | null {
  const ambiguous = plan.operations.filter((op) => classifyOperation(op).risk === 'ambiguous')
  if (ambiguous.length > 0) {
    const remedies = [...new Set(ambiguous.map((op) => classifyOperation(op).remedy).filter(Boolean))]
    return {
      risk: 'ambiguous',
      operations: ambiguous,
      message: [
        '\nBlocked - these changes have no safe automatic migration:',
        ...ambiguous.map((op) => `  - ${classifyOperation(op).reason}`),
        '',
        'An approval does not apply here. It authorises destruction you have decided on,',
        'not an outcome the platform cannot predict.',
        '',
        ...remedies.map((r) => `  ${r}`),
      ].join('\n'),
    }
  }

  // C2: per-operation approval, and production refuses regardless.
  const verdict = evaluateDestructivePolicy(plan, { approvals: policy.approvals, counts, role: policy.role })
  if (verdict.allowed) return null
  return {
    risk: 'destructive',
    operations: plan.operations.filter((op) => classifyOperation(op).risk === 'destructive'),
    message: verdict.message,
  }
}

/** The workspace row a push registers (idempotent). */
export interface PushSeed {
  workspace: { id: string; name: string; slug: string }
}

export interface PushApplyInput {
  workspaceId: string
  /** The content operations to record in the registry (already filtered by the approval policy). */
  ops: ChangeOperation[]
  /** Every statement to execute, in order - the planner's list. */
  statements: PlannedStatement[]
  seed?: PushSeed
}

export interface PushApplyResult {
  /** The statements executed, in order (all of `statements` when the transaction committed). */
  executed: PlannedStatement[]
}

/**
 * Applies a push: registry rows + every planned statement in ONE transaction.
 * Throws (after the rollback) with the failing statement named.
 */
export async function applyPush(
  db: DbClient,
  input: PushApplyInput,
  onStatement?: (s: PlannedStatement) => void,
): Promise<PushApplyResult> {
  const { ops, statements } = input
  const executed: PlannedStatement[] = []

  await db.transaction(async (tx) => {
    if (input.seed) {
      await tx.insert(workspaces).values(input.seed.workspace).onConflictDoNothing()
    }

    await writeRegistry(tx, ops)

    for (const s of statements) {
      try {
        await tx.execute(sql.raw(s.sql))
      } catch (e) {
        const cause = e instanceof Error ? e.message : String(e)
        throw new Error(`${s.label} failed - ${cause}\n    ${s.sql.trim().split('\n').map((l) => l.trim()).join(' ')}\n  Nothing was applied: the transaction rolled back.`)
      }
      executed.push(s)
      onStatement?.(s)
    }
  })

  return { executed }
}

type Tx = Parameters<Parameters<DbClient['transaction']>[0]>[0]

/**
 * A config the registry stores as a jsonb OBJECT. A caller that hands over an
 * already-serialized string (the shape a double-serializing driver once wrote,
 * see planRegistryHeals) is parsed here, so the registry never gains another
 * encoded row whatever the caller did.
 */
export function asConfigObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** `previous_names` with the old name appended once. */
function rememberPreviousName(name: string) {
  return sql`(CASE WHEN ${name}::text = ANY(previous_names) THEN previous_names ELSE array_append(previous_names, ${name}::text) END)`
}

/** The registry rows for every content operation, in the apply's phase order. */
async function writeRegistry(tx: Tx, ops: ChangeOperation[]): Promise<void> {
  // Phase A: CREATE_TYPE
  for (const op of ops) {
    if (op.op !== 'CREATE_TYPE') continue
    // The id the code declares IS the registry identity (tangen pull and the
    // Schema Builder write it back for exactly this reason); a type declared
    // without one is minted here and is the one place an id is ever minted.
    const typeId = op.type.id ?? createId()
    await tx.insert(objectTypes).values({
      id: typeId,
      name: op.type.name,
      label: op.type.label,
      plural: op.type.plural ?? null,
      singleton: op.type.singleton ?? false,
      disabled: op.type.disabled ?? false,
      localized: (op.type as { localized?: boolean }).localized ?? false,
      previousNames: op.type.previousName ?? [],
      adminConfig: asConfigObject(op.type.admin) as any,
      // Which extension provisioned it (null = the site's own code). Stamped
      // here so the registry can answer the question forever after, including
      // after the extension is gone.
      providedBy: op.type.providedBy ?? null,
      schemaVersion: 1,
    })
    for (let i = 0; i < op.type.fields.length; i++) {
      const f = op.type.fields[i]
      await tx.insert(fields).values({
        id: createId(),
        typeId,
        name: f.name,
        label: f.label,
        fieldType: f.fieldType,
        config: asConfigObject(f.config) as any,
        previousNames: f.previousName ?? [],
        position: i,
        required: f.required ?? false,
        disabled: f.disabled ?? false,
      })
    }
  }

  // Phase B: RENAME_TYPE (the old name joins previous_names, so doctor and the
  // sibling environments can tell a rename from a drop)
  for (const op of ops) {
    if (op.op !== 'RENAME_TYPE') continue
    await tx.update(objectTypes)
      .set({ name: op.to, previousNames: rememberPreviousName(op.from), updatedAt: new Date() })
      .where(eq(objectTypes.id, op.typeId))
  }

  // Phase C: ADD_FIELD
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    if (op.op !== 'ADD_FIELD') continue
    await tx.insert(fields).values({
      id: createId(),
      typeId: op.typeId,
      name: op.field.name,
      label: op.field.label,
      fieldType: op.field.fieldType,
      config: asConfigObject(op.field.config) as any,
      previousNames: op.field.previousName ?? [],
      position: i,
      required: op.field.required ?? false,
      disabled: op.field.disabled ?? false,
    })
  }

  // Phase D: RENAME_FIELD
  for (const op of ops) {
    if (op.op !== 'RENAME_FIELD') continue
    await tx.update(fields)
      .set({ name: op.to, previousNames: rememberPreviousName(op.from), updatedAt: new Date() })
      .where(eq(fields.id, op.fieldId))
  }

  // Phase E: metadata-only updates
  for (const op of ops) {
    switch (op.op) {
      case 'UPDATE_FIELD_CONFIG':
        await tx.update(fields)
          .set({ config: asConfigObject(op.field.config) as any, fieldType: op.field.fieldType, label: op.field.label, updatedAt: new Date() })
          .where(eq(fields.id, op.fieldId))
        break
      case 'UPDATE_FIELD_REQUIRED':
        await tx.update(fields).set({ required: op.required, updatedAt: new Date() }).where(eq(fields.id, op.fieldId))
        break
      case 'UPDATE_FIELD_DISABLED':
        // Soft-disable toggle - metadata only, the column is never dropped.
        await tx.update(fields).set({ disabled: op.disabled, updatedAt: new Date() }).where(eq(fields.id, op.fieldId))
        break
      case 'UPDATE_TYPE_SINGLETON':
        await tx.update(objectTypes).set({ singleton: op.singleton, updatedAt: new Date() }).where(eq(objectTypes.id, op.typeId))
        break
      case 'UPDATE_TYPE_DISABLED':
        // Through the transaction (it used to go through `db`, surviving a rollback).
        await tx.update(objectTypes).set({ disabled: op.disabled, updatedAt: new Date() }).where(eq(objectTypes.id, op.typeId))
        break
      case 'UPDATE_TYPE_LOCALIZED':
        await tx.update(objectTypes).set({ localized: op.localized, updatedAt: new Date() }).where(eq(objectTypes.id, op.typeId))
        break
      case 'UPDATE_TYPE_PLURAL':
        await tx.update(objectTypes).set({ plural: op.plural, updatedAt: new Date() }).where(eq(objectTypes.id, op.typeId))
        break
      case 'UPDATE_TYPE_LABEL':
        await tx.update(objectTypes).set({ label: op.label, updatedAt: new Date() }).where(eq(objectTypes.id, op.typeId))
        break
      case 'UPDATE_TYPE_PROVIDED_BY':
        await tx.update(objectTypes).set({ providedBy: op.providedBy, updatedAt: new Date() }).where(eq(objectTypes.id, op.typeId))
        break
      case 'UPDATE_TYPE_ADMIN_CONFIG':
        await tx.update(objectTypes).set({ adminConfig: asConfigObject(op.admin) as any, updatedAt: new Date() }).where(eq(objectTypes.id, op.typeId))
        break
      default:
        break
    }
  }

  // Phase E2: CHANGE_FIELD_TYPE (the column cast is a planned statement; the registry changes in every tier)
  for (const op of ops) {
    if (op.op !== 'CHANGE_FIELD_TYPE') continue
    if (op.tier === 3) throw new Error(`Cannot apply incompatible type change for field "${op.fieldName}"`)
    await tx.update(fields).set({ fieldType: op.to, updatedAt: new Date() }).where(eq(fields.id, op.fieldId))
  }

  // Phase F: DROP_FIELD
  for (const op of ops) {
    if (op.op !== 'DROP_FIELD') continue
    await tx.delete(fields).where(eq(fields.id, op.fieldId))
  }

  // Phase G: DROP_TYPE - fields before the type (fields.type_id references object_types.id)
  for (const op of ops) {
    if (op.op !== 'DROP_TYPE') continue
    await tx.delete(fields).where(eq(fields.typeId, op.typeId))
    await tx.delete(objectTypes).where(eq(objectTypes.id, op.typeId))
  }
}

/**
 * Tell every running API that this environment's schema changed.
 *
 * Sent on the same client AFTER applyPush has returned, which is after its one
 * transaction committed - a notification inside the transaction would reach
 * listeners before the rows were visible, and one on a failed push would drop
 * caches for a change that never happened. The payload is the env id, the one
 * dimension the schema cache is keyed by. Best-effort: a push does not fail
 * because a NOTIFY did, since the API's TTL bounds the consequence.
 */
export async function notifySchemaChanged(db: { execute: (q: any) => Promise<any> }): Promise<boolean> {
  try {
    await db.execute(sql`SELECT pg_notify(${SCHEMA_CHANNEL}, '')`)
    return true
  } catch {
    return false
  }
}

/**
 * Invalidates the schema cache in Redis after a successful push.
 * @returns true when the cache key was reachable and cleared, false when
 *          Redis was unavailable (callers surface this so a stale running
 *          API is never a silent mystery).
 */
export async function invalidateSchemaCache(redisUrl: string, dbUrl?: string): Promise<boolean> {
  const Redis = (await import('ioredis')).default
  const redis = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 3000 })
  try {
    await redis.connect()
    // The API namespaces every key by projectRedisPrefix(dbUrl). Without the SAME
    // prefix this DEL hits a non-existent key and the running API keeps serving the
    // stale schema until its TTL expires. dbUrl comes from the env being pushed.
    await redis.del(fullSchemaCacheKey(dbUrl))
    return true
  } catch {
    return false
  } finally {
    redis.disconnect()
  }
}

/**
 * Ensures a `<type>_i18n` side table exists for every type with localized
 * fields, with one typed column per localized field (add-only). Plan, then
 * execute on the given client - for callers outside the push transaction.
 * @returns The side-table names touched.
 */
export async function reconcileI18nTables(
  db: SqlReader,
  schema: { types: PlanSchemaType[] },
  registry: Array<Record<string, unknown>> = [],
): Promise<string[]> {
  const { statements, touched } = await planI18nTables(db, schema, registry)
  for (const s of statements) await db.execute(sql.raw(s.sql))
  return touched
}

