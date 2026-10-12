/**
 * File Name: contract.ts
 * Purpose: What a CONSUMER imports. The third pack, and the one that makes
 *          EMAIL an operator's connection rather than a deployment's
 *          configuration (the user, 2026-09-20: "all email things should use
 *          the connectors to keep it clean").
 *
 *          Resend is one provider with one auth model - a pasted API key - so
 *          this pack is the smallest honest shape a pack can have, and the
 *          contract it proves is the same one Google and Slack prove: a
 *          consumer names a CAPABILITY and a connection id, never a
 *          credential, never a host, never the auth model.
 *
 *          Nothing here imports the Admin, React or the pack's server, so a
 *          site project can import it and still typecheck.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** The provider id: what a grant, a picker and the ownership boundary name. */
export const RESEND_PROVIDER = 'resend'

/**
 * The one connector, in the normalized `<provider>.<authModel>` grammar -
 * lowercase, and naming the model the way Slack's `slack.token` does.
 */
export const RESEND_CONNECTOR = 'resend.key'

/**
 * Provider-scoped capabilities. A key's actual reach is Resend's business -
 * a full-access key and a sending-only key look identical in the paste - so
 * the platform's check is the DECLARATION (a capability this connector does
 * not declare is refused before the call) and the rest is Resend's own
 * refusal, passed through in its words.
 */
export const RESEND_CAPABILITIES = {
  /** Send an email. */
  emailSend: 'email.send',
  /** List the domains the account has verified, so an operator picks a From. */
  domainsRead: 'domains.read',
} as const

/** The typed service this pack provides. */
export const RESEND_EMAIL_SERVICE = 'resend.email@1'

/** One verified sending domain, as Resend reports it. */
export interface ResendDomain {
  id: string
  /** `acme.test` - what a From address must end with. */
  name: string
  /** Resend's own status: only a verified domain can send. */
  status: string
  region?: string
}

export interface SendEmailInput {
  /** The connection an operator chose (an id, never a label). */
  connectionId: string
  /** `Acme <hello@acme.test>` or `hello@acme.test`, on a verified domain. */
  from: string
  /** One address or several. */
  to: string | string[]
  subject: string
  /** At least one of `text` or `html`; both is the usual shape. */
  text?: string
  html?: string
  replyTo?: string
  cc?: string | string[]
  bcc?: string | string[]
}

export interface SendEmailResult {
  /** Resend's id for the message, which is what a run log records. */
  id: string
}

export interface ListDomainsInput {
  connectionId: string
}

/** `resend.email@1`: what another extension may do with a Resend connection. */
export interface ResendEmailService {
  send(input: SendEmailInput): Promise<SendEmailResult>
  listDomains(input: ListDomainsInput): Promise<ResendDomain[]>
}
