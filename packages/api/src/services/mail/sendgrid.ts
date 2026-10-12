/**
 * File Name: sendgrid.ts
 * Purpose: Native SendGrid adapter — v3 Mail Send HTTP API via plain fetch
 *          (replaces the SMTP relay: real error bodies, no SMTP egress).
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { MailAdapter, ResolvedMailMessage } from './types'
import { MailAdapterError, postJSON, toList } from './types'

/** Splits "Name <addr>" into SendGrid's { email, name } shape. */
export function parseAddress(from: string): { email: string; name?: string } {
  const m = /^(.*)<([^>]+)>\s*$/.exec(from)
  if (m) {
    const name = m[1].trim()
    return { email: m[2].trim(), ...(name ? { name } : {}) }
  }
  return { email: from.trim() }
}

/** Builds the v3 Mail Send payload — exported for tests. */
export function buildSendgridPayload(message: ResolvedMailMessage) {
  return {
    personalizations: [{ to: toList(message.to).map((email) => ({ email })) }],
    from: parseAddress(message.from),
    ...(message.replyTo ? { reply_to: parseAddress(message.replyTo) } : {}),
    subject: message.subject,
    content: [
      ...(message.text ? [{ type: 'text/plain', value: message.text }] : []),
      ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
    ],
  }
}

export function createSendgridAdapter(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): MailAdapter {
  return {
    name: 'sendgrid',
    async send(message) {
      if (!apiKey) throw new MailAdapterError('sendgrid', 'apiKey is required')
      if (!message.text && !message.html) {
        throw new MailAdapterError('sendgrid', 'message needs text or html')
      }
      await postJSON(
        'sendgrid',
        'https://api.sendgrid.com/v3/mail/send',
        { Authorization: `Bearer ${apiKey}` },
        buildSendgridPayload(message),
        fetchImpl,
      )
    },
  }
}
