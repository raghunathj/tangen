/**
 * File Name: contract.ts
 * Purpose: The browser-safe Site users contract: the options a site declares
 *          for the extension, the profile field definition, the hooks, the
 *          SSO provider shapes, and the pure helpers both the server and the
 *          admin pages share (field names, SQL types, validation, the
 *          email and phone rules). Sites import `defineAuthOptions` from
 *          `@tangen/ext-auth`.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { FieldConfig, FieldType, SiteUser } from '@tangen/cms'

export type { SiteUser }

// ─── Profile fields ──────────────────────────────────────────────────────────

/** Field types allowed on user profiles: the object field types, minus components. */
export type ProfileFieldType = Exclude<FieldType, 'component'>

/**
 * A profile field: the same shape as an object field. Each becomes a real
 * column on auth_users, added by `tangen push` through the extension's push
 * hook.
 */
export interface ProfileFieldDef {
  /** Column name on auth_users, snake_case. */
  name: string
  label: string
  fieldType: ProfileFieldType
  /** The same FieldConfig as object fields: validation, options, targetType, many, admin.showInList / showInFilter / searchable. */
  config?: FieldConfig
  required?: boolean
  /** Whether the admin may edit it. Default true; false for what only the user writes. */
  adminEditable?: boolean
}

export function validateProfileFieldName(name: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid profile field name: "${name}". Names must be snake_case (lowercase letters, digits, underscores). ` +
      `Try "${name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')}" instead.`,
    )
  }
}

/** The reserved columns of auth_users a profile field may not shadow. */
export const RESERVED_PROFILE_COLUMNS = new Set(['id', 'workspace_id', 'email', 'phone', 'name', 'password_hash', 'role', 'status', 'is_anonymous', 'created_at', 'last_login_at'])

export function profileFieldSqlType(field: ProfileFieldDef): string {
  switch (field.fieldType) {
    case 'number': return 'NUMERIC'
    case 'boolean': return 'BOOLEAN'
    case 'date': return 'DATE'
    case 'json':
    case 'richtext':
    case 'repeater': return 'JSONB'
    case 'multiselect':
    case 'object': return 'TEXT[]'
    case 'relation': return field.config?.many ? 'TEXT[]' : 'TEXT'
    default: return 'TEXT'
  }
}

export interface FieldValidationError { field: string; message: string }

function validateField(field: ProfileFieldDef, value: unknown): string | null {
  const isEmpty = value === undefined || value === null || value === ''
  if (field.required && isEmpty) return `${field.label} is required`
  if (isEmpty) return null
  const v = field.config?.validation
  const ft = field.fieldType
  if (ft === 'text' || ft === 'email' || ft === 'url' || ft === 'phone' || ft === 'textarea') {
    const str = String(value)
    if (v?.minLength && str.length < v.minLength) return `${field.label} must be at least ${v.minLength} characters`
    if (v?.maxLength && str.length > v.maxLength) return `${field.label} must be at most ${v.maxLength} characters`
    if (v?.pattern && !new RegExp(v.pattern).test(str)) return v.messages?.pattern ?? `${field.label} is invalid`
  }
  if (ft === 'number') {
    const num = Number(value)
    if (Number.isNaN(num)) return `${field.label} must be a number`
    if (v?.integer && !Number.isInteger(num)) return `${field.label} must be a whole number`
    if (v?.positiveOnly && num <= 0) return `${field.label} must be positive`
    if (v?.min !== undefined && num < v.min) return `${field.label} must be at least ${v.min}`
    if (v?.max !== undefined && num > v.max) return `${field.label} must be at most ${v.max}`
  }
  if (ft === 'date') {
    const d = new Date(value as string)
    if (Number.isNaN(d.getTime())) return `${field.label} must be a valid date`
    const now = new Date()
    if (v?.pastOnly && d >= now) return `${field.label} must be in the past`
    if (v?.futureOnly && d <= now) return `${field.label} must be in the future`
    if (v?.minDate && d < new Date(v.minDate)) return `${field.label} must be on or after ${v.minDate}`
    if (v?.maxDate && d > new Date(v.maxDate)) return `${field.label} must be on or before ${v.maxDate}`
  }
  if (ft === 'boolean' && v?.requiredAcknowledgement && !value) return `${field.label} must be acknowledged`
  if ((ft === 'multiselect' || ft === 'select') && field.config?.options) {
    const allowed = new Set(field.config.options.map((o) => o.value))
    const vals = Array.isArray(value) ? value : [value]
    for (const val of vals) if (!allowed.has(String(val))) return `${field.label} contains an invalid option`
    if (ft === 'multiselect') {
      if (v?.minSelections && vals.length < v.minSelections) return `${field.label} requires at least ${v.minSelections} selections`
      if (v?.maxSelections && vals.length > v.maxSelections) return `${field.label} allows at most ${v.maxSelections} selections`
    }
  }
  return null
}

/** Validates the profile values present in `incoming` (absent keys are not checked). */
export function validateProfileFields(fields: ProfileFieldDef[], incoming: Record<string, unknown>): FieldValidationError[] {
  const errors: FieldValidationError[] = []
  for (const field of fields) {
    if (!(field.name in incoming)) continue
    const msg = validateField(field, incoming[field.name])
    if (msg) errors.push({ field: field.name, message: msg })
  }
  return errors
}

// ─── Identifiers ─────────────────────────────────────────────────────────────

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** E.164: a plus, a leading digit 1-9, seven to fifteen digits in all. */
export const PHONE_RE = /^\+[1-9]\d{6,14}$/

export function normalizeEmail(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return s && EMAIL_RE.test(s) ? s : null
}

/** Strips spaces, dots, dashes and parentheses; '00' becomes '+'. Null when not E.164 after that. */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let s = value.replace(/[\s().-]/g, '')
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  return PHONE_RE.test(s) ? s : null
}

// ─── SSO ─────────────────────────────────────────────────────────────────────

/** A built-in OAuth provider, or any OpenID Connect issuer. */
export type SsoProviderName = 'google' | 'github' | 'oidc'

export interface SsoProviderConfig {
  name: SsoProviderName
  /**
   * For `oidc`: the id the site uses in URLs (`/sso/okta`), when it runs
   * several. Defaults to `name`.
   */
  id?: string
  /** Shown in the admin. */
  label?: string
  clientId: string
  /**
   * The NAME of the deployment variable holding the client secret (e.g.
   * 'GOOGLE_CLIENT_SECRET'), never the secret itself: the deployment's secret
   * provider resolves it when the code is exchanged.
   */
  clientSecret: string
  scopes?: string[]
  /** `oidc` only: the issuer URL; its discovery document supplies the endpoints. */
  issuer?: string
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export interface AuthHookContext {
  workspaceId: string
  log: (message: string) => void
}

export interface OtpDelivery {
  channel: 'email' | 'sms'
  /** The email address or the E.164 phone number. */
  to: string
  code: string
  /** How long the code stays valid, in seconds. */
  ttlSeconds: number
}

export interface SiteAuthHooks {
  onBeforeRegister?(data: { email: string; name?: string; [k: string]: unknown }, ctx: AuthHookContext): Promise<void> | void
  onAfterRegister?(user: SiteUser, ctx: AuthHookContext): Promise<void> | void
  onBeforeLogin?(credentials: { email: string }, ctx: AuthHookContext): Promise<void> | void
  onAfterLogin?(user: SiteUser, ctx: AuthHookContext): Promise<void> | void
  /**
   * Deliver a one-time code. Without it, email codes go through the
   * workspace mailer and SMS codes through `sms.send`; with it, the hook
   * owns delivery on both channels.
   */
  onOtpSend?(delivery: OtpDelivery, ctx: AuthHookContext): Promise<void> | void
  /** Deliver a password reset token. Without it, the workspace mailer sends a plain message carrying the token. */
  onPasswordResetRequest?(email: string, token: string, ctx: AuthHookContext): Promise<void> | void
  /** Replace the default Argon2id hashing. */
  hashPassword?(password: string): Promise<string>
  verifyPassword?(password: string, hash: string): Promise<boolean>
  /** Add claims to the access token. */
  buildTokenPayload?(user: SiteUser, base: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>
}

// ─── Options ─────────────────────────────────────────────────────────────────

/** The options a site declares on the extension's entry in app/config/extensions.ts. */
export interface AuthOptions {
  providers?: SsoProviderConfig[]
  /** Each entry becomes a real column on auth_users (added by `tangen push`). */
  profileFields?: ProfileFieldDef[]
  hooks?: SiteAuthHooks
  token?: {
    /** Access JWT TTL. Default '15m'. */
    accessTtl?: string
    /** Refresh token TTL. Default '30d'. */
    refreshTtl?: string
  }
  /** The roles this site hands out. Default ['user', 'moderator', 'admin']. */
  roles?: string[]
  /** Whether new users may register with email and password. Default true. */
  allowRegistration?: boolean
  /** Whether guest sessions may be opened. Default false. */
  allowAnonymous?: boolean
  /** Where an SSO sign-in lands, with `accessToken` and `refreshToken` appended. Without it the callback answers JSON. */
  ssoRedirectUrl?: string
  otp?: {
    /** Which channels may receive a code. Default ['email']. */
    channels?: Array<'email' | 'sms'>
    /** Default 600. */
    ttlSeconds?: number
    /** Whether a code may create the account it is for. Default true. */
    allowSignup?: boolean
  }
  /** The SMS sender for phone codes. Required for the 'sms' channel unless `hooks.onOtpSend` delivers. */
  sms?: { send(to: string, message: string): Promise<void> | void }
  /** Subject and sender for the codes and reset messages the workspace mailer sends. */
  mail?: { fromEmail?: string; fromName?: string; otpSubject?: string; resetSubject?: string }
}

export const DEFAULT_SITE_ROLES = ['user', 'moderator', 'admin'] as const

type AssertSnakeCase<S extends string> = Lowercase<S> extends S ? S : `field name must be snake_case - "${S}" should be "${Lowercase<S>}"`

/** Type-safe helper for the extension's options: a camelCase profile field name is rejected at compile time. */
export function defineAuthOptions<const F extends readonly ProfileFieldDef[]>(
  options: Omit<AuthOptions, 'profileFields'> & {
    profileFields?: { [I in keyof F]: F[I] extends { name: infer N extends string } ? Omit<F[I], 'name'> & { name: AssertSnakeCase<N> } : F[I] }
  },
): AuthOptions {
  return options as AuthOptions
}

/** The public description of a workspace's sign-in setup (what the admin's Sign-in methods page shows). */
export interface SignInMethods {
  password: { enabled: boolean; registration: boolean }
  otp: { channels: Array<'email' | 'sms'>; smsConfigured: boolean; delivery: 'hook' | 'mailer' }
  sso: Array<{ id: string; name: SsoProviderName; label: string; configured: boolean }>
  anonymous: boolean
  roles: string[]
  profileFields: ProfileFieldDef[]
  token: { accessTtl: string; refreshTtl: string }
  ssoRedirectUrl: string | null
}
