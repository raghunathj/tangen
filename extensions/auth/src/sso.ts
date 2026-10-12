/**
 * File Name: sso.ts
 * Purpose: Single sign-on through an authorization-code flow: Google and
 *          GitHub built in, and any OpenID Connect issuer through its
 *          discovery document (Okta, Entra, Auth0, Keycloak, ...). The
 *          provider hands back one profile shape; the route does the rest.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The client secret is resolved by NAME from the
 *          deployment's secret provider at exchange time and never stored.
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import type { SsoProviderConfig } from './contract'
import { optionsOf } from './context'
import { RequestError } from './errors'

export interface SsoProfile {
  subject: string
  email: string | null
  emailVerified: boolean
  name: string | null
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}

export type SsoExchange = (ctx: ExtensionServerCtx, cfg: SsoProviderConfig, input: { code: string; redirectUri: string }) => Promise<SsoProfile>

export const providerIdOf = (cfg: SsoProviderConfig): string => cfg.id ?? cfg.name

export function providersOf(ctx: ExtensionServerCtx): SsoProviderConfig[] {
  return optionsOf(ctx).providers ?? []
}

export function findProvider(ctx: ExtensionServerCtx, id: string): SsoProviderConfig | undefined {
  return providersOf(ctx).find((p) => providerIdOf(p) === id)
}

/** The kernel's outbound http (network grants); a ctx without it cannot reach a provider and says so. */
function httpOf(ctx: ExtensionServerCtx): NonNullable<ExtensionServerCtx['http']> {
  if (!ctx.http) throw new RequestError('INTERNAL', 'SSO: this ctx carries no http; the provider hosts are network grants of the manifest', 500)
  return ctx.http
}

export function clientSecretOf(ctx: ExtensionServerCtx, cfg: SsoProviderConfig): string {
  // E.9: ctx.secrets only - the process environment is never a fallback.
  const material = ctx.secrets?.get(cfg.clientSecret)
  if (!material) throw new RequestError('INTERNAL', `SSO: the deployment does not supply ${cfg.clientSecret} (the clientSecret reference of the "${providerIdOf(cfg)}" provider)`, 500)
  return material
}

/** Whether the deployment supplies the provider's secret (the admin's Sign-in methods page). */
export function providerConfigured(ctx: ExtensionServerCtx, cfg: SsoProviderConfig): boolean {
  return Boolean(cfg.clientId && ctx.secrets?.has(cfg.clientSecret))
}

// ─── OpenID Connect discovery ────────────────────────────────────────────────

interface Discovery { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint?: string }
const discoveryCache = new Map<string, Discovery>()

async function discover(ctx: ExtensionServerCtx, issuer: string): Promise<Discovery> {
  const cached = discoveryCache.get(issuer)
  if (cached) return cached
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  const res = await httpOf(ctx)(url)
  if (!res.ok) throw new RequestError('INTERNAL', `SSO: the issuer's discovery document could not be read (${res.status})`, 502)
  const doc = await res.json() as Discovery
  if (!doc.authorization_endpoint || !doc.token_endpoint) throw new RequestError('INTERNAL', 'SSO: the discovery document names no authorization or token endpoint', 502)
  discoveryCache.set(issuer, doc)
  return doc
}

// ─── The three shapes ────────────────────────────────────────────────────────

const ENDPOINTS = {
  google: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', userinfo: 'https://www.googleapis.com/oauth2/v2/userinfo', scopes: ['openid', 'email', 'profile'] },
  github: { authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', userinfo: 'https://api.github.com/user', scopes: ['read:user', 'user:email'] },
} as const

export async function authorizeUrl(ctx: ExtensionServerCtx, cfg: SsoProviderConfig, input: { redirectUri: string; state: string }): Promise<string> {
  let endpoint: string
  let scopes: string[]
  if (cfg.name === 'oidc') {
    if (!cfg.issuer) throw new RequestError('INTERNAL', `SSO: the "${providerIdOf(cfg)}" provider declares no issuer`, 500)
    endpoint = (await discover(ctx, cfg.issuer)).authorization_endpoint
    scopes = cfg.scopes ?? ['openid', 'email', 'profile']
  } else {
    endpoint = ENDPOINTS[cfg.name].authorize
    scopes = cfg.scopes ?? [...ENDPOINTS[cfg.name].scopes]
  }
  const url = new URL(endpoint)
  url.searchParams.set('client_id', cfg.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scopes.join(' '))
  url.searchParams.set('state', input.state)
  if (cfg.name === 'google') url.searchParams.set('access_type', 'offline')
  return url.toString()
}

async function postToken(ctx: ExtensionServerCtx, endpoint: string, body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; id_token?: string }> {
  const res = await httpOf(ctx)(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body),
  })
  if (!res.ok) throw new RequestError('UNAUTHORIZED', 'Failed to exchange the authorization code', 401)
  const json = await res.json() as { access_token?: string; error?: string; refresh_token?: string; expires_in?: number; id_token?: string }
  if (!json.access_token) throw new RequestError('UNAUTHORIZED', 'Failed to exchange the authorization code', 401)
  return json as { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string }
}

