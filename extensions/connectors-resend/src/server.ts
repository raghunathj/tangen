/**
 * File Name: server.ts
 * Purpose: What the Resend pack contributes: one connector, one typed service,
 *          one Flow action and one form destination. Three ways to send an
 *          email - code through the service, no-code through a flow, and a
 *          form's destination - all through the same capability check, and
 *          none of them holding the key.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { defineExtensionServer } from '@tangen/cms'
import { RESEND_CAPABILITIES, RESEND_EMAIL_SERVICE, RESEND_PROVIDER } from './contract'
import { resendConnector, RESEND_BRAND } from './connector'
import { createEmailService } from './email'

/** A flow's config value as the builder stores it: an id, or nothing yet. */
const id = (config: Record<string, unknown>, key: string): string => {
  const v = config[key]
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`This step needs '${key}' to be chosen`)
  return v.trim()
}

const text = (config: Record<string, unknown>, key: string): string =>
  typeof config[key] === 'string' ? (config[key] as string) : ''

/**
 * A From address from the two fields an operator filled: a name they typed
 * and a domain they PICKED. Building it here is what makes the domain a
 * resource rather than a string - an unverified domain is not in the list.
 */
export function fromAddress(config: Record<string, unknown>): string {
  const domain = text(config, 'domain').trim()
  const mailbox = (text(config, 'fromMailbox').trim() || 'noreply').replace(/[<>@\s]/g, '')
  const name = text(config, 'fromName').trim()
  const address = domain.includes('@') ? domain : `${mailbox}@${domain}`
  return name ? `${name} <${address}>` : address
}

export default defineExtensionServer({
  contributions: {
    'connectors@1': [resendConnector],

    'flow.actions@1': [
      {
        name: 'resend_send_email',
        label: 'Send an email (Resend)',
        description: 'Sends one email through a Resend connection, from a domain the account has verified.',
        configFields: [
          { key: 'connection', label: 'Resend account', kind: 'connection', connector: RESEND_PROVIDER, capabilities: [RESEND_CAPABILITIES.emailSend] },
          { key: 'domain', label: 'Sending domain', kind: 'resource', connector: RESEND_PROVIDER, resource: 'domain', dependsOn: 'connection' },
          { key: 'fromMailbox', label: 'From mailbox (before the @)', kind: 'text' },
          { key: 'fromName', label: 'From name', kind: 'text' },
          { key: 'to', label: 'To ({{tokens}} allowed, comma separated)', kind: 'text' },
          { key: 'subject', label: 'Subject ({{tokens}} allowed)', kind: 'text' },
          { key: 'body', label: 'Message ({{tokens}} allowed)', kind: 'text' },
          { key: 'replyTo', label: 'Reply-To (optional)', kind: 'text' },
        ],
        output: [
          { key: 'id', label: 'Message id', type: 'string' },
        ],
        handler: async (config, ctx) => createEmailService(ctx).send({
          connectionId: id(config, 'connection'),
          from: fromAddress(config),
          to: text(config, 'to').split(',').map((a) => a.trim()).filter(Boolean),
          subject: text(config, 'subject'),
          text: text(config, 'body'),
          ...(text(config, 'replyTo').trim() ? { replyTo: text(config, 'replyTo').trim() } : {}),
        }),
      },
    ],

    /**
     * The same send, offered where the work starts. Flows owns the graph from
     * the moment it is created: a preset contributes a shape and nothing else.
     */
    'flow.presets@1': [
      {
        id: 'resend.email.form-submissions',
        label: 'Email submissions to someone',
        description: 'Sends an email for every submission of this form. Choose the Resend account, the sending domain and who hears about it.',
        icon: 'IconMail',
        brand: { ...RESEND_BRAND },
        appliesTo: { trigger: 'form.submitted', scope: 'form' },
        configFields: [
          { key: 'connection', label: 'Resend account', kind: 'connection', connector: RESEND_PROVIDER, capabilities: [RESEND_CAPABILITIES.emailSend] },
          { key: 'domain', label: 'Sending domain', kind: 'resource', connector: RESEND_PROVIDER, resource: 'domain', dependsOn: 'connection' },
          { key: 'to', label: 'Send to', kind: 'text' },
          { key: 'subject', label: 'Subject', kind: 'text' },
        ],
        build: ({ config, scope }) => ({
          name: 'Form submissions by email',
          nodes: [
            { id: 'trigger_1', kind: 'trigger', position: { x: 0, y: 0 }, data: { type: 'form.submitted' } },
            // One form, not every form.
            { id: 'this_form', kind: 'condition', position: { x: 0, y: 140 }, data: { conditions: [{ path: 'trigger.payload.formId', op: 'eq', value: scope.id }] } },
            {
              id: 'send_1', kind: 'action', position: { x: 0, y: 280 },
              data: {
                action: 'resend_send_email',
                config: {
                  ...config,
                  // A destination added with only a recipient still sends
                  // something worth reading.
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

  /**
   * A FACTORY, so the service is built with the calling extension's execution
   * and this pack's own ctx: the caller never borrows the pack's authority,
   * and the pack never borrows the caller's.
   */
  onStart: async (ctx) => {
    ctx.services?.provide(RESEND_EMAIL_SERVICE, () => createEmailService(ctx))
  },
})
