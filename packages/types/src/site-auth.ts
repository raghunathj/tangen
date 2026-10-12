/**
 * File Name: site-auth.ts
 * Purpose: The site user as core sees one: what a site identity provider
 *          resolves from a request (tasks/plan-core-slimming.md S1). The
 *          provider's own shapes - options, profile fields, hooks, sessions -
 *          live with the provider (`@tangen/ext-auth` for Tangen's own).
 *
 * Author: Raghunath J
 * License: MIT
 */

/**
 * An authenticated site user, as resolved by the workspace's site identity
 * provider. Never a workspace member.
 */
export interface SiteUser {
  id: string;
  workspaceId: string;
  /** null for anonymous users, or for a provider that hands out no email */
  email: string | null;
  name: string | null;
  role: string;
  status: "active" | "blocked";
  isAnonymous: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** The site identity provider that resolved this user ('tangen', 'supabase', 'firebase', ...). Set by core on resolution. */
  provider?: string;
  /** The provider's raw claims (Supabase `app_metadata`, Firebase custom claims), for site code that needs them. */
  claims?: Record<string, unknown>;
  /** Developer-defined profile fields appear as additional keys */
  [key: string]: unknown;
}
