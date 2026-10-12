/**
 * File Name: labels.ts
 * Purpose: Labels (operational, cross-cutting tags) for content records — the first
 *   surface of the system-tags primitive. Free-form labels an admin/API/MCP attaches
 *   to a record, distinct from a content type's modeled `tags` field. Backed by the
 *   polymorphic entity_tags table (services/tags.ts); gated by the type's read/write
 *   capability.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Routes (path param `:id` is the TYPE name, `:objectId` the record id — matching
 * the existing /objects/:id/:objectId/... convention so memoirist doesn't conflict):
 *   GET    /api/v1/objects/:id/:objectId/labels   → list a record's labels
 *   PUT    /api/v1/objects/:id/:objectId/labels   → replace (body { labels: string[] })
 *   POST   /api/v1/objects/:id/:objectId/labels   → add (body { labels })
 *   DELETE /api/v1/objects/:id/:objectId/labels   → remove (body { labels })
 *   GET    /api/v1/labels/suggest?type=<t>&q=<q>  → autocomplete (distinct labels)
 */
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'
import { assertObjectPermission } from '../../lib/permissions'
import { requireMemberSession, requireCapability } from '../../lib/member-access'
import {
  addTags, removeTags, setTags, listTags, distinctTags, contentEntityType,
} from '../../services/tags'

function assertType(schema: any, type: string) {
  const typeDef = schema?.types?.find((t: any) => t.name === type)
  if (!typeDef || typeDef.disabled) throw new RequestError('NOT_FOUND', `Type "${type}" not found`, 404)
}

/** Non-content taggable entity kinds (content uses 'content:<type>'). */
const GENERIC_ENTITY_KINDS = new Set(['member', 'submission', 'media'])

/** Validate an entityType and gate access. Content → the type's read/write cap;
 *  generic kinds → an authenticated member session for reads, and a manage cap for
 *  writes (members: manage:members; submissions/media: manage:settings). */
function assertLabelAccess(ctx: any, entityType: string, action: 'read' | 'write') {
  requireMemberSession(ctx)
  if (entityType.startsWith('content:')) {
    const type = entityType.slice('content:'.length)
    assertType(ctx.schema, type)
    assertObjectPermission(ctx.permissions, action, type)
    return
  }
  if (!GENERIC_ENTITY_KINDS.has(entityType)) {
    throw new RequestError('VALIDATION_ERROR', `Unknown entityType "${entityType}"`)
  }
  if (action === 'write') {
    const mac = { permissions: ctx.permissions, memberId: ctx.memberId }
    requireCapability(mac, entityType === 'member' ? 'manage:members' : 'manage:settings')
  }
}

/** Read the labels array from a request body — accepts `labels` (canonical) or
 *  `tags` (alias, since the internal primitive is tags). */
export function bodyLabels(body: any): unknown {
  return body?.labels ?? body?.tags ?? []
}

// Routes are registered as STATEMENTS (not a fluent chain) and the original `app`
// is returned. Chaining 5 methods produces a deeply-typed Elysia that, flowed into
// the main app's long `.use()` chain, trips TS2589 ("excessively deep"). Statement
// registration keeps this plugin's type a plain `Elysia`, so it never deepens the
// accumulated app type. Runtime is identical — the methods mutate the same instance.
export const labelsRoute = (app: Elysia): Elysia => {
  // `:id` = type name, `:objectId` = record id (see header).
  app.get('/api/v1/objects/:id/:objectId/labels', async (ctx: any) => {
    const { params, db, workspaceId, schema, permissions } = ctx
    assertType(schema, params.id)
    assertObjectPermission(permissions, 'read', params.id)
    const labels = await listTags(db, {
      workspaceId, entityType: contentEntityType(params.id), entityId: params.objectId,
    })
    return { data: { labels } }
  })

  app.put('/api/v1/objects/:id/:objectId/labels', async (ctx: any) => {
    const { params, body, db, workspaceId, schema, permissions, memberId } = ctx
    assertType(schema, params.id)
    assertObjectPermission(permissions, 'write', params.id)
    const scope = { workspaceId, entityType: contentEntityType(params.id), entityId: params.objectId }
    const labels = await setTags(db, scope, bodyLabels(body), { source: 'user', by: memberId ?? null })
    return { data: { labels } }
  })

  app.post('/api/v1/objects/:id/:objectId/labels', async (ctx: any) => {
    const { params, body, db, workspaceId, schema, permissions, memberId } = ctx
    assertType(schema, params.id)
    assertObjectPermission(permissions, 'write', params.id)
    const scope = { workspaceId, entityType: contentEntityType(params.id), entityId: params.objectId }
    await addTags(db, scope, bodyLabels(body), { source: 'user', by: memberId ?? null })
    return { data: { labels: await listTags(db, scope) } }
  })

  app.delete('/api/v1/objects/:id/:objectId/labels', async (ctx: any) => {
    const { params, body, db, workspaceId, schema, permissions } = ctx
    assertType(schema, params.id)
    assertObjectPermission(permissions, 'write', params.id)
    const scope = { workspaceId, entityType: contentEntityType(params.id), entityId: params.objectId }
    await removeTags(db, scope, bodyLabels(body))
    return { data: { labels: await listTags(db, scope) } }
  })

  // ── Generic entity labels (any entity: content:<type> | member | submission | media).
  // Query/body params (no path params) so this can't conflict in the router.
  app.get('/api/v1/entity-labels', async (ctx: any) => {
    const { query, db, workspaceId } = ctx
    const entityType = String(query.entityType ?? '')
    const entityId = String(query.entityId ?? '')
    if (!entityType || !entityId) throw new RequestError('VALIDATION_ERROR', 'entityType and entityId are required')
    assertLabelAccess(ctx, entityType, 'read')
    return { data: { labels: await listTags(db, { workspaceId, entityType, entityId }) } }
  })

  const write = (verb: 'put' | 'post' | 'delete') => async (ctx: any) => {
    const { body, db, workspaceId, memberId } = ctx
    const entityType = String(body?.entityType ?? '')
    const entityId = String(body?.entityId ?? '')
    if (!entityType || !entityId) throw new RequestError('VALIDATION_ERROR', 'entityType and entityId are required')
    assertLabelAccess(ctx, entityType, 'write')
    const scope = { workspaceId, entityType, entityId }
    if (verb === 'put') await setTags(db, scope, bodyLabels(body), { source: 'user', by: memberId ?? null })
    else if (verb === 'post') await addTags(db, scope, bodyLabels(body), { source: 'user', by: memberId ?? null })
    else await removeTags(db, scope, bodyLabels(body))
    return { data: { labels: await listTags(db, scope) } }
  }
  app.put('/api/v1/entity-labels', write('put'))
  app.post('/api/v1/entity-labels', write('post'))
  app.delete('/api/v1/entity-labels', write('delete'))

  // Autocomplete — accepts `entityType` (generic, preferred) or `type` (content legacy).
  app.get('/api/v1/labels/suggest', async (ctx: any) => {
    const { query, db, workspaceId } = ctx
    const entityType = query.entityType ? String(query.entityType)
      : query.type ? contentEntityType(String(query.type)) : ''
    if (!entityType) throw new RequestError('VALIDATION_ERROR', 'entityType (or type) is required')
    assertLabelAccess(ctx, entityType, 'read')
    const labels = await distinctTags(db, {
      workspaceId, entityType, query: (query.q as string) || undefined, limit: 20,
    })
    return { data: { labels } }
  })

  return app
}
