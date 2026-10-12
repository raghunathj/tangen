/**
 * File Name: slug-check.ts
 * Purpose: Elysia route plugin that checks whether a given slug is available within a content type's table.
 *          Supports an optional excludeId parameter to skip the current object during edit operations.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires @tangen/db contentTables; no auth required — workspace/env scoping is applied.
 */
import { eq, and, ne, sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { contentTables } from '@tangen/db/content-tables'
import { RequestError } from '../../lib/errors'

/**
 * Elysia plugin providing GET /api/v1/objects/slug-check to verify slug availability for a given content type.
 * @returns Elysia plugin function
 */
export const slugCheckRoute = (app: Elysia) =>
  app.get('/api/v1/objects/slug-check', async (ctx: any) => {
    const { query, db, workspaceId, schema } = ctx
    const { type, slug, excludeId } = query as Record<string, string>

    if (!type || !slug) {
      throw new RequestError('VALIDATION_ERROR', 'type and slug query params are required')
    }

    const typeDef = schema.types.find((t: any) => t.name === type)
    if (!typeDef || typeDef.disabled) throw new RequestError('NOT_FOUND', `Type "${type}" not found`, 404)

    const table = (contentTables as Record<string, any>)[type]
    if (!table) throw new RequestError('NOT_FOUND', `Table for type "${type}" not found`, 404)

    const conditions = [
      eq(table.workspaceId, workspaceId),
      sql`${sql.raw('"slug"')} = ${slug}`,
    ]
    if (excludeId) conditions.push(ne(table.id, excludeId))

    const rows = await db.select({ id: table.id }).from(table).where(and(...conditions)).limit(1)

    return { available: rows.length === 0 }
  })
