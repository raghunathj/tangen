/**
 * File Name: contract.ts
 * Purpose: What a CONSUMER imports. SMTP is the case that tests the connector
 *          model at its edge, and saying where the edge is matters more than
 *          pretending there isn't one:
 *
 *          - Every other pack reaches a FIXED host, declared in the manifest
 *            and bound by the platform. An SMTP connection's host is the
 *            operator's own, given when they connect - so this pack declares
 *            `network:any` and says why, and an operator sees that at install.
 *          - SMTP is not HTTP, so the platform's authenticated `request` seam
 *            does not apply. This pack opens the socket itself (nodemailer)
 *            with the material the platform sealed, and the platform still
 *            owns the credential, the lifecycle, the capability check and the
 *            health probe.
 *
 *          What a consumer sees is identical to Resend's: a connection id, a
 *          capability, a message. That is the whole point - Forms, Flows and
 *          anything else send email without knowing which provider is behind
 *          the connection an operator chose.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** The provider id: what a grant, a picker and the ownership boundary name. */
export const SMTP_PROVIDER = 'smtp'

/** The one connector: a server, a port and credentials an operator pastes. */
export const SMTP_CONNECTOR = 'smtp.server'

/**
 * Provider-scoped capabilities. SMTP has exactly one thing to offer, and no
 * resource to browse: a server does not tell you which domains it will accept
 * a From for - it accepts the message or refuses it, and the refusal is the
 * server's own words.
 */
export const SMTP_CAPABILITIES = {
  emailSend: 'email.send',
} as const

/** The typed service this pack provides. */
export const SMTP_EMAIL_SERVICE = 'smtp.email@1'

/** The fields an operator fills. Every one of them is sealed at rest. */
export const SMTP_FIELDS = ['host', 'port', 'username', 'password'] as const

export interface SendEmailInput {
  /** The connection an operator chose (an id, never a label). */
  connectionId: string
  /** `Acme <hello@acme.test>` or `hello@acme.test`, as the server will accept. */
  from: string
  to: string | string[]
  subject: string
  /** At least one of `text` or `html`. */
  text?: string
  html?: string
  replyTo?: string
  cc?: string | string[]
  bcc?: string | string[]
}

export interface SendEmailResult {
  /** The server's own message id, which is what a run log records. */
  id: string
  /** Addresses the server accepted; a partial acceptance is a real outcome. */
  accepted: string[]
  /** Addresses it rejected, so a Flow run can say which. */
  rejected: string[]
}

/** `smtp.email@1`: what another extension may do with an SMTP connection. */
export interface SmtpEmailService {
  send(input: SendEmailInput): Promise<SendEmailResult>
}
