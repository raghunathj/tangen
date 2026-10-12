/**
 * File Name: mailer.ts
 * Purpose: The workspace mail service — one transport layer shared by form
 *          notifications and ctx.tangen.sendMail. Supports SMTP (env-driven),
 *          SendGrid, and Resend via nodemailer.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Extracted from workers/form-worker.ts so site code can
 *          send mail without the forms extension. The transporter is
 *          injectable for tests.
 */
import nodemailer, { type Transporter } from 'nodemailer'
import type { MailConfig, SendMailMessage } from '@tangen/types'
import { getMailAdapter, type MailAdapter } from './mail'
import { mailSettingsFor, type MailSettings } from '../config/service-settings'

/**
 * @deprecated Delivery moved to the mail adapters (services/mail) — smtp via
 * nodemailer, sendgrid/resend via their native HTTP APIs. Kept one cycle for
 * external callers; sendMail() no longer uses it.
 */
export function buildTransporter(config: { service?: string }, settings: MailSettings = mailSettingsFor(undefined, undefined)): Transporter {
  const service = config.service ?? 'smtp'
  if (service === 'smtp') {
    return nodemailer.createTransport({
      host: settings.smtp.host,
      port: settings.smtp.port,
      secure: false,
      auth: settings.smtp.user ? { user: settings.smtp.user, pass: settings.smtp.pass } : undefined,
    })
  }
  if (service === 'sendgrid') {
    return nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: { user: 'apikey', pass: settings.apiKey },
    })
  }
  if (service === 'resend') {
    return nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: settings.apiKey },
    })
  }
  throw new Error(`Unknown mail service: ${service}`)
}

/**
 * Replaces {key} placeholders in a template string with values from data.
 * Unknown keys are left as-is so typos surface visibly in the delivered mail.
 */
export function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = data[key]
    return val != null ? String(val) : `{${key}}`
  })
}

function buildAutoBody(formName: string, submissionId: string, data: Record<string, unknown>): string {
  const rows = Object.entries(data)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
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

/**
 * Renders a form notification's body parts. 'text' format sends plain text
 * only; 'html' (default) sends text + a styled HTML part.
 */
export function renderNotificationBody(
  notification: { body?: string; format?: 'html' | 'text' },
  formName: string,
  submissionId: string,
  data: Record<string, unknown>,
): { text: string; html?: string } {
  const text = notification.body
    ? interpolate(notification.body, data)
    : buildAutoBody(formName, submissionId, data)
  if (notification.format === 'text') return { text }
  const html = notification.body
    ? `<pre style="font-family:sans-serif;white-space:pre-wrap">${interpolate(notification.body, data)}</pre>`
    : buildAutoHtml(formName, submissionId, data)
  return { text, html }
}

/** Default from header for a config (SMTP_FROM env → noreply fallback). */
export function resolveFrom(config: Partial<MailConfig>, settings?: MailSettings): string {
  const email = config.fromEmail ?? settings?.fromEmail
  if (email) return `${config.fromName ?? settings?.fromName ?? ''} <${email}>`.trim()
  return 'noreply@localhost'
}

/**
 * Sends one email through the workspace mail config — resolves the sender,
 * then delegates to the config's delivery adapter (custom instance > service
 * name; smtp via nodemailer, sendgrid/resend via their native HTTP APIs).
 * The adapter is injectable so tests never open sockets.
 */
export async function sendMail(
  config: Partial<MailConfig> & { workspaceId?: string},
  message: SendMailMessage,
  adapter?: MailAdapter,
): Promise<void> {
  const settings = mailSettingsFor(config.workspaceId, config as MailConfig)
  await (adapter ?? getMailAdapter({ ...config, service: (config.service ?? settings.service ?? 'smtp') as MailConfig['service'] }, settings)).send({ ...message, from: message.from ?? resolveFrom(config, settings) })
}
