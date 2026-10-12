/**
 * File Name: connections-scope.ts
 * Purpose: The seam between boot and the connection routes (Extension
 *          Kernel K6.2, tasks/plan-extension-kernel.md). The connections
 *          key, the active extensions and the deployment's URLs are resolved
 *          per workspace at boot; the member routes and the pre-auth OAuth
 *          callback ask here rather than reaching into boot state. Tests set
 *          a scope of their own with an injected fetch.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ConnectionsStore } from './connections'
import type { SealedKey } from '../lib/sealed'

export interface ConnectionsScope {
  store: ConnectionsStore
  /** The deployment's connections key: what seals connection material and settings secrets (K7.1). */
  key?: SealedKey
  /** The extension ids active in this workspace: only their connectors are offered. */
  activeIds: () => Promise<string[]>
  /** The API's public URL (`server.url`): the OAuth redirect URI is built on it. Falls back to the request origin. */
  publicUrl?: string
  /** The Admin's URL (`admin.url`): where the OAuth callback sends the browser back. Falls back to the request origin. */
  adminUrl?: string
  fetchImpl?: typeof fetch
  lookup?: (host: string) => Promise<string[]>
  /**
   * The cache backend for resource pages (B2): redis when the deployment has
   * one, and `withRouteCache` falls back to Postgres or to nothing without it.
   * A picker that types four characters must not make four provider calls.
   */
  redis?: unknown
  /**
   * The operator's OAuth client for a provider, supplied by the DEPLOYMENT
   * rather than typed into a form: the deployment's secret provider first
   * (`connectors.<provider>.clientId`), then the environment
   * (`CONNECTOR_<PROVIDER>_CLIENT_ID`). Server-side only - it is sealed into
   * the connection at connect time and never answered to a client.
   */
  oauthClient?: (provider: string) => { clientId?: string; clientSecret?: string }
}

let resolver: ((workspaceId: string) => ConnectionsScope | undefined) | null = null

/** Boot installs the resolver; `null` clears it (tests). */
export function setConnectionsScope(fn: ((workspaceId: string) => ConnectionsScope | undefined) | null): void {
  resolver = fn
}

export function connectionsScopeFor(workspaceId: string): ConnectionsScope | undefined {
  return resolver?.(workspaceId)
}
