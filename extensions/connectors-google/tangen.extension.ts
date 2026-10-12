/**
 * File Name: tangen.extension.ts
 * Purpose: The Google connector pack (plan-connectors C1). Tangen ships zero
 *          connectors: a site installs the providers it uses, and this is the
 *          first one. The manifest declares WHAT it offers - the provider, its
 *          auth model and the hosts a connection reaches - so an operator sees
 *          all of that at install, before any of the pack's code runs, and so
 *          the ownership preflight can refuse a second Google pack without
 *          importing either.
 *
 *          It is an ordinary extension in every mechanical way: it installs,
 *          enables per workspace, upgrades, ports and is reviewed like any
 *          other. `kind` only changes how it is FRAMED.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { defineExtension } from '@tangen/cms'
import { GOOGLE_BRAND, GOOGLE_HOSTS } from './src/connector'
import { GOOGLE_OAUTH_CONNECTOR, GOOGLE_PROVIDER, GOOGLE_SEARCH_CONSOLE_SERVICE, GOOGLE_SHEETS_SERVICE } from './src/contract'

export default defineExtension({
  id: 'google',
  name: 'Google',
  version: '0.3.10',
  // Provenance, shown on Settings > Extensions.
  author: 'Tangen',
  homepage: 'https://tangen.app',
  license: 'MIT',
  contract: 1,
  kind: 'connector-pack',
  description: 'Connect one Google account and use it for Sheets and Search Console. Credentials stay with Tangen; an extension that uses this pack is handed an authenticated client, never a token.',

  server: './src/server.ts',

  // C1: the declaration an operator is shown at install, and the one the
  // kernel holds the runtime to - a contributed connector this does not name
  // is not offered (guardrail 4).
  connectors: [
    {
      id: GOOGLE_OAUTH_CONNECTOR, provider: GOOGLE_PROVIDER, label: 'Google',
      hosts: [...GOOGLE_HOSTS], brand: { ...GOOGLE_BRAND },
      // F2: adopts the connection the SEO extension's own Search Console
      // connector used to hold, so an operator loses nothing when Google
      // moves here. Declared, so it is in the install review too.
      supersedes: ['google-search-console'],
    },
  ],

  // C3: the typed surface another extension calls, with no Google knowledge.
  provides: { services: [GOOGLE_SHEETS_SERVICE, GOOGLE_SEARCH_CONSOLE_SERVICE] },

  grants: {
    required: [
      { grant: 'connections:contribute', reason: 'Offers the Google connector, so an operator can connect a Google account once and use it for every Google capability they consent to.' },
      // The pack calls Google THROUGH its own connections, so it needs the
      // capabilities it offers - a connection implies its connector's reach
      // and nothing more.
      { grant: 'connections:google', reason: 'Runs the Sheets and Search Console services over the connection an operator chose.' },
      { grant: 'flow:contribute-nodes', reason: 'Offers the "Append row to Google Sheet" and "Query Search Console" flow actions, and the form destination preset that builds a flow from the first of them.' },
    ],
  },
})
