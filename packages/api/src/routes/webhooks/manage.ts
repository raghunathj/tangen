/**
 * File Name: manage.ts
 * Purpose: CRUD routes for webhooks — GET /api/v1/webhooks, GET /api/v1/webhooks/:id,
 *          POST, PATCH, and DELETE — restricted to admin-authenticated members.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia route handler; re-enabling a webhook (enabled: true) also
 *   clears the consecutiveFailures counter and pausedReason set by the auto-pause logic.
 */
import { Elysia } from 'elysia'
import { randomBytes, randomUUID } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { webhooks } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { webhookTriggerCatalog } from '../../services/webhook-trigger-catalog'
import { wakeCapability } from '../../runtime/process'
import { extensionWiringDeps } from '../../services/extension-server'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebhookPayload {
  label: string
  url: string
  events: string[]
  typeNames: string[]
  secret?: string
  enabled: boolean
}

export interface WebhookUpdatePayload {
  label?: string
  url?: string
  events?: string[]
  typeNames?: string[]
  secret?: string
  enabled?: boolean
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Validates and extracts required fields from a webhook create request body.
 * @param body - Raw request body expected to contain label, url, events, typeNames, secret, and enabled.
 * @returns A validated WebhookPayload ready for insertion.
 */
export function buildWebhookPayload(body: unknown): WebhookPayload {
  const b = body as Record<string, unknown>

  const label = (b?.label as string | undefined)?.trim()
  if (!label) throw new RequestError('VALIDATION_ERROR', 'label is required', 422)

  const url = (b?.url as string | undefined)?.trim()
  if (!url) throw new RequestError('VALIDATION_ERROR', 'url is required', 422)

  // Absolute URLs, or a relative /path resolved against the environment's own
  // server URL at delivery time — survives domain migrations without editing
  // every webhook.
  if (!url.startsWith('/')) {
    try { new URL(url) } catch {
      throw new RequestError('VALIDATION_ERROR', 'url must be a valid URL or a relative /path', 422)
    }
  }

  const events = b?.events ?? []
  if (!Array.isArray(events)) throw new RequestError('VALIDATION_ERROR', 'events must be an array', 422)

  const typeNames = b?.typeNames ?? []
  if (!Array.isArray(typeNames)) throw new RequestError('VALIDATION_ERROR', 'typeNames must be an array', 422)

  const secret = (b?.secret as string | undefined)?.trim() || undefined
  const enabled = typeof b?.enabled === 'boolean' ? b.enabled : true

  return { label, url, events: events as string[], typeNames: typeNames as string[], secret, enabled }
}

/**
 * Extracts and validates only the fields present in a webhook PATCH request body.
 * @param body - Raw request body containing a partial set of webhook fields to update.
 * @returns A sparse WebhookUpdatePayload containing only the fields the caller supplied.
 */
export function buildWebhookUpdatePayload(body: unknown): WebhookUpdatePayload {
  const b = body as Record<string, unknown>
  const result: WebhookUpdatePayload = {}

  if ('label' in b && b.label !== undefined) {
    result.label = (b.label as string).trim()
  }
  if ('url' in b && b.url !== undefined) {
    const url = (b.url as string).trim()
    try { new URL(url) } catch {
      throw new RequestError('VALIDATION_ERROR', 'url must be a valid URL', 422)
    }
    result.url = url
  }
  if ('events' in b && b.events !== undefined) {
    if (!Array.isArray(b.events)) throw new RequestError('VALIDATION_ERROR', 'events must be an array', 422)
    result.events = b.events as string[]
  }
  if ('typeNames' in b && b.typeNames !== undefined) {
    if (!Array.isArray(b.typeNames)) throw new RequestError('VALIDATION_ERROR', 'typeNames must be an array', 422)
    result.typeNames = b.typeNames as string[]
  }
  if ('secret' in b && b.secret !== undefined) {
    result.secret = (b.secret as string).trim() || undefined
  }
  if ('enabled' in b && typeof b.enabled === 'boolean') {
    result.enabled = b.enabled
  }

  return result
}

function assertAdmin(permissions: any, memberId?: string | null): void {
  requireCapability({ permissions, memberId }, 'manage:webhooks')
}

function serializeWebhook(w: any) {
  return {
    id: w.id,
    workspaceId: w.workspaceId,
    label: w.label,
    url: w.url,
    events: w.events,
    typeNames: w.typeNames ?? [],
    enabled: w.enabled,
    headers: w.headers,
    consecutiveFailures: w.consecutiveFailures ?? 0,
    pausedReason: w.pausedReason ?? null,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * Registers all webhook CRUD routes (list, get, create, update, delete) on the given Elysia app.
 * @param app - The Elysia application instance to attach the routes to.
 * @returns The Elysia app with all webhook management routes mounted.
 */
export const webhookRoutes = (app: Elysia) =>
  app

    .get('/api/v1/webhooks', async (ctx: any) => {
      const { db, workspaceId, permissions } = ctx
      assertAdmin(permissions, ctx.memberId)

      const rows = await db
        .select()
        .from(webhooks)
        .where(and(eq(webhooks.workspaceId, workspaceId)))

      return { data: rows.map(serializeWebhook) }
    })

    // Trigger catalog for the picker: built-in object.* events + custom triggers
    // (site config.webhookTriggers + installed extensions), each with a
    // contributor + custom flag for the "Custom" badge.
    .get('/api/v1/webhooks/triggers', async (ctx: any) => {
      const { workspaceId, permissions } = ctx
      assertAdmin(permissions, ctx.memberId)
      const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === workspaceId)
      // Only the triggers of extensions active in this environment (Phase 4).
      const deps = extensionWiringDeps()
      const active = deps?.activeIds ? new Set(await deps.activeIds(workspaceId)) : undefined
      return { data: webhookTriggerCatalog(project, active) }
    })

    .get('/api/v1/webhooks/:id', async (ctx: any) => {
      const { db, workspaceId, permissions, params } = ctx
      assertAdmin(permissions, ctx.memberId)

      const [row] = await db
        .select()
        .from(webhooks)
        .where(and(eq(webhooks.id, params.id), eq(webhooks.workspaceId, workspaceId)))

      if (!row) throw new RequestError('NOT_FOUND', 'Webhook not found', 404)
      return serializeWebhook(row)
    })

    .post('/api/v1/webhooks', async (ctx: any) => {
      const { body, db, eventBus, workspaceId, memberId, permissions, set } = ctx
      assertAdmin(permissions, ctx.memberId)

      const payload = buildWebhookPayload(body)
      const id = `wh_${randomBytes(8).toString('hex')}`

      // Demand is about to exist: a process whose worker was idle wakes it now.
      void wakeCapability('webhooks').catch(() => {})
      await db.insert(webhooks).values({
        id,
        workspaceId,
        label: payload.label,
        url: payload.url,
        events: payload.events,
        typeNames: payload.typeNames,
        secret: payload.secret ?? null,
        enabled: payload.enabled,
        headers: {},
      })

      set.status = 201
      const [row] = await db.select().from(webhooks).where(eq(webhooks.id, id))

      eventBus.emit({
        id: randomUUID(), type: 'webhook.created', workspaceId, timestamp: new Date().toISOString(),
        actorId: memberId ?? null,
        actorType: memberId ? 'member' : null,
        source: 'admin',
        payload: { webhookId: id, label: payload.label },
      })

      return serializeWebhook(row)
    })

    .patch('/api/v1/webhooks/:id', async (ctx: any) => {
      const { body, db, eventBus, workspaceId, memberId, permissions, params } = ctx
      assertAdmin(permissions, ctx.memberId)

      const patch = buildWebhookUpdatePayload(body)

      // Re-enabling clears auto-pause state
      const extra = patch.enabled === true
        ? { consecutiveFailures: 0, pausedReason: null }
        : {}

      await db
        .update(webhooks)
        .set({ ...patch, ...extra, updatedAt: new Date() })
        .where(and(eq(webhooks.id, params.id), eq(webhooks.workspaceId, workspaceId)))

      const [row] = await db.select().from(webhooks).where(eq(webhooks.id, params.id))
      if (!row) throw new RequestError('NOT_FOUND', 'Webhook not found', 404)

      eventBus.emit({
        id: randomUUID(), type: 'webhook.updated', workspaceId, timestamp: new Date().toISOString(),
        actorId: memberId ?? null,
        actorType: memberId ? 'member' : null,
        source: 'admin',
        payload: { webhookId: params.id, label: row.label },
      })

      return serializeWebhook(row)
    })

    .delete('/api/v1/webhooks/:id', async (ctx: any) => {
      const { db, eventBus, workspaceId, memberId, permissions, params, set } = ctx
      assertAdmin(permissions, ctx.memberId)

      await db
        .delete(webhooks)
        .where(and(eq(webhooks.id, params.id), eq(webhooks.workspaceId, workspaceId)))

      eventBus.emit({
        id: randomUUID(), type: 'webhook.deleted', workspaceId, timestamp: new Date().toISOString(),
        actorId: memberId ?? null,
        actorType: memberId ? 'member' : null,
        source: 'admin',
        payload: { webhookId: params.id },
      })

      set.status = 204
      return null
    })
