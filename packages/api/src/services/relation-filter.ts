/**
 * File Name: relation-filter.ts
 * Purpose: B3 — server-side enforcement of relation `config.filter`: a write naming a
 *   target entry OUTSIDE the filter is rejected (422), so the admin picker's restriction
 *   (same filter, applied to its query) can't be bypassed via the REST API. The filter
 *   is an ordinary QueryFilter evaluated against the TARGET type via the local client.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { createLocalClient } from './local-client'
import { flattenFields } from '@tangen/types'
import type { SchemaDefinition, FieldDefinition } from '@tangen/types'

export interface RelationFilterDeps {
  db: any
  redis: any
  schema: SchemaDefinition
  workspaceId: string
}

/** Written relation ids for a value (single id or many array). */
export function relationIdsOf(value: unknown, many: boolean): string[] {
  if (many) return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : []
  return typeof value === 'string' && value.length > 0 ? [value] : []
}

/**
 * Validate every filtered relation field present in `values`. Returns
 * fieldName → error for ids that don't match the field's filter (or don't exist).
 */
export async function validateRelationFilters(
  deps: RelationFilterDeps,
  fields: FieldDefinition[],
  values: Record<string, unknown>,
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {}
  let client: ReturnType<typeof createLocalClient> | null = null

  for (const field of flattenFields(fields)) {
    if (field.fieldType !== 'relation') continue
    const cfg = (field.config ?? {}) as { targetType?: string; many?: boolean; filter?: Record<string, unknown> }
    if (!cfg.filter || Object.keys(cfg.filter).length === 0 || !cfg.targetType) continue
    if (!(field.name in values)) continue
    const ids = relationIdsOf(values[field.name], cfg.many === true)
    if (ids.length === 0) continue

    client ??= createLocalClient({ db: deps.db, redis: deps.redis, schema: deps.schema, workspaceId: deps.workspaceId })
    const res = await client
      .objects(cfg.targetType)
      .where({ ...cfg.filter, id: { in: ids } } as never)
      .props(['id'])
      .limit(ids.length)
      .find()
    const found = new Set((res.data ?? []).map((r: Record<string, unknown>) => r.id as string))
    const rejected = ids.filter((i) => !found.has(i))
    if (rejected.length > 0) {
      errors[field.name] = `${field.label}: ${rejected.length === 1 ? 'the selected entry does not match' : `${rejected.length} selected entries do not match`} this field's filter`
    }
  }
  return errors
}
