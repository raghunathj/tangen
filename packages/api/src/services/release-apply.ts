/**
 * File Name: release-apply.ts
 * Purpose: Publishing one Release item in place (tasks/remove-environments-programme.md,
 *          stage R4): the live draft is compared against the frozen payload
 *          and, when it is what was approved, goes through the one publish
 *          path (services/publish-object.ts) - hooks, validation, revision,
 *          event, extension data - exactly as a hand publish would.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { SchemaDefinition } from '@tangen/types'
import { RequestError } from '../lib/errors'
import { publishObject } from './publish-object'
import { readObjectSource, fingerprintObject, draftContentOf, type FrozenObjectSource } from './object-snapshot'

export type ApplyOutcome = 'published' | 'unchanged' | 'failed'

export interface ReleaseItemResult {
  objectId: string
  outcome: ApplyOutcome
  error?: string
}

export interface EngineInput {
  db: any
  workspaceId: string
  releaseId: string
  tables: Record<string, any>
  memberId: string
  /** The applying member's role and CURRENT bundle (kernel K4): publish asks the policy for them; absent, publishObject skips the grant check as before. */
  memberRole?: string | null
  permissions?: unknown
  /** The release execution (K5): kind `release`, the applier as actor, on every event record. */
  exec?: import('@tangen/types').ExecutionContext | null
  eventBus: { emit: (event: Record<string, unknown>) => unknown }
  redis: unknown
  schema: SchemaDefinition
  projects: any[]
}

/**
 * One item: refuses when the draft is no longer what was frozen (a retry after
 * an edit), reports `unchanged` when the object is already published with the
 * frozen content, otherwise publishes.
 */
export async function applyReleaseItem(input: EngineInput, item: { typeName: string; objectId: string }, frozen: FrozenObjectSource): Promise<ReleaseItemResult> {
  const table = input.tables[item.typeName]
  if (!table) return { objectId: item.objectId, outcome: 'failed', error: `type "${item.typeName}" no longer exists` }
  const current = await readObjectSource(input.db, input.workspaceId, item.typeName, table, item.objectId)
  if (!current) return { objectId: item.objectId, outcome: 'failed', error: 'the object no longer exists' }
  if (fingerprintObject(current) !== fingerprintObject(frozen)) return { objectId: item.objectId, outcome: 'failed', error: 'the draft changed after approval; approve the release again' }
  const row = current.row
  if (row.status === 'published' && row.publishedValues && publishedMatchesDraft(row)) return { objectId: item.objectId, outcome: 'unchanged' }
  try {
    await publishObject({
      db: input.db, redis: input.redis, eventBus: input.eventBus, schema: input.schema, workspaceId: input.workspaceId,
      memberId: input.memberId, apiKeyId: null, memberRole: input.memberRole ?? null, permissions: input.permissions, projects: input.projects, exec: input.exec ?? null,
    }, item.typeName, item.objectId)
    return { objectId: item.objectId, outcome: 'published' }
  } catch (e) {
    return { objectId: item.objectId, outcome: 'failed', error: e instanceof RequestError ? e.message : e instanceof Error ? e.message : String(e) }
  }
}

/** True when the published snapshot and the draft's content agree on every field either carries. */
function publishedMatchesDraft(row: Record<string, unknown>): boolean {
  const published = row.publishedValues as Record<string, unknown> | null
  if (!published) return false
  const content = draftContentOf(row)
  for (const k of new Set([...Object.keys(published), ...Object.keys(content)])) {
    if (k === 'i18n') continue
    if (JSON.stringify(published[k] ?? null) !== JSON.stringify(row[k] ?? null)) return false
  }
  return true
}
