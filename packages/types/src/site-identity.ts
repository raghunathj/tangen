/**
 * File Name: site-identity.ts
 * Purpose: The site identity provider contract (tasks/plan-core-slimming.md
 *          S1): who the END USER behind a request is, for one workspace.
 *          Tangen Auth is one provider; Supabase, Firebase, Clerk, Auth0 or
 *          an enterprise IdP are others. Core never inspects a site
 *          credential itself: `requireAuth`, `auth: 'user'` on custom routes
 *          and the realtime ticket's site path all ask the workspace's
 *          provider, so site code written against them works whichever
 *          provider is installed.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Site users stay outside the kernel's `identities`
 *          table on purpose - they are the application's users and act
 *          through the site's key with `onBehalfOf` (kernel §5). Exactly one
 *          provider serves a workspace; an extension contributes one through
 *          `TangenExtensionServer.siteIdentity`.
 */
import type { SiteUser } from './site-auth'

/** What a provider sees of the request: the Bearer token if one was presented (never a `tgn_` key) and the headers, for cookie- or header-based schemes. */
export interface SiteIdentityRequest {
  workspaceId: string
  /** The Bearer credential, or null when the request carried none (or carried a platform key). */
  token: string | null
  /** Read-only request headers (cookies, a vendor's own header). */
  headers: { get(name: string): string | null }
}

/** Optional user directory a provider exposes: profile reads and writes for `ctx.profile`, the Admin's user list. */
export interface SiteUserDirectory {
  get(userId: string): Promise<SiteUser | null>
  /** Update the mutable profile: the display name and developer-declared profile fields. Absent when the provider's users are read-only here. */
  update?(userId: string, patch: { name?: string | null; profileMeta?: Record<string, unknown> }): Promise<void>
  list?(input: { limit: number; cursor?: string | null; search?: string | null }): Promise<{ users: SiteUser[]; nextCursor: string | null }>
}

/**
 * A site identity provider: answers "who is the end user behind this
 * request" for a workspace. `authenticate` returns null when no credential
 * is presented and throws a `SiteIdentityError` for one it refuses.
 */
export interface SiteIdentityProvider {
  /** A stable id: 'tangen', 'supabase', 'firebase', 'clerk', ... Recorded on the resolved user as `provider`. */
  readonly id: string
  authenticate(input: SiteIdentityRequest): Promise<SiteUser | null>
  users?: SiteUserDirectory
  /** The roles this provider hands out, for the Admin and for `requireRole` hints. */
  roles?: readonly string[]
  /**
   * Signs a site token of this provider's own kind, for site code that mints
   * sessions itself (`ctx.sign` on a custom route). Absent on a provider that
   * only verifies (a Supabase or Firebase verifier), where `ctx.sign` answers 501.
   */
  sign?(payload: Record<string, unknown>, ttl?: string): Promise<string>
}

/** Why a site credential was refused, or why none could be judged. */
export type SiteIdentityErrorCode =
  | 'no_provider'
  | 'ambiguous'
  | 'invalid_token'
  | 'expired'
  | 'revoked'
  | 'wrong_workspace'
  | 'blocked'

export const SITE_IDENTITY_ERROR_STATUS: Record<SiteIdentityErrorCode, number> = {
  no_provider: 401,
  ambiguous: 500,
  invalid_token: 401,
  expired: 401,
  revoked: 401,
  wrong_workspace: 401,
  blocked: 403,
}

export class SiteIdentityError extends Error {
  readonly code: SiteIdentityErrorCode
  readonly status: number
  constructor(code: SiteIdentityErrorCode, message?: string) {
    super(message ?? SITE_IDENTITY_ERROR_MESSAGE[code])
    this.name = 'SiteIdentityError'
    this.code = code
    this.status = SITE_IDENTITY_ERROR_STATUS[code]
  }
}

export const SITE_IDENTITY_ERROR_MESSAGE: Record<SiteIdentityErrorCode, string> = {
  no_provider: 'No site identity provider is installed for this workspace',
  ambiguous: 'Two site identity providers are active for this workspace',
  invalid_token: 'Invalid or expired token',
  expired: 'Invalid or expired token',
  revoked: 'Session has been revoked',
  wrong_workspace: 'Token does not match workspace',
  blocked: 'This account is blocked',
}