async function getJson<T>(ctx: ExtensionServerCtx, url: string, accessToken: string): Promise<T> {
  const res = await httpOf(ctx)(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'tangen-ext-auth' } })
  if (!res.ok) throw new RequestError('UNAUTHORIZED', 'Failed to read the profile from the provider', 401)
  return res.json() as Promise<T>
}

const expiry = (expiresIn?: number) => (typeof expiresIn === 'number' ? new Date(Date.now() + expiresIn * 1000) : null)

export const realExchange: SsoExchange = async (ctx, cfg, { code, redirectUri }) => {
  const secret = clientSecretOf(ctx, cfg)
  const form = { grant_type: 'authorization_code', client_id: cfg.clientId, client_secret: secret, redirect_uri: redirectUri, code }
  if (cfg.name === 'google') {
    const tokens = await postToken(ctx, ENDPOINTS.google.token, form)
    const u = await getJson<{ id: string; email?: string; verified_email?: boolean; name?: string }>(ctx, ENDPOINTS.google.userinfo, tokens.access_token)
    return { subject: String(u.id), email: u.email ?? null, emailVerified: u.verified_email !== false, name: u.name ?? null, accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? null, expiresAt: expiry(tokens.expires_in) }
  }
  if (cfg.name === 'github') {
    const tokens = await postToken(ctx, ENDPOINTS.github.token, form)
    const u = await getJson<{ id: number; name?: string | null; login: string; email?: string | null }>(ctx, ENDPOINTS.github.userinfo, tokens.access_token)
    let email = u.email ?? null
    let verified = false
    try {
      const emails = await getJson<Array<{ email: string; primary: boolean; verified: boolean }>>(ctx, `${ENDPOINTS.github.userinfo}/emails`, tokens.access_token)
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified)
      if (primary) { email = primary.email; verified = true }
    } catch { /* the scope may not include emails; the public email stands */ }
    return { subject: String(u.id), email, emailVerified: verified, name: u.name ?? u.login ?? null, accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? null, expiresAt: expiry(tokens.expires_in) }
  }
  if (!cfg.issuer) throw new RequestError('INTERNAL', `SSO: the "${providerIdOf(cfg)}" provider declares no issuer`, 500)
  const doc = await discover(ctx, cfg.issuer)
  const tokens = await postToken(ctx, doc.token_endpoint, form)
  let claims: { sub?: string; email?: string; email_verified?: boolean; name?: string; preferred_username?: string } = {}
  if (doc.userinfo_endpoint) claims = await getJson(ctx, doc.userinfo_endpoint, tokens.access_token)
  else if (tokens.id_token) {
    const [, body] = tokens.id_token.split('.')
    if (body) claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  }
  if (!claims.sub) throw new RequestError('UNAUTHORIZED', 'The provider returned no subject', 401)
  return { subject: String(claims.sub), email: claims.email ?? null, emailVerified: claims.email_verified === true, name: claims.name ?? claims.preferred_username ?? null, accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? null, expiresAt: expiry(tokens.expires_in) }
}

let exchange: SsoExchange = realExchange
export const exchangeCode: SsoExchange = (ctx, cfg, input) => exchange(ctx, cfg, input)
/** Test seam: replace the network exchange. */
export function __setSsoExchange(fn: SsoExchange | null): void {
  exchange = fn ?? realExchange
}
