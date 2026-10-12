/**
 * File Name: oauth2.ts
 * Purpose: The OAuth2 authorization-code pieces core runs for a connector
 *          (Extension Kernel K6.2, tasks/plan-extension-kernel.md): PKCE
 *          (RFC 7636, S256), the authorize URL, and the code exchange at the
 *          connector's token URL. Pure over node:crypto and an injected
 *          fetch; the connector says where, core says how, and the tokens
 *          land sealed in the connections store - never in an extension.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { createHash, randomBytes } from 'node:crypto'
import { RequestError } from '../lib/errors'

export function pkceVerifier(): string {
  return randomBytes(32).toString('base64url')
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function oauthNonce(): string {
  return randomBytes(24).toString('base64url')
}

export function buildAuthorizeUrl(input: {
  authorizeUrl: string
  clientId: string
  redirectUri: string
  scopes?: readonly string[]
  state: string
  codeChallenge?: string
  /**
   * Incremental authorization: ask the provider to ADD these scopes to what
   * this client was already granted rather than replace them. Google's own
   * mechanism (`include_granted_scopes`), and what makes a re-consent for one
   * more capability keep the ones an operator already approved.
   */
  incremental?: boolean
}): string {
  const url = new URL(input.authorizeUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  if (input.scopes?.length) url.searchParams.set('scope', input.scopes.join(' '))
  url.searchParams.set('state', input.state)
  if (input.incremental) url.searchParams.set('include_granted_scopes', 'true')
  if (input.codeChallenge) {
    url.searchParams.set('code_challenge', input.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  return url.toString()
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  /** Epoch milliseconds, when the provider said how long the token lives. */
  expiresAt?: number
  scope?: string
  tokenType?: string
}

async function tokenRequest(tokenUrl: string, form: URLSearchParams, fetchImpl?: typeof fetch): Promise<OAuthTokens> {
  let res: Response
  try {
    res = await (fetchImpl ?? fetch)(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
    })
  } catch (e) {
    throw new RequestError('OAUTH_EXCHANGE_FAILED', `The token endpoint could not be reached: ${(e as Error).message}`, 502)
  }
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try { parsed = JSON.parse(text) as Record<string, unknown> } catch { /* answered below */ }
  if (!res.ok || typeof parsed.access_token !== 'string') {
    const why = typeof parsed.error === 'string' ? `${parsed.error}${typeof parsed.error_description === 'string' ? `: ${parsed.error_description}` : ''}` : `HTTP ${res.status}`
    throw new RequestError('OAUTH_EXCHANGE_FAILED', `The token endpoint refused the request (${why})`, 502)
  }
  const expiresIn = Number(parsed.expires_in)
  return {
    accessToken: parsed.access_token,
    refreshToken: typeof parsed.refresh_token === 'string' ? parsed.refresh_token : undefined,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
    scope: typeof parsed.scope === 'string' ? parsed.scope : undefined,
    tokenType: typeof parsed.token_type === 'string' ? parsed.token_type : undefined,
  }
}

/** The refresh grant; a provider that rotates refresh tokens answers a new one, one that does not keeps the old one in force. */
export async function refreshAccessToken(input: {
  tokenUrl: string
  refreshToken: string
  clientId: string
  clientSecret?: string
  fetchImpl?: typeof fetch
}): Promise<OAuthTokens> {
  const form = new URLSearchParams()
  form.set('grant_type', 'refresh_token')
  form.set('refresh_token', input.refreshToken)
  form.set('client_id', input.clientId)
  if (input.clientSecret) form.set('client_secret', input.clientSecret)
  const tokens = await tokenRequest(input.tokenUrl, form, input.fetchImpl)
  return { ...tokens, refreshToken: tokens.refreshToken ?? input.refreshToken }
}

/** RFC 7009, best effort: the provider is told, and a provider that will not listen does not stop a revocation here. */
export async function revokeTokenAtProvider(input: { revokeUrl: string; token: string; clientId?: string; clientSecret?: string; fetchImpl?: typeof fetch }): Promise<boolean> {
  const form = new URLSearchParams()
  form.set('token', input.token)
  if (input.clientId) form.set('client_id', input.clientId)
  if (input.clientSecret) form.set('client_secret', input.clientSecret)
  try {
    const res = await (input.fetchImpl ?? fetch)(input.revokeUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() })
    return res.ok
  } catch {
    return false
  }
}

/** The token response, normalised; a provider that answers anything but a JSON access_token is a 502 the operator can read. */
export async function exchangeAuthorizationCode(input: {
  tokenUrl: string
  code: string
  redirectUri: string
  clientId: string
  clientSecret?: string
  codeVerifier?: string
  fetchImpl?: typeof fetch
}): Promise<OAuthTokens> {
  const form = new URLSearchParams()
  form.set('grant_type', 'authorization_code')
  form.set('code', input.code)
  form.set('redirect_uri', input.redirectUri)
  form.set('client_id', input.clientId)
  if (input.clientSecret) form.set('client_secret', input.clientSecret)
  if (input.codeVerifier) form.set('code_verifier', input.codeVerifier)
  return tokenRequest(input.tokenUrl, form, input.fetchImpl)
}
