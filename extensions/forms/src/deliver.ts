/**
 * File Name: deliver.ts
 * Purpose: What the three Forms tasks do: render and send a notification mail
 *          through the workspace mailer (`ctx.tangen.sendMail`), post a
 *          webhook, run a queued lifecycle hook with a client that carries
 *          the extension's authority. Failures throw so the durable queue
 *          retries by its own rules.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import type { FormHookSet, FormRecord } from './contract'
import type { FormNotificationJobData, FormHookJobData, FormWebhookJobData } from './jobs'

/** Replaces {key} placeholders with values from data; unknown keys stay visible so a typo surfaces in the mail. */
export function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = data[key]
    return val != null ? String(val) : `{${key}}`
  })
}

function buildAutoBody(formName: string, submissionId: string, data: Record<string, unknown>): string {
  const rows = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n')
  return `New submission for "${formName}"\nID: ${submissionId}\n\n${rows}`
}

function buildAutoHtml(formName: string, submissionId: string, data: Record<string, unknown>): string {
  const rows = Object.entries(data)
    .map(([k, v]) => `<tr><td style="padding:4px 8px;font-weight:600;color:#374151">${k}</td><td style="padding:4px 8px;color:#111827">${v}</td></tr>`)
    .join('')
  return `<h2 style="font-family:sans-serif;color:#111827">New submission: ${formName}</h2>
<p style="font-family:sans-serif;color:#6b7280;font-size:12px">ID: ${submissionId}</p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">${rows}</table>`
}

/** A notification's body parts: 'text' sends plain text only; 'html' (default) text plus a styled HTML part. */
export function renderNotificationBody(
  notification: { body?: string; format?: 'html' | 'text' },
  formName: string,
  submissionId: string,
  data: Record<string, unknown>,
): { text: string; html?: string } {
  const text = notification.body ? interpolate(notification.body, data) : buildAutoBody(formName, submissionId, data)
  if (notification.format === 'text') return { text }
  const html = notification.body
    ? `<pre style="font-family:sans-serif;white-space:pre-wrap">${interpolate(notification.body, data)}</pre>`
    : buildAutoHtml(formName, submissionId, data)
  return { text, html }
}

export async function deliverFormWebhook(job: FormWebhookJobData, fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): Promise<void> {
  // E.8: delivery goes through the extension's ctx.http (network:any, named in the manifest); no bare fetch.
  if (!fetchImpl) throw new Error('Form webhook delivery needs the network:any grant (ctx.http)')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(job.webhook.headers ?? {}),
    ...(job.webhook.secret ? { 'X-Tangen-Secret': job.webhook.secret } : {}),
  }
  const res = await fetchImpl(job.webhook.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      formId: job.formId, formSlug: job.formSlug, formName: job.formName,
      submissionId: job.submissionId, data: job.data, submittedAt: job.submittedAt,
    }),
  })
  if (!res.ok) throw new Error(`Webhook delivery failed: ${res.status} ${job.webhook.url}`)
}

/** Sends the notification mail, then fires afterMailSent once a delivery attempt succeeded. */
export async function runNotificationJob(job: FormNotificationJobData, ctx: ExtensionServerCtx, hooks: Partial<FormHookSet> | undefined): Promise<void> {
  const { formId, formName, submissionId, data, notification, fromEmail, fromName } = job
  const subject = notification.subject ? interpolate(notification.subject, data) : `New form submission: ${formName}`
  const body = renderNotificationBody(notification, formName, submissionId, data)
  if (!ctx.tangen) throw new Error('forms: the mail client is not available in this context')
  await ctx.tangen.sendMail({
    to: notification.to,
    ...(notification.replyTo ? { replyTo: notification.replyTo } : {}),
    ...(fromEmail ? { from: fromName ? `${fromName} <${fromEmail}>` : fromEmail } : {}),
    subject,
    text: body.text,
    ...(body.html ? { html: body.html } : {}),
  })
  if (job.formSlug && typeof hooks?.afterMailSent === 'function') {
    await Promise.resolve(hooks.afterMailSent(
      { id: submissionId, data },
      { id: formId, slug: job.formSlug, name: formName, workspaceId: job.workspaceId } as unknown as FormRecord,
      { workspaceId: job.workspaceId, ipAddress: job.ipAddress ?? '' },
    )).catch(() => { /* afterMailSent failures never fail the mail job */ })
  }
}

/** Runs a queued lifecycle hook with the extension's client in context (the task runs as the extension). */
export async function runHookJob(job: FormHookJobData, ctx: ExtensionServerCtx, hooks: Partial<FormHookSet> | undefined): Promise<void> {
  const fn = hooks?.[job.hookName]
  if (typeof fn !== 'function') return // hook removed since enqueue - nothing to do
  await fn(
    { id: job.submissionId, data: job.data },
    { id: job.formId, slug: job.formSlug, name: job.formName, workspaceId: job.workspaceId } as unknown as FormRecord,
    { workspaceId: job.workspaceId, ipAddress: job.ipAddress, tangen: ctx.tangen } as never,
  )
}
