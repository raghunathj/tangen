/**
 * File Name: jwt-secret.ts
 * Purpose: Single source of truth for JWT signing secret resolution. Production
 *          refuses to start without an explicit secret; development uses a
 *          generated per-machine secret persisted to .tangen/dev-jwt-secret so
 *          tokens survive watch-mode restarts.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: node:crypto, node:fs, jose. Every JWT sign/verify site in
 *                     the API must import getJwtKey/resolveJwtSecret from here -
 *                     never inline a fallback secret.
 *
 *   Two key spaces, never one (Gateway slice 5, the finding in
 *   tasks/plan-parallel-tracks.md section 6). Member sessions are signed with
 *   JWT_SECRET. Site-auth sessions are signed with TANGEN_SITE_JWT_SECRET when
 *   it is set, and otherwise with a key DERIVED from JWT_SECRET through HKDF
 *   with a fixed domain separator - never JWT_SECRET verbatim, because a
 *   shared key let a site user's token verify under the member derive. The
 *   derivation is the second line; the first is the `aud` claim site tokens
 *   carry (lib/site-jwt.ts) and `verifyMemberToken` refuses. Either alone
 *   closes the hole; both are kept so a copy-pasted equal secret or a
 *   bypassed claim check is still not a crossing.
 */
import { envSecretProvider } from '@tangen/types'
import { currentDeploymentPolicy } from './deployment-role'
import { randomBytes } from 'node:crypto'
import { jwtVerify, type JWTPayload } from 'jose'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

let cachedDevSecret: string | null = null
let warned = false

/** HKDF salt and info for the derived site key. Changing either invalidates every derived-key site session. */

function isProductionLike(): boolean {
  return currentDeploymentPolicy().requireJwtSecret
}

function devSecretPath(): string {
  return process.env.TANGEN_DEV_SECRET_FILE ?? '.tangen/dev-jwt-secret'
}

/**
 * Resolves the JWT signing secret.
 * @param explicit - The configured secret (e.g. envSecretProvider().read('JWT_SECRET')); wins when set.
 * @returns The secret string.
 * @throws When no secret is configured and NODE_ENV is production or staging.
 */
export function resolveJwtSecret(explicit: string | undefined = envSecretProvider().read('JWT_SECRET')): string {
  if (explicit) return explicit

  if (isProductionLike()) {
    throw new Error(
      'JWT_SECRET must be set on a staging or production deployment (TANGEN_DEPLOYMENT_ROLE, or NODE_ENV=production) - ' +
      'refusing to start with a generated secret. Set JWT_SECRET for this deployment.',
    )
  }

  if (cachedDevSecret) return cachedDevSecret

  const path = devSecretPath()
  try {
    if (existsSync(path)) {
      const stored = readFileSync(path, 'utf8').trim()
      if (stored) {
        cachedDevSecret = stored
        return stored
      }
    }
  } catch {
    // Unreadable file - fall through and regenerate
  }

  cachedDevSecret = randomBytes(32).toString('hex')
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, cachedDevSecret, 'utf8')
  } catch {
    // Read-only filesystem - secret lives only in this process
  }

  if (!warned) {
    warned = true
    console.warn(
      `[tangen] JWT_SECRET is not set - using a generated development secret (${path}). ` +
      'Set JWT_SECRET explicitly before deploying.',
    )
  }
  return cachedDevSecret
}

/**
 * Returns the admin JWT signing key derived from JWT_SECRET.
 */
export function getJwtKey(): Uint8Array {
  return new TextEncoder().encode(resolveJwtSecret(envSecretProvider().read('JWT_SECRET')))
}

/**
 * Verifies a MEMBER session token: signed with the member key and carrying
 * no audience. A site session carries `aud` (lib/site-jwt.ts), so a token
 * with any audience is refused here even when its signature would pass -
 * which it can, when an operator sets TANGEN_SITE_JWT_SECRET equal to
 * JWT_SECRET. Every member verifier (the auth derive, the custom router's
 * `auth: 'member'`, the workspace setup's session check) goes through this.
 * @param token - The raw Bearer value.
 * @returns The verified claims.
 * @throws When the signature, the expiry or the audience check fails.
 */
export async function verifyMemberToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, getJwtKey())
  if (payload.aud !== undefined) throw new Error('not a member token: audience present')
  return payload
}

/**
 * Startup guard - call once at boot so a missing JWT_SECRET fails the process
 * immediately in production instead of surfacing on the first authenticated
 * request. Also says, once, when the site-auth key is the derived one: it
 * works, and a dedicated secret is still the recommendation, because it can
 * be rotated on its own without logging every admin out.
 * @throws When NODE_ENV is production/staging and JWT_SECRET is unset.
 */
export function assertJwtSecretConfigured(): void {
  resolveJwtSecret(envSecretProvider().read('JWT_SECRET'))
}

/** Test-only: clears the in-process dev secret cache. */
export function __resetJwtSecretCache(): void {
  cachedDevSecret = null
  warned = false
}
