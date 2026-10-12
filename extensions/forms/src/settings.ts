/**
 * File Name: forms-settings.ts
 * Purpose: Resolves the effective mail + captcha settings for the Forms
 *   feature. Code config (app/config/forms.ts — FormsConfig.mail/captcha)
 *   wins; blocks absent from config fall back to the legacy
 *   form_app_settings DB row (deprecated — logged once per boot).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types (FormsConfig, FormAppSettings). Secrets in
 *   config are plain values sourced from env vars by the site's config file.
 */
import type { FormAppSettings, FormCaptchaConfig } from './contract'

/** The options a site declares for the extension: code-first form definitions and hooks only. Sender and captcha are manifest settings (E.8). */
export interface FormsOptions {
  forms?: unknown[]
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/**
 * The flat manifest settings the operator saved, in the shape the pipeline
 * reads: a sender override only (never a transport), and a captcha block
 * only when a provider is chosen.
 */
export function appSettingsFromValues(values: Record<string, unknown> | undefined): FormAppSettings {
  const v = values ?? {}
  const out: FormAppSettings = {}
  const fromEmail = str(v.fromEmail); if (fromEmail) out.fromEmail = fromEmail
  const fromName = str(v.fromName); if (fromName) out.fromName = fromName
  const provider = str(v.captchaProvider) as FormCaptchaConfig['provider'] | undefined
  if (provider) {
    const captcha: FormCaptchaConfig = { provider, siteKey: str(v.captchaSiteKey) ?? '', secretKey: str(v.captchaSecretKey) ?? '' }
    if (typeof v.captchaMinScore === 'number') captcha.minScore = v.captchaMinScore
    out.captcha = captcha
  }
  return out
}
