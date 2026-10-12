/**
 * File Name: tangen.extension.ts
 * Purpose: The Resend connector pack - the third pack, and the one that makes
 *          EMAIL an operator's connection instead of a deployment's
 *          environment variable (the user, 2026-09-20: "all email things
 *          should use the connectors to keep it clean").
 *
 *          It is the smallest pack the contract allows: one provider, one auth
 *          model, two capabilities, one resource - which is exactly why it is
 *          worth having. A pack needs no change to the platform, and this one
 *          proves it a third time on a provider that is neither OAuth (Google)
 *          nor a chat API (Slack).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { defineExtension } from '@tangen/cms'
import { RESEND_BRAND, RESEND_HOSTS } from './src/connector'
import { RESEND_CONNECTOR, RESEND_EMAIL_SERVICE, RESEND_PROVIDER } from './src/contract'

export default defineExtension({
  id: 'resend',
  name: 'Resend',
  version: '0.1.1',
  // Provenance, shown on Settings > Extensions.
  author: 'Tangen',
  homepage: 'https://tangen.app',
  license: 'MIT',
  contract: 1,
  kind: 'connector-pack',
  description: 'Send email through Resend: one connection an operator manages, tests and revokes, a verified-domain picker, and sending from flows and form destinations. The API key is sealed here and never shown again.',

  server: './src/server.ts',

  connectors: [
    { id: RESEND_CONNECTOR, provider: RESEND_PROVIDER, label: 'Resend', hosts: [...RESEND_HOSTS], brand: { ...RESEND_BRAND } },
  ],

  provides: { services: [RESEND_EMAIL_SERVICE] },

  grants: {
    required: [
      { grant: 'connections:contribute', reason: 'Offers the Resend connector, so an operator can connect an account once and use it wherever email is sent.' },
      { grant: 'connections:resend', reason: 'Runs the email service over the connection an operator chose.' },
      { grant: 'flow:contribute-nodes', reason: 'Offers the "Send an email" flow action and the form destination preset that builds a flow from it.' },
    ],
  },
})
