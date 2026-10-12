/**
 * File Name: resend.ts
 * Purpose: Native Resend adapter — /emails HTTP API via plain fetch
 *          (replaces the SMTP relay).
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { MailAdapter, ResolvedMailMessage } from './types'
import { MailAdapterError, postJSON, toList } from './types'

/** Builds the Resend /emails payload — exported for tests. */
export function buildResendPayload(message: ResolvedMailMessage) {
  return {
    from: message.from,
    to: toList(message.to),
    subject: message.subject,
    ...(message.text ? { text: message.text } : {}),
    ...(message.html ? { html: message.html } : {}),
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
  }
}

export function createResendAdapter(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): MailAdapter {
  return {
    name: 'resend',
    async send(message) {
      if (!apiKey) throw new MailAdapterError('resend', 'apiKey is required')
      await postJSON(
        'resend',
        'https://api.resend.com/emails',
        { Authorization: `Bearer ${apiKey}` },
        buildResendPayload(message),
        fetchImpl,
      )
    },
  }
}
