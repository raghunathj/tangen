/**
 * File Name: playground-token.ts
 * Purpose: One-shot impersonation tokens for the API Playground. An
 *          owner/admin's execute call mints a short-lived HMAC token that
 *          names ONLY a keyId + the acting member; the auth middleware
 *          verifies it and loads that key's real permissions, so a
 *          playground request behaves EXACTLY like a real key call. Tokens
 *          are never stored and never shown to the user — the impersonation
 *          only ever happens inside the role-gated execute route.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: HMAC-SHA256 over the JWT secret (resolveJwtSecret);
 *          30s expiry; a process-local nonce cache makes each token
 *          single-use (replay is refused even within the window).
 */
import { resolveJwtSecret } from './jwt-secret'

const TTL_MS = 30_000
const HEADER = 'x-tangen-playground'

export interface PlaygroundClaims {
  keyId: string
  memberId: string
  workspaceId: string
  /** Milliseconds since epoch — the token is invalid at/after this. */
  exp: number
  /** Random per-token nonce (single-use guard). */
  nonce: string
}

export const PLAYGROUND_HEADER = HEADER

function sign(payloadB64: string): string {
  return new Bun.CryptoHasher('sha256', resolveJwtSecret())
    .update(payloadB64).digest('hex')
}

/** Mints a signed one-shot token. Never persisted. */
export function mintPlaygroundToken(input: { keyId: string; memberId: string; workspaceId: string }): string {
  const claims: PlaygroundClaims = {
    keyId: input.keyId, memberId: input.memberId, workspaceId: input.workspaceId,
    exp: Date.now() + TTL_MS,
    nonce: globalThis.crypto.randomUUID().replace(/-/g, ''),
  }
  const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payloadB64}.${sign(payloadB64)}`
}

// Single-use: a verified nonce can't be replayed. Pruned lazily.
const _used = new Map<string, number>()
function remember(nonce: string, exp: number): void {
  _used.set(nonce, exp)
  if (_used.size > 1000) {
    const now = Date.now()
    for (const [n, e] of _used) if (e < now) _used.delete(n)
  }
}

/**
 * Verifies a token: signature, expiry, and single-use. Returns the claims
 * or null (tampered / expired / replayed). Consuming marks the nonce used.
 */
export function verifyPlaygroundToken(token: string | null | undefined): PlaygroundClaims | null {
  if (!token || !token.includes('.')) return null
  const [payloadB64, mac] = token.split('.')
  if (!payloadB64 || !mac) return null
  // Constant-time-ish compare via length + equality (hex strings)
  const expected = sign(payloadB64)
  if (expected.length !== mac.length || expected !== mac) return null
  let claims: PlaygroundClaims
  try {
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof claims.exp !== 'number' || claims.exp < Date.now()) return null
  if (!claims.keyId || !claims.memberId || !claims.nonce) return null
  if (_used.has(claims.nonce)) return null
  remember(claims.nonce, claims.exp)
  return claims
}

/** Test hook — clears the single-use cache. */
export function resetPlaygroundNonces(): void {
  _used.clear()
}
