/**
 * File Name: task-worker.ts
 * Purpose: BullMQ worker for the generic 'tangen-tasks' queue — executes
 *          defineTask handlers with the boot-configured task runtime.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Started only when REDIS_URL is set (enqueueTask runs
 *          inline otherwise, so a worker without redis would only add noise).
 */
import { queueOptions, redisState } from '../plugins/redis'
import { Worker } from 'bullmq'
import { getLogger } from '@tangen/logging'
import { TASK_QUEUE_NAME, executeTask, type TaskJobData } from '../services/task-queue'

const logger = getLogger(['tangen', 'api', 'tasks'])

/** Starts the task worker; returns it for graceful shutdown, or null when Redis is not bound. */
export function startTaskWorker(): Worker<TaskJobData> | null {
  if (redisState() !== 'enabled') return null

  const worker = new Worker<TaskJobData>(
    TASK_QUEUE_NAME,
    async (job) => { await executeTask({ ...job.data, attempt: (job.attemptsMade ?? 0) + 1 }) },
    {
      ...queueOptions(),
    },
  )
  worker.on('failed', (job, err) => {
    logger.warn(`task "${job?.data.taskId}" failed (attempt ${job?.attemptsMade}): ${err.message}`)
  })
  return worker
}
