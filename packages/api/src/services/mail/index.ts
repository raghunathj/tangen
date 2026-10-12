/**
 * File Name: index.ts
 * Purpose: Mail adapter registry — resolves a MailConfig to its delivery
 *          adapter. A custom adapter instance on the config wins; built-ins:
 *          smtp (nodemailer), sendgrid + resend (native HTTP).
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { MailConfig } from '@tangen/types'
import type { MailAdapter } from './types'
import { createSmtpAdapter, buildSmtpTransporter, type SmtpSettings } from './smtp'
import { createSendgridAdapter } from './sendgrid'
import { createResendAdapter } from './resend'

export type { MailAdapter, ResolvedMailMessage } from './types'
export { MailAdapterError } from './types'

/**
 * The adapter for a mail config (a custom instance passes through).
 * `settings` is the workspace × environment's resolved mail slice
 * (service-settings.ts): SMTP host, port and credentials, and the SendGrid
 * or Resend key as MATERIAL. `config.apiKey` names the variable that holds
 * the key (plan-config-resolver); the material comes from settings only.
 */
export function getMailAdapter(config: MailConfig, settings?: { smtp?: SmtpSettings; apiKey?: string }): MailAdapter {
  const custom = (config as { adapter?: MailAdapter }).adapter
  if (custom && typeof custom === 'object') return custom

  switch (config.service) {
    case 'smtp':
    case undefined as never:
      return createSmtpAdapter(buildSmtpTransporter(settings?.smtp))
    case 'sendgrid':
      return createSendgridAdapter(settings?.apiKey)
    case 'resend':
      return createResendAdapter(settings?.apiKey)
    default:
      throw new Error(`Unknown mail service: ${config.service} (built-ins: smtp, sendgrid, resend)`)
  }
}
