/**
 * File Name: connector.ts
 * Purpose: The SMTP connector: provider `smtp`, one auth model - a server, a
 *          port and credentials an operator pastes, all four sealed.
 *
 *          It is the one connector in the programme that does NOT speak HTTP,
 *          so the platform's bound `request` seam is unused and the pack opens
 *          the socket itself. Everything else the platform still owns: the
 *          material is sealed at rest and handed to the connector only, the
 *          capability check happens before the send, Test is a real SMTP
 *          handshake, and revoking the connection stops every sender at once.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/cms for types only. The transport lives in
 *          transport.ts so every rule about what a connection may reach is
 *          testable without a mail server.
 */
import type { ConnectorContext, ConnectorDefinition } from '@tangen/cms'
import { SMTP_CAPABILITIES, SMTP_CONNECTOR, SMTP_FIELDS, SMTP_PROVIDER, type SendEmailResult } from './contract'
import { addressList, nodemailerSender, smtpTarget, transportOptions, type SmtpSenderFactory } from './transport'

/**
 * Whether this connection may reach a private address. Read from the sealed
 * material because that is where the connect form's fields land - an operator
 * types `yes` deliberately, and a connection made without it cannot reach
 * localhost however the host is spelled.
 */
export const allowsPrivate = (credentials: Record<string, unknown>): boolean =>
  ['yes', 'true', '1'].includes(String(credentials.allowPrivate ?? '').trim().toLowerCase())

/**
 * A real SMTP handshake: connect, greet, STARTTLS where required, and
 * authenticate. It sends nothing - `verify` is the protocol's own "are you
 * there and will you take my credentials".
 *
 * The verdict distinguishes what an operator must fix from what the server is
 * doing right now, because marking a working connection dead because a mail
 * server was briefly busy is worse than saying nothing.
 */
export function smtpHealth(sender: SmtpSenderFactory): NonNullable<ConnectorDefinition['health']> {
  return async (conn) => {
    let target
    try {
      target = smtpTarget(conn.credentials, { allowPrivate: allowsPrivate(conn.credentials) })
    } catch (e) {
      // The material itself is wrong: no amount of retrying fixes it.
      return { ok: false, message: (e as Error).message }
    }
    const transport = sender(transportOptions(target))
    try {
      await transport.verify()
      return { ok: true }
    } catch (e) {
      const message = (e as Error).message || 'the server gave no reason'
      const code = String((e as { code?: unknown }).code ?? '')
      // 535/534/530 are credentials; a timeout or a refused socket is the
      // server or the network, and the connection is as good as it was.
      if (/5\d\d/.test(message) && /auth|credential|password|username/i.test(message)) {
        return { ok: false, message: `The server refused these credentials: ${message}` }
      }
      if (['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND', 'ESOCKET', 'EDNS'].includes(code)) {
        return { ok: false, transient: code !== 'ENOTFOUND', message: `${target.host}:${target.port} could not be reached: ${code}` }
      }
      return { ok: false, transient: true, message: `The server could not be checked: ${message}` }
    } finally {
      transport.close?.()
    }
  }
}

/**
 * The SEND, as a connector operation rather than as something a consumer does
 * with the credentials.
 *
 * This is the shape the platform gained for SMTP (2026-09-20): a consumer
 * never holds material, and SMTP has no path to bind or header to add, so
 * `request` cannot carry it. The operation runs HERE, with the sealed
 * material, under the same capability check a request would have had; the
 * consumer passes a message and gets an outcome.
 */
export function smtpSend(sender: SmtpSenderFactory) {
  return async (conn: ConnectorContext, input: unknown): Promise<SendEmailResult> => {
    const message = (input ?? {}) as Record<string, unknown>
    const to = addressList(message.to as string | string[] | undefined)
    if (!to) throw new Error('An email needs at least one recipient')

    const target = smtpTarget(conn.credentials, { allowPrivate: allowsPrivate(conn.credentials) })
    const transport = sender(transportOptions(target))
    try {
      const answer = await transport.send({
        from: message.from,
        to,
        subject: message.subject,
        ...(message.text ? { text: message.text } : {}),
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        ...(addressList(message.cc as string | string[] | undefined) ? { cc: addressList(message.cc as string | string[] | undefined) } : {}),
        ...(addressList(message.bcc as string | string[] | undefined) ? { bcc: addressList(message.bcc as string | string[] | undefined) } : {}),
      })
      const accepted = (answer.accepted ?? []).map((a) => String(a))
      const rejected = (answer.rejected ?? []).map((a) => String(a))
      // Every recipient refused is a failed send: a run must say so rather
      // than report success with an empty result.
      if (accepted.length === 0) {
        throw new Error(`The server accepted no recipients${rejected.length ? `: it rejected ${rejected.join(', ')}` : ''}`)
      }
      return { id: String(answer.messageId ?? ''), accepted, rejected }
    } finally {
      transport.close?.()
    }
  }
}

/** A neutral envelope mark: SMTP is a protocol, not a brand. */
export const SMTP_BRAND = {
  icon: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='10' fill='%231F2937'/%3E%3Cpath fill='none' stroke='%23fff' stroke-width='2.5' stroke-linejoin='round' d='M11 16h26v16H11z'/%3E%3Cpath fill='none' stroke='%23fff' stroke-width='2.5' stroke-linejoin='round' d='m11 17 13 10 13-10'/%3E%3C/svg%3E`,
  color: '#1F2937',
} as const

export const smtpConnector: ConnectorDefinition = {
  id: SMTP_CONNECTOR,
  provider: SMTP_PROVIDER,
  label: 'SMTP server',
  brand: { ...SMTP_BRAND },
  description: 'Send email through any SMTP server - your own, or a provider that gives you SMTP credentials. Everything you paste is sealed here and never shown again.',
  auth: {
    kind: 'apiKey',
    // All four sealed, including the host: the material is what it takes to
    // send as this account, and splitting it into "secret" and "not" would
    // invite a second store for half of it.
    fields: [...SMTP_FIELDS, 'allowPrivate'],
  },
  // NO hosts: the server is the operator's, given when they connect. What a
  // connection may reach is checked in `smtpTarget` instead, which refuses a
  // private address unless the connection deliberately allows one.
  capabilities: {
    [SMTP_CAPABILITIES.emailSend]: {
      label: 'Send email',
      description: 'Send mail through this server. Whether it accepts a given From address is the server\'s to say, and it says so at the first attempt.',
    },
  },
  health: smtpHealth(nodemailerSender),
  // No `request`: this provider is not HTTP. The send is an operation, so the
  // material stays here and the consumer calls `conn.invoke('send', message)`.
  operations: { send: smtpSend(nodemailerSender) as never },
}
