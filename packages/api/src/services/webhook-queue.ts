/**
 * File Name: webhook-queue.ts
 * Purpose: Instantiates and exports the BullMQ queue used to enqueue outgoing webhook delivery jobs
 *          with exponential back-off retry and automatic job cleanup.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: bullmq, REDIS_URL env var; consumed by webhook-dispatcher subscriber and webhook-worker
 */

import { queueOptions } from '../plugins/redis'
import { Queue } from 'bullmq'
import { WEBHOOK_QUEUE_NAME, WEBHOOK_ATTEMPTS } from '../workers/webhook-worker'
import type { WebhookJobData } from '../workers/webhook-worker'

export type { WebhookJobData }

let _queue: Queue<WebhookJobData> | null = null

/** Has the queue been constructed yet? Diagnostics and the import-side-effect test. */
export function isWebhookQueueConstructed(): boolean {
  return _queue !== null
}

/** The BullMQ webhook queue, constructed on first use - never at import (closure plan Phase 3, Unit 2). */
export function getWebhookQueue(): Queue<WebhookJobData> {
  if (_queue) return _queue
  _queue = new Queue<WebhookJobData>(WEBHOOK_QUEUE_NAME, {
    ...queueOptions(),
    defaultJobOptions: {
      attempts: WEBHOOK_ATTEMPTS,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  })
  return _queue
}

/** Closes the queue if one was constructed. */
export async function disposeWebhookQueue(): Promise<void> {
  const q = _queue
  _queue = null
  if (q) { try { await q.close() } catch { /* already closed */ } }
}
