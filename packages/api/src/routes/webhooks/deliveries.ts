/**
 * File Name: deliveries.ts
 * Purpose: Provides GET /api/v1/webhooks/:id/deliveries to list recent delivery attempts
 *          and POST .../deliveries/:deliveryId/replay to re-queue a failed delivery.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia route handler; replay enqueues a new job via webhookQueue
 *   (BullMQ); requires admin permission on the caller's JWT.
 */
import { randomBytes } from 'node:crypto'
import { Elysia } from 'elysia'
import { eq, and, desc } from 'drizzle-orm'
import { webhooks, webhookDeliveries } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { getWebhookQueue } from '../../services/webhook-queue'
import type { WebhookJobData } from '../../workers/webhook-worker'

function assertAdmin(permissions: any, memberId?: string | null): void {
  requireCapability({ permissions, memberId }, 'manage:webhooks')
}

// ─── Pure helper ──────────────────────────────────────────────────────────────

/**
 * Constructs the BullMQ job payload needed to replay a previous webhook delivery.
 * @param delivery - The original delivery record whose payload should be replayed.
 * @param hook - The webhook configuration (URL, secret, headers) to deliver to.
 * @param threshold - Maximum consecutive failures before the webhook is auto-paused.
 * @returns A WebhookJobData object ready to be enqueued.
 */
export function buildReplayJobData(
  delivery: typeof webhookDeliveries.$inferSelect,
  hook: typeof webhooks.$inferSelect,
  threshold: number,
): WebhookJobData {
  const deliveryId = `wd_${randomBytes(8).toString('hex')}`
  const originalPayload = delivery.payload as { data: Record<string, unknown> | null } | null
  return {
    deliveryId,
    webhookId: hook.id,
    workspaceId: hook.workspaceId,
    url: hook.url,
    secret: hook.secret ?? null,
    extraHeaders: typeof hook.headers === 'object' && hook.headers !== null
      ? (hook.headers as Record<string, string>)
      : {},
    threshold,
    event: delivery.event,
    typeName: delivery.typeName,
    objectId: delivery.objectId,
    objectData: originalPayload?.data ?? null,
    timestamp: new Date().toISOString(),
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * Registers the webhook deliveries list and replay routes on the given Elysia app.
 * @param app - The Elysia application instance to attach the routes to.
 * @returns The Elysia app with both delivery routes mounted.
 */
export const webhookDeliveryRoutes = (app: Elysia) =>
  app

    .get('/api/v1/webhooks/:id/deliveries', async (ctx: any) => {
      const { db, workspaceId, permissions, params } = ctx
      assertAdmin(permissions, ctx.memberId)

      const [hook] = await db
        .select({ id: webhooks.id })
        .from(webhooks)
        .where(
          and(
            eq(webhooks.id, params.id),
            eq(webhooks.workspaceId, workspaceId),
            ),
        )

      if (!hook) throw new RequestError('NOT_FOUND', 'Webhook not found', 404)

      const rows = await db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.webhookId, params.id))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(50)

      return { data: rows }
    })

    .post('/api/v1/webhooks/:webhookId/deliveries/:deliveryId/replay', async (ctx: any) => {
      const { db, workspaceId, permissions, params, set } = ctx
      assertAdmin(permissions, ctx.memberId)

      const [delivery] = await db
        .select()
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.id, params.deliveryId),
            eq(webhookDeliveries.workspaceId, workspaceId),
            ),
        )
        .limit(1)

      if (!delivery) throw new RequestError('NOT_FOUND', 'Delivery not found', 404)

      const [hook] = await db
        .select()
        .from(webhooks)
        .where(
          and(
            eq(webhooks.id, delivery.webhookId),
            eq(webhooks.workspaceId, workspaceId),
            ),
        )
        .limit(1)

      if (!hook) throw new RequestError('NOT_FOUND', 'Webhook not found', 404)

      const jobData = buildReplayJobData(delivery, hook, 10)

      await getWebhookQueue().add(jobData.deliveryId, jobData, { jobId: jobData.deliveryId })

      set.status = 202
      return { deliveryId: jobData.deliveryId }
    })
