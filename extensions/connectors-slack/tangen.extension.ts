/**
 * File Name: tangen.extension.ts
 * Purpose: The Slack connector pack (plan-connectors E1) - the second pack,
 *          and the one that proves the model rather than merely using it: one
 *          provider offering TWO auth models, declared side by side.
 *
 *          The manifest declares WHAT it offers - the provider, each auth
 *          model and the hosts a connection reaches - so an operator sees all
 *          of it at install, before any of the pack's code runs, and the
 *          ownership preflight can refuse a second Slack pack without
 *          importing either.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { defineExtension } from '@tangen/cms'
import { SLACK_BRAND, SLACK_HOSTS } from './src/connector'
import { SLACK_CHAT_SERVICE, SLACK_OAUTH_CONNECTOR, SLACK_PROVIDER, SLACK_TOKEN_CONNECTOR } from './src/contract'

export default defineExtension({
  id: 'slack',
  name: 'Slack',
  version: '0.1.6',
  // Provenance, shown on Settings > Extensions.
  author: 'Tangen',
  homepage: 'https://tangen.app',
  license: 'MIT',
  contract: 1,
  kind: 'connector-pack',
  description: 'Connect a Slack workspace - through a Slack app, or with a bot token you paste - and post from flows and forms. Credentials stay with Tangen; an extension that uses this pack is handed an authenticated client, never a token.',

  server: './src/server.ts',

  // Both auth models of ONE provider. Ownership and conflict are per
  // provider, so these two coexist and a second `slack` pack does not.
  connectors: [
    { id: SLACK_OAUTH_CONNECTOR, provider: SLACK_PROVIDER, label: 'Slack', hosts: [...SLACK_HOSTS], brand: { ...SLACK_BRAND } },
    { id: SLACK_TOKEN_CONNECTOR, provider: SLACK_PROVIDER, label: 'Slack (bot token)', hosts: [...SLACK_HOSTS], brand: { ...SLACK_BRAND } },
  ],

  provides: { services: [SLACK_CHAT_SERVICE] },

  grants: {
    required: [
      { grant: 'connections:contribute', reason: 'Offers the Slack connectors, so an operator can connect a workspace once and use it wherever Slack is posted to.' },
      { grant: 'connections:slack', reason: 'Runs the chat service over the connection an operator chose.' },
      { grant: 'flow:contribute-nodes', reason: 'Offers the "Post a Slack message" flow action and the form destination preset that builds a flow from it.' },
    ],
  },
})
