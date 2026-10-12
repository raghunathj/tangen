/**
 * File Name: pipeline.ts
 * Purpose: Form processing pipeline pieces that need the server — duplicate
 * submission detection and captcha verification. Condition evaluation and
 * validation live in @tangen/types form-logic (single source shared with the
 * admin preview and the embed runtime) and are re-exported here for
 * back-compatibility.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types; verifyCaptchaToken makes outbound HTTP
 * calls to captcha provider APIs.
 */
import type { FormField, FormSettings } from './contract'
import { isFieldVisible } from './contract'

// ── Shared logic re-exports (single source: @tangen/types form-logic) ────────
export {
  evaluateCondition, evaluateShowIf, isConditionGroup, isFieldVisible,
  isStepVisible, validateField, validateForm,
  DEFAULT_FORM_MESSAGES,
} from './contract'
export type { ValidationResult, FormMessages, ValidateFormOptions } from './contract'

/**
 * Back-compat alias — field-level visibility (own showIf only).
 */
export function isVisible(field: FormField, data: Record<string, unknown>): boolean {
  return isFieldVisible(field, data)
}

// ─── Unique submission check ──────────────────────────────────────────────────

/**
 * Checks whether an incoming submission duplicates an existing one based on the form's
 * uniqueness strategy — either by submitter IP address or by a specific field value.
 * @param settings - Form settings slice providing uniqueBy and uniqueField config.
 * @param data - Key/value map of the incoming submission data.
 * @param existingSubmissions - Previously stored submissions to check against.
 * @param ipAddress - Resolved IP address of the submitter.
 * @returns A human-readable duplicate error string, or null when no duplicate is found.
 */
export function checkUniqueSubmission(
  settings: Pick<FormSettings, 'uniqueBy' | 'uniqueField'>,
  data: Record<string, unknown>,
  existingSubmissions: Array<{ data: Record<string, unknown>; ipAddress?: string | null }>,
  ipAddress: string,
): string | null {
  const { uniqueBy, uniqueField } = settings
  if (!uniqueBy) return null

  if (uniqueBy === 'ip') {
    const dup = existingSubmissions.some((s) => s.ipAddress === ipAddress)
    return dup ? 'You have already submitted this form' : null
  }

  if (uniqueBy === 'field' && uniqueField) {
    const submittedValue = data[uniqueField]
    const dup = existingSubmissions.some(
      (s) => s.data[uniqueField] !== undefined && s.data[uniqueField] === submittedValue,
    )
    return dup ? 'You have already submitted this form' : null
  }

  return null
}

// ─── Captcha verification ─────────────────────────────────────────────────────

export interface CaptchaVerifyResult {
  success: boolean
  score?: number
  error?: string
}

/**
 * Verifies a captcha response token against the chosen provider's server-side API.
 * Supports recaptcha_v2, recaptcha_v3 (with score threshold), hcaptcha, and turnstile.
 * @param provider - Captcha provider identifier (e.g. "recaptcha_v3", "turnstile").
 * @param secretKey - Server-side secret key for the captcha provider.
 * @param token - The captcha response token submitted by the client.
 * @param minScore - Minimum acceptable score for reCAPTCHA v3 (0.0–1.0); ignored for others.
 * @returns CaptchaVerifyResult with success flag, optional score, and optional error message.
 */
export async function verifyCaptchaToken(
  provider: string,
  secretKey: string,
  token: string,
  minScore?: number,
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): Promise<CaptchaVerifyResult> {
  const endpoints: Record<string, string> = {
    recaptcha_v2: 'https://www.google.com/recaptcha/api/siteverify',
    recaptcha_v3: 'https://www.google.com/recaptcha/api/siteverify',
    hcaptcha: 'https://hcaptcha.com/siteverify',
    turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  }
  const url = endpoints[provider]
  if (!url) return { success: false, error: `Unknown captcha provider: ${provider}` }
  // E.8: the call goes through the extension's ctx.http (network:any); no bare fetch.
  if (!fetchImpl) return { success: false, error: 'Captcha verification needs the network:any grant (ctx.http)' }

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secretKey, response: token }).toString(),
    })
    const json = await res.json() as Record<string, unknown>
    const success = json.success === true
    const score = typeof json.score === 'number' ? json.score : undefined

    if (success && provider === 'recaptcha_v3' && minScore !== undefined && score !== undefined) {
      if (score < minScore) return { success: false, score, error: 'Captcha score too low' }
    }

    return { success, score, error: success ? undefined : String((json['error-codes'] as string[])?.[0] ?? 'Verification failed') }
  } catch (err) {
    return { success: false, error: 'Captcha verification request failed' }
  }
}
