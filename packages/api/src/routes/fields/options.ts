/**
 * File Name: options.ts
 * Purpose: GET /api/v1/admin/field-options/:typeName/:fieldName — resolves a
 *          field's dynamic select options by executing its code-side options
 *          function (behavior overlay), with a short Redis cache.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Admin-panel only (member JWT required). The options
 *          function receives a FieldBehaviorContext with a LocalClient so it
 *          can query other types, custom tables, or external APIs.
 */
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'
import { lookupBehavior } from '../../services/field-behavior'
import { createLocalClient } from '../../services/local-client'

const OPTIONS_CACHE_TTL = 60 // seconds

function cacheKey(ws: string, typeName: string, fieldName: string): string {
  return `tangen:fieldopts:${ws}:${typeName}:${fieldName}`
}

/**
 * Registers the dynamic field-options endpoint. Mounted after authMiddleware;
 * additionally restricted to members — API keys cannot enumerate options.
 */
export const fieldOptionsRoute = (app: Elysia) =>
  app.get('/api/v1/admin/field-options/:typeName/:fieldName', async (ctx: any) => {
    const { db, redis, schema, workspaceId, memberId, behaviorRegistry, params } = ctx
    const { typeName, fieldName } = params

    if (!memberId) {
      throw new RequestError('FORBIDDEN', 'Field options are admin-panel only', 403)
    }

    const typeDef = schema?.types?.find((t: any) => t.name === typeName)
    if (!typeDef || typeDef.disabled) {
      throw new RequestError('TYPE_NOT_FOUND', `Type "${typeName}" not found in schema`, 404)
    }

    const behavior = behaviorRegistry
      ? lookupBehavior(behaviorRegistry, workspaceId, typeName, fieldName)
      : undefined
    if (!behavior?.optionsFn) {
      throw new RequestError('NOT_FOUND', `Field "${typeName}.${fieldName}" has no dynamic options resolver`, 404)
    }

    const key = cacheKey(workspaceId, typeName, fieldName)
    if (redis) {
      const cached = await redis.get(key).catch(() => null)
      if (cached) return { data: JSON.parse(cached) }
    }

    const tangen = createLocalClient({ db, redis, schema, workspaceId })
    const options = await behavior.optionsFn({
      row: {},
      workspaceId,
      tangen,
    })

    if (redis) {
      redis.set(key, JSON.stringify(options), 'EX', OPTIONS_CACHE_TTL).catch(() => {})
    }

    return { data: options }
  })
