/**
 * File Name: server.ts
 * Purpose: What the SMTP pack contributes: one connector, one typed service,
 *          one Flow action and one form destination - the same three surfaces
 *          the Resend pack offers, so an operator's choice of provider is a
 *          choice of CONNECTION and nothing else changes.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { defineExtensionServer } from '@tangen/cms'
import { SMTP_CAPABILITIES, SMTP_EMAIL_SERVICE, SMTP_PROVIDER } from './contract'
import { smtpConnector, SMTP_BRAND } from './connector'
import { createEmailService } from './email'

/** A flow's config value as the builder stores it: an id, or nothing yet. */
const id = (config: Record<string, unknown>, key: string): string => {
  const v = config[key]
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`This step needs '${key}' to be chosen`)
  return v.trim()
}

const text = (config: Record<string, unknown>, key: string): string =>
  typeof config[key] === 'string' ? (config[key] as string) : ''

export default defineExtensionServer({
  contributions: {
    'connectors@1': [smtpConnector],

    'flow.actions@1': [
      {
        name: 'smtp_send_email',
        label: 'Send an email (SMTP)',
        description: 'Sends one email through an SMTP connection. The server decides what From addresses it will accept.',
        configFields: [
          { key: 'connection', label: 'SMTP server', kind: 'connection', connector: SMTP_PROVIDER, capabilities: [SMTP_CAPABILITIES.emailSend] },
          { key: 'from', label: 'From ({{tokens}} allowed)', kind: 'text' },
          { key: 'to', label: 'To ({{tokens}} allowed, comma separated)', kind: 'text' },
          { key: 'subject', label: 'Subject ({{tokens}} allowed)', kind: 'text' },
          { key: 'body', label: 'Message ({{tokens}} allowed)', kind: 'text' },
          { key: 'replyTo', label: 'Reply-To (optional)', kind: 'text' },
        ],
        output: [
          { key: 'id', label: 'Message id', type: 'string' },
          { key: 'accepted', label: 'Accepted recipients', type: 'json' },
        ],
        handler: async (config, ctx) => createEmailService(ctx).send({
          connectionId: id(config, 'connection'),
          from: text(config, 'from'),
          to: text(config, 'to'),
          subject: text(config, 'subject'),
          text: text(config, 'body'),
          ...(text(config, 'replyTo').trim() ? { replyTo: text(config, 'replyTo').trim() } : {}),
        }),
      },
    ],

    'flow.presets@1': [
      {
        id: 'smtp.email.form-submissions',
        label: 'Email submissions through your SMTP server',
        description: 'Sends an email for every submission of this form, through a server you connected.',
        icon: 'IconMail',
        brand: { ...SMTP_BRAND },
        appliesTo: { trigger: 'form.submitted', scope: 'form' },
        configFields: [
          { key: 'connection', label: 'SMTP server', kind: 'connection', connector: SMTP_PROVIDER, capabilities: [SMTP_CAPABILITIES.emailSend] },
          { key: 'from', label: 'From', kind: 'text' },
          { key: 'to', label: 'Send to', kind: 'text' },
          { key: 'subject', label: 'Subject', kind: 'text' },
        ],
        build: ({ config, scope }) => ({
          name: 'Form submissions by email',
          nodes: [
            { id: 'trigger_1', kind: 'trigger', position: { x: 0, y: 0 }, data: { type: 'form.submitted' } },
            { id: 'this_form', kind: 'condition', position: { x: 0, y: 140 }, data: { conditions: [{ path: 'trigger.payload.formId', op: 'eq', value: scope.id }] } },
            {
              id: 'send_1', kind: 'action', position: { x: 0, y: 280 },
              data: {
                action: 'smtp_send_email',
                config: {
                  ...config,
                  subject: String(config.subject ?? '').trim() || 'A new submission for {{trigger.submission.formSlug}}',
                  body: '{{trigger.submission.summary}}',
                },
              },
            },
          ],
          edges: [
            { id: 'edge_1', from: 'trigger_1', to: 'this_form' },
            { id: 'edge_2', from: 'this_form', to: 'send_1', outlet: 'yes' },
          ],
        }),
      },
    ],
  },

  onStart: async (ctx) => {
    ctx.services?.provide(SMTP_EMAIL_SERVICE, () => createEmailService(ctx))
  },
})
