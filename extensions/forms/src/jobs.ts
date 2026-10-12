/**
 * File Name: jobs.ts
 * Purpose: The after-work a submission queues: a notification mail, a
 *          webhook delivery, a lifecycle hook. Three durable-queue tasks of
 *          the extension (`ext:forms:notify|webhook|hook`), redis-optional
 *          like every extension task; the BullMQ worker Forms ran in core is
 *          gone with the move (tasks/plan-core-slimming.md S3).
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { FormNotification, FormWebhook } from './contract'

/**
 * Payload carried by each form-notification task.
 */
export interface FormNotificationJobData {
  kind?: 'email'
  formId: string
  formName: string
  workspaceId: string
  submissionId: string
  data: Record<string, unknown>
  notification: FormNotification
  fromEmail?: string
  fromName?: string
  /** Present on jobs enqueued by the v2 pipeline — lets the worker fire afterMailSent. */
  formSlug?: string
  ipAddress?: string
}

/**
 * A queued lifecycle-hook execution — hook functions live in-process (workspace
 * config / forms behavior registry); the job carries only the lookup keys.
 */
export interface FormHookJobData {
  kind: 'hook'
  hookName: 'afterSubmit'
  formId: string
  formSlug: string
  formName: string
  workspaceId: string
  submissionId: string
  data: Record<string, unknown>
  ipAddress: string
}

/**
 * A queued webhook delivery for an accepted submission.
 */
export interface FormWebhookJobData {
  kind: 'webhook'
  formId: string
  formSlug: string
  formName: string
  workspaceId: string
  submissionId: string
  data: Record<string, unknown>
  submittedAt: string
  webhook: FormWebhook
}

export type FormJobData = FormNotificationJobData | FormHookJobData | FormWebhookJobData

/** The extension task each job kind runs on. */
export const FORM_TASKS = { email: 'notify', hook: 'hook', webhook: 'webhook' } as const
export type FormTaskName = typeof FORM_TASKS[keyof typeof FORM_TASKS]
export function taskFor(job: FormJobData): FormTaskName { return FORM_TASKS[job.kind ?? 'email'] }

/**
 * This extension's id, as the platform registers its tasks under.
 * `services/extension-server.ts` registers each task as
 * `ext:<extensionId>:<task.name>`, and `registerExtensionTask` refuses a bare
 * id outright.
 */
export const FORMS_EXTENSION_ID = 'forms'

/**
 * The id a job must be ENQUEUED under - namespaced, because registration is.
 *
 * `ctx.enqueue` does not namespace for you: its contract is "'ext:<id>:<name>'
 * or app ids", and a bare id reaches no handler. `executeTask` does not throw
 * on an unknown id either - it warns and returns - so a bare enqueue loses the
 * job in silence while the submission still succeeds.
 */
export function queueIdFor(job: FormJobData): string {
  return `ext:${FORMS_EXTENSION_ID}:${taskFor(job)}`
}
