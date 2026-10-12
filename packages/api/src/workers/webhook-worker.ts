/**
 * File Name: webhook-worker.ts
 * Purpose: Implements a BullMQ worker that delivers webhook payloads with HMAC signing,
 *          retry logic, and automatic endpoint auto-pause on consecutive failures.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires a running Redis instance for BullMQ; uses Node.js crypto
 *                     for HMAC signatures and the native fetch API for HTTP delivery.
 */
import { queueOptions } from '../plugins/redis'
import { resolvedFor } from '../config/state'
import { createHmac } from 'node:crypto'
import { Worker } from 'bullmq'
import { getLogger } from '@tangen/logging'
import { createExtensionHttp } from '../services/extension-http'

const logger = getLogger(['tangen', 'api', 'workers'])
import { eq } from 'drizzle-orm'
import { webhooks, webhookDeliveries } from '@tangen/db'
import type { DbClient } from '@tangen/db'

export const WEBHOOK_QUEUE_NAME = 'webhook-delivery'
export const WEBHOOK_ATTEMPTS = 5

/** Payload enqueued for each webhook delivery attempt, containing all data needed to send the request and record the result. */
export interface WebhookJobData {
  deliveryId: string
  webhookId: string
  workspaceId: string
  url: string
  secret: string | null
  extraHeaders: Record<string, string>
  threshold: number
  event: string
  typeName: string
  objectId: string
  objectData: Record<string, unknown> | null
  timestamp: string
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Computes an HMAC-SHA256 signature for a webhook payload.
 * @param secret - The webhook's shared secret used as the HMAC key.
 * @param body - The raw JSON request body to sign.
 * @returns A `sha256=<hex>` signature string suitable for the `X-Tangen-Signature` header.
 */
export function computeSignature(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

/**
 * Builds the HTTP request headers for a webhook delivery, including standard Tangen
 * headers and an optional HMAC signature when a secret is present.
 * @param params - The event name, delivery ID, optional secret, raw body, and any extra headers.
 * @returns A flat headers object ready to pass to fetch.
 */
export function buildDeliveryHeaders(params: {
  event: string
  deliveryId: string
  secret: string | null
  body: string
  extraHeaders: Record<string, string>
}): Record<string, string> {
  const { event, deliveryId, secret, body, extraHeaders } = params
  const headers: Record<string, string> = {
    ...extraHeaders,
    'Content-Type': 'application/json',
    'X-Tangen-Event': event,
    'X-Tangen-Delivery': deliveryId,
  }
  if (secret) {
    headers['X-Tangen-Signature'] = computeSignature(secret, body)
  }
  return headers
}

/**
 * Serializes the webhook event payload to a JSON string for the request body.
 * @param params - The delivery ID, event name, type name, object ID, object data, timestamp, and webhook ID.
 * @returns A JSON string conforming to the Tangen webhook event envelope format.
 */
export function buildDeliveryBody(params: {
  deliveryId: string
  event: string
  typeName: string
  objectId: string
  objectData: Record<string, unknown> | null
  timestamp: string
  webhookId: string
}): string {
  const { deliveryId, event, typeName, objectId, objectData, timestamp, webhookId } = params
  return JSON.stringify({
    id: deliveryId,
    event,
    typeName,
    objectId,
    data: objectData,
    timestamp,
    webhookId,
  })
}

// ─── Worker ───────────────────────────────────────────────────────────────────

/**
 * Creates and starts the BullMQ webhook delivery worker, which processes jobs from
 * the `webhook-delivery` queue and records outcomes in the database.
 * @param db - The Drizzle database client used to persist delivery records and update webhook state.
 * @returns The running BullMQ Worker instance.
 */
/**
 * Where a delivery goes, and whether that is this deployment or the open
 * internet.
 *
 * A RELATIVE `/path` resolves against this environment's own API URL on
 * purpose, so a webhook survives a domain migration without being re-typed.
 * That target is internal BY CONSTRUCTION - the operator did not aim it
 * inside, the resolver did - so it is sent directly.
 *
 * An absolute URL is whatever an operator typed, and goes through the guarded
 * client instead: any host is allowed (a webhook may legitimately point
 * anywhere) but a private or link-local address is refused and every redirect
 * hop is re-checked. Without that, `manage:webhooks` was a 4 KB read of any
 * address the server could reach, because the response body is stored and
 * served back through the deliveries API.
 */
export function deliveryTarget(url: string, base: string): { target: string; internal: boolean } {
  if (url.startsWith('/')) return { target: `${base.replace(/\/$/, '')}${url}`, internal: true }
  return { target: url, internal: false }
}

export function startWebhookWorker(db: DbClient): Worker<WebhookJobData> {
  const options = queueOptions()

  const worker = new Worker<WebhookJobData>(
    WEBHOOK_QUEUE_NAME,
    async (job) => {
      const d = job.data
      const body = buildDeliveryBody({
        deliveryId: d.deliveryId,
        event: d.event,
        typeName: d.typeName,
        objectId: d.objectId,
        objectData: d.objectData,
        timestamp: d.timestamp,
        webhookId: d.webhookId,
      })
      const headers = buildDeliveryHeaders({
        event: d.event,
        deliveryId: d.deliveryId,
        secret: d.secret,
        body,
        extraHeaders: d.extraHeaders,
      })

      const start = Date.now()
      let statusCode: number | null = null
      let responseBody: string | null = null
      let success = false
      let error: string | null = null

      try {
        // Relative /path targets resolve against this environment's own API
        // URL (server.url: SERVER_URL, or the
        // development default from the process port), through the resolver.
        const base = resolvedFor(d.workspaceId)?.get<string>('server.url') || `http://localhost:${process.env.PORT ?? 3000}`
        const { target, internal } = deliveryTarget(d.url, base)
        // An operator-typed URL goes through the guarded client - the same one
        // ctx.http uses - so a private address is refused and each redirect
        // hop is re-checked. `network:any` allows any HOST, which a webhook
        // needs, without implying network:private.
        const send = internal ? fetch : createExtensionHttp({
          extensionId: 'platform:webhooks', workspaceId: d.workspaceId, grants: ['network:any'],
        })
        const res = await send(target, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10_000),
        })
        statusCode = res.status
        responseBody = (await res.text()).slice(0, 4_000)
        success = res.ok
        if (!res.ok) error = `HTTP ${res.status}`
      } catch (e: any) {
        error = (e?.message ?? 'Request failed').slice(0, 500)
      }

      const durationMs = Date.now() - start
      const isLastAttempt = job.attemptsMade >= WEBHOOK_ATTEMPTS - 1

      if (success || isLastAttempt) {
        await db.insert(webhookDeliveries).values({
          id: d.deliveryId,
          webhookId: d.webhookId,
          workspaceId: d.workspaceId,
          event: d.event,
          typeName: d.typeName,
          objectId: d.objectId,
          payload: JSON.parse(body),
          statusCode,
          responseBody,
          durationMs,
          success,
          error,
        })

        if (success) {
          if ((await db.select({ cf: webhooks.consecutiveFailures }).from(webhooks).where(eq(webhooks.id, d.webhookId)).limit(1))[0]?.cf > 0) {
            await db.update(webhooks).set({ consecutiveFailures: 0, updatedAt: new Date() }).where(eq(webhooks.id, d.webhookId))
          }
        } else {
          const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, d.webhookId)).limit(1)
          if (hook) {
            const newCount = hook.consecutiveFailures + 1
            const shouldPause = d.threshold > 0 && newCount >= d.threshold
            await db.update(webhooks).set({
              consecutiveFailures: newCount,
              ...(shouldPause && {
                enabled: false,
                pausedReason: `Auto-paused after ${newCount} consecutive failure${newCount !== 1 ? 's' : ''}. Last error: ${error ?? `HTTP ${statusCode}`}`,
              }),
              updatedAt: new Date(),
            }).where(eq(webhooks.id, d.webhookId))
          }
        }
      }

      if (!success) {
        throw new Error(error ?? `HTTP ${statusCode}`)
      }
    },
    { ...options },
  )

  worker.on('error', (err) => {
    logger.error('Webhook worker error', err instanceof Error ? err : new Error(String(err)))
  })

  return worker
}
