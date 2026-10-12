/**
 * File Name: email.ts
 * Purpose: `smtp.email@1`: one operation, asserting the CAPABILITY before the
 *          socket is opened. A consumer passes the connection an operator
 *          chose and a message; it never sees the server, the port or the
 *          password - and never learns that this connection is SMTP rather
 *          than Resend, which is the point of the provider seam.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import { addressList } from './transport'
import { SMTP_CAPABILITIES, SMTP_PROVIDER, type SendEmailInput, type SendEmailResult, type SmtpEmailService } from './contract'

/** The one refusal a consumer sees when nothing usable is configured. */
export class SmtpConnectionMissing extends Error {
  constructor(readonly connectionId: string) {
    super(`No usable SMTP connection '${connectionId}'. Connect an SMTP server under Settings > Connections, or choose another connection.`)
    this.name = 'SmtpConnectionMissing'
  }
}

export function createEmailService(ctx: ExtensionServerCtx): SmtpEmailService {
  return {
    async send(input: SendEmailInput): Promise<SendEmailResult> {
      const conn = await ctx.connections?.get(SMTP_PROVIDER, {
        id: input.connectionId,
        capabilities: [SMTP_CAPABILITIES.emailSend],
      })
      if (!conn) throw new SmtpConnectionMissing(input.connectionId)

      // The refusals worth making before a socket is opened, in words an
      // operator can act on rather than an SMTP code.
      if (!addressList(input.to)) throw new Error('An email needs at least one recipient')
      if (!input.from?.trim()) throw new Error('An email needs a From address')
      if (!input.subject?.trim()) throw new Error('An email needs a subject')
      if (!input.text?.trim() && !input.html?.trim()) throw new Error('An email needs a body: text, HTML, or both')

      try {
        // The CONNECTOR sends: the server, the port and the password stay
        // with it, and this service never sees them. That is the invariant
        // the platform's `invoke` exists for.
        return await conn.invoke<SendEmailResult>('send', {
          from: input.from,
          to: input.to,
          subject: input.subject,
          ...(input.text ? { text: input.text } : {}),
          ...(input.html ? { html: input.html } : {}),
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
          ...(input.cc ? { cc: input.cc } : {}),
          ...(input.bcc ? { bcc: input.bcc } : {}),
        })
      } catch (e) {
        // The server's own words: "550 5.7.1 Relay access denied" tells an
        // operator exactly what to fix, and a paraphrase would not.
        throw new Error(`The SMTP server refused the message: ${(e as Error).message}`)
      }
    },
  }
}
