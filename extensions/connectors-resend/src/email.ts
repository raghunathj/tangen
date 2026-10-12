/**
 * File Name: email.ts
 * Purpose: `resend.email@1`: the two operations another extension needs, each
 *          asserting the CAPABILITY it requires before Resend is called. A
 *          consumer passes the connection an operator chose and a message; it
 *          never sees the key, a Resend URL or the auth model.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import { readResend, RESEND_API } from './connector'
import {
  RESEND_CAPABILITIES, RESEND_PROVIDER,
  type ListDomainsInput, type ResendDomain, type ResendEmailService, type SendEmailInput, type SendEmailResult,
} from './contract'

/** The one refusal a consumer sees when nothing usable is configured. */
export class ResendConnectionMissing extends Error {
  constructor(readonly connectionId: string) {
    super(`No usable Resend connection '${connectionId}'. Connect Resend under Settings > Connections, or choose another connection.`)
    this.name = 'ResendConnectionMissing'
  }
}

/** An authed client over the connection an operator chose, or a refusal that says what to do. */
async function open(ctx: ExtensionServerCtx, connectionId: string, capabilities: string[]) {
  const conn = await ctx.connections?.get(RESEND_PROVIDER, { id: connectionId, capabilities })
  if (!conn) throw new ResendConnectionMissing(connectionId)
  return conn
}

/** One address or several, as Resend's API wants them. */
const list = (v: string | string[] | undefined): string[] | undefined => {
  if (v === undefined) return undefined
  const out = (Array.isArray(v) ? v : [v]).map((a) => a.trim()).filter((a) => a !== '')
  return out.length > 0 ? out : undefined
}

export function createEmailService(ctx: ExtensionServerCtx): ResendEmailService {
  return {
    async send(input: SendEmailInput): Promise<SendEmailResult> {
      const conn = await open(ctx, input.connectionId, [RESEND_CAPABILITIES.emailSend])
      // The refusals a provider would give anyway, given here so a Flow run
      // fails with something an operator can act on rather than with Resend's
      // "validation_error".
      const to = list(input.to)
      if (!to) throw new Error('An email needs at least one recipient')
      if (!input.from?.trim()) throw new Error('An email needs a From address on a verified domain')
      if (!input.subject?.trim()) throw new Error('An email needs a subject')
      if (!input.text?.trim() && !input.html?.trim()) throw new Error('An email needs a body: text, HTML, or both')

      const answer = await readResend<{ id?: string }>(
        await conn.request(`${RESEND_API}/emails`, {
          method: 'POST',
          body: JSON.stringify({
            from: input.from,
            to,
            subject: input.subject,
            ...(input.text ? { text: input.text } : {}),
            ...(input.html ? { html: input.html } : {}),
            ...(input.replyTo ? { reply_to: input.replyTo } : {}),
            ...(list(input.cc) ? { cc: list(input.cc) } : {}),
            ...(list(input.bcc) ? { bcc: list(input.bcc) } : {}),
          }),
        }),
        'send that email',
      )
      return { id: String(answer.id ?? '') }
    },

    async listDomains({ connectionId }: ListDomainsInput): Promise<ResendDomain[]> {
      const conn = await open(ctx, connectionId, [RESEND_CAPABILITIES.domainsRead])
      const answer = await readResend<{ data?: Array<{ id: string; name: string; status?: string; region?: string }> }>(
        await conn.request(`${RESEND_API}/domains`), 'list your domains',
      )
      return (answer.data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        status: d.status ?? 'unknown',
        ...(d.region ? { region: d.region } : {}),
      }))
    },
  }
}
