/**
 * File Name: query.ts
 * Purpose: Handles POST /api/v1/tables/:name/query — executes a filtered, sorted, and
 *          paginated query against a named custom table registered in the project config.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia route handler; custom tables execute through the generated
 *   Drizzle registry (custom-table-registry — the same path the local client uses);
 *   compileTableFilters/filterToSQL translate QueryFilter trees to SQL conditions.
 *   This route is workspace-scoped by contract.
 */
import { eq } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { Elysia } from 'elysia'
import type { QueryFilter, CustomTableDefinition, QueryResult } from '@tangen/types'
import { compileTableFilters, filterToSQL } from '../../services/query-compiler'
import { resolveCustomTablePg, runTableSelect } from '../../services/custom-table-registry'
import { assertTablePermission } from '../../lib/permissions'
import { RouteError } from '@tangen/types'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

interface TableQueryInput {
  query?: QueryFilter
  sort?: { field: string; direction?: 'asc' | 'desc' }
  limit?: number
  offset?: number
  props?: string[]
}

/**
 * Executes a paginated, filtered query against a named custom table.
 * @param ctx - Query context including params, body, db connection, workspaceId, and customTables config.
 * @returns A QueryResult containing the matching rows and pagination metadata.
 */
export async function executeTableQuery(ctx: {
  params: { name: string }
  body: TableQueryInput
  db: any
  workspaceId: string
  customTables?: CustomTableDefinition[]
}): Promise<QueryResult> {
  const { params, body, db, workspaceId, customTables = [] } = ctx
  const tableName = params.name

  const tableDef = customTables.find(t => t.name === tableName)
  if (!tableDef) {
    throw new RouteError(404, `Custom table "${tableName}" not registered`)
  }
  const table = await resolveCustomTablePg(tableDef)

  const input = body ?? {}
  const limit = Math.min(Math.max(1, Number(input.limit ?? DEFAULT_LIMIT)), MAX_LIMIT)
  const offset = Math.max(0, Number(input.offset ?? 0))
  const sortField = input.sort?.field ?? 'id'
  const sortDir = input.sort?.direction === 'asc' ? 'asc' as const : 'desc' as const
  const propsVal = input.props && input.props.length > 0 ? input.props : null

  // Workspace-scoped by contract.
  const conditions: SQL[] = [eq(table.workspace_id, workspaceId)]

  if (input.query) {
    const allowedCols = new Set(['id', 'workspace_id', ...Object.keys(tableDef.columns)])
    const compiled = compileTableFilters(input.query, allowedCols)
    for (const f of compiled) conditions.push(filterToSQL(f))
  }

  return runTableSelect(db, table, {
    conditions,
    sortField,
    sortDir,
    limit,
    offset,
    props: propsVal,
  })
}

/**
 * Registers the POST /api/v1/tables/:name/query route on the given Elysia app.
 * @param app - The Elysia application instance to attach the route to.
 * @returns The Elysia app with the table-query route mounted.
 */
export const queryTableRoute = (app: Elysia) =>
  app.post('/api/v1/tables/:name/query', async (ctx: any) => {
    const { params, body, db, workspaceId, workspaceProjects, permissions, memberId } = ctx
    // K0: the read is gated on the caller's `tables` grant (MCP always did;
    // REST served every column of every table to any credential).
    assertTablePermission(permissions, 'read', params.name, { isMember: !!memberId })
    const project = (workspaceProjects ?? []).find((p: any) => p.workspaceId === workspaceId)
    const customTables: CustomTableDefinition[] = project?.config?.customTables ?? []
    return executeTableQuery({ params, body, db, workspaceId, customTables })
  })
