/**
 * File Name: tangen.extension.ts
 * Purpose: The SMTP connector pack - email through a server an operator runs
 *          or rents, as a connection rather than as deployment configuration
 *          (the user, 2026-09-20: "all email things should use the connectors
 *          to keep it clean").
 *
 *          It declares one thing no other pack does: `network:any`. Every
 *          other connector names its hosts and the platform binds the client
 *          to them, but an SMTP connection's server is the operator's own,
 *          given when they connect - so the grant is honest about the reach,
 *          an operator approves it at install, and the pack narrows it itself
 *          (a private or loopback address is refused unless the connection
 *          deliberately allows one).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { defineExtension } from '@tangen/cms'
import { SMTP_BRAND } from './src/connector'
import { SMTP_CONNECTOR, SMTP_EMAIL_SERVICE, SMTP_PROVIDER } from './src/contract'

export default defineExtension({
  id: 'smtp',
  name: 'SMTP',
  version: '0.1.1',
  // Provenance, shown on Settings > Extensions.
  author: 'Tangen',
  homepage: 'https://tangen.app',
  license: 'MIT',
  contract: 1,
  kind: 'connector-pack',
  description: 'Send email through any SMTP server as a connection an operator manages, tests and revokes. The server, port, username and password are sealed here and never shown again.',

  server: './src/server.ts',

  connectors: [
    // No `hosts`: the server is the operator's, and what a connection may
    // reach is checked against the material instead.
    { id: SMTP_CONNECTOR, provider: SMTP_PROVIDER, label: 'SMTP server', brand: { ...SMTP_BRAND } },
  ],

  provides: { services: [SMTP_EMAIL_SERVICE] },

  grants: {
    required: [
      { grant: 'connections:contribute', reason: 'Offers the SMTP connector, so an operator can connect a mail server once and use it wherever email is sent.' },
      { grant: 'connections:smtp', reason: 'Sends through the connection an operator chose.' },
      { grant: 'flow:contribute-nodes', reason: 'Offers the "Send an email (SMTP)" flow action and the form destination preset that builds a flow from it.' },
      { grant: 'network:any', reason: 'An SMTP connection reaches the server the operator gave it, which cannot be known in advance. The pack refuses a private or loopback address unless that connection deliberately allows one.' },
    ],
  },
})
