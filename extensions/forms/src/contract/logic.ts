/**
 * File Name: form-logic.ts
 * Purpose: THE single implementation of form condition evaluation and
 *          validation — consumed by the API pipeline, the admin builder
 *          preview, and the embed client runtime (bundled). Pure and
 *          dependency-free so it can run anywhere.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: message strings come from a catalog so client-facing
 *          validation localizes ({label}/{n} placeholders); the default
 *          catalog is English.
 */
import type {
  FormField, FormFieldCondition, FormConditionGroup, ShowIf, FormStep,
  FormSettings, FormNotification, FormConfirmation,
} from './types'
import { isValuelessField } from './types'
import { isPlausiblePhone } from './phone'

// ─── Condition evaluation ─────────────────────────────────────────────────────

/**
 * Evaluates a single condition against a submitted data map.
 * Unknown operators evaluate to true (fail open — the field stays visible).
 */
export function evaluateCondition(
  condition: FormFieldCondition,
  data: Record<string, unknown>,
): boolean {
  const raw = data[condition.field]
  const val = raw === undefined || raw === null ? '' : String(raw)
  const cmpVal = condition.value === undefined ? '' : String(condition.value)

  switch (condition.operator) {
    case 'equals': return val === cmpVal
    case 'not_equals': return val !== cmpVal
    case 'contains': return val.includes(cmpVal)
    case 'not_contains': return !val.includes(cmpVal)
    case 'is_empty': return val === ''
    case 'is_not_empty': return val !== ''
    default: return true
  }
}

/** Structural check: groups carry a `logic` key, single conditions don't. */
export function isConditionGroup(showIf: ShowIf): showIf is FormConditionGroup {
  return typeof showIf === 'object' && showIf !== null && 'logic' in showIf
}

/**
 * Evaluates a visibility rule — a legacy single condition or an and/or group
 * (nestable). Empty groups are vacuously true.
 */
export function evaluateShowIf(showIf: ShowIf, data: Record<string, unknown>): boolean {
  if (!isConditionGroup(showIf)) return evaluateCondition(showIf, data)
  if (showIf.conditions.length === 0) return true
  const results = showIf.conditions.map((c) =>
    isConditionGroup(c) ? evaluateShowIf(c, data) : evaluateCondition(c, data))
  return showIf.logic === 'or' ? results.some(Boolean) : results.every(Boolean)
}

/** A step without a showIf is always visible. */
export function isStepVisible(step: FormStep, data: Record<string, unknown>): boolean {
  if (!step.showIf) return true
  return evaluateShowIf(step.showIf, data)
}

/**
 * Whether a field should be shown (and validated): its own showIf AND — when
 * steps are provided and the field belongs to one — its step's visibility.
 */
/** Groups fields into steps; fields without a stepId belong to the first step. A form without steps is one group. */
export function fieldsByStep(fields: FormField[], steps: FormStep[] | undefined): { step: FormStep; fields: FormField[] }[] {
  if (!steps || steps.length === 0) return [{ step: { id: '__single' }, fields }]
  const first = steps[0]!.id
  return steps.map((step) => ({
    step,
    fields: fields.filter((f) => (f.stepId ?? first) === step.id),
  }))
}

export function isFieldVisible(
  field: FormField,
  data: Record<string, unknown>,
  steps?: FormStep[],
): boolean {
  if (field.showIf && !evaluateShowIf(field.showIf, data)) return false
  if (steps && field.stepId) {
    const step = steps.find((s) => s.id === field.stepId)
    if (step && !isStepVisible(step, data)) return false
  }
  return true
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Client-facing validation strings — `{label}` and `{n}` interpolate. Serve a
 * translated catalog to localize both server responses and the embed runtime.
 */
export interface FormMessages {
  required: string
  email: string
  phone: string
  minLength: string
  maxLength: string
  number: string
  min: string
  max: string
  patternInvalid: string
}

export const DEFAULT_FORM_MESSAGES: FormMessages = {
  required: '{label} is required',
  email: 'Please enter a valid email address',
  phone: 'Please enter a valid phone number',
  minLength: '{label} must be at least {n} characters',
  maxLength: '{label} must be at most {n} characters',
  number: '{label} must be a number',
  min: '{label} must be at least {n}',
  max: '{label} must be at most {n}',
  patternInvalid: '{label} format is invalid',
}

function msg(template: string, label: string, n?: number | string): string {
  return template.replace('{label}', label).replace('{n}', String(n ?? ''))
}

/**
 * Validates a single submitted value against a field's rules.
 * @returns A human-readable error string, or null when validation passes.
 */
export function validateField(
  field: FormField,
  value: unknown,
  messages: FormMessages = DEFAULT_FORM_MESSAGES,
): string | null {
  const str = value === undefined || value === null ? '' : String(value)
  const isEmpty = str === ''
  const v = field.validation
  // The field's own wording for a rule wins over the form-wide catalog.
  const own: Partial<Record<string, string>> = v?.messages ?? {}
  const say = (key: Exclude<keyof FormMessages, 'patternInvalid'>, n?: number | string) => msg(own[key] ?? messages[key], field.label, n)

  if (field.required && isEmpty) return say('required')
  if (isEmpty) return null // optional empty field always passes

  if (field.type === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) return say('email')
  }

  if (field.type === 'phone') {
    if (!isPlausiblePhone(str)) return say('phone')
  }

  if (v) {
    if (v.minLength !== undefined && str.length < v.minLength) {
      return say('minLength', v.minLength)
    }
    if (v.maxLength !== undefined && str.length > v.maxLength) {
      return say('maxLength', v.maxLength)
    }
    if (v.pattern) {
      if (!new RegExp(v.pattern).test(str)) {
        const custom = own.pattern ?? v.patternMessage
        return custom ? msg(custom, field.label) : msg(messages.patternInvalid, field.label)
      }
    }
    if (field.type === 'number') {
      const num = Number(str)
      if (isNaN(num)) return say('number')
      if (v.min !== undefined && num < v.min) return say('min', v.min)
      if (v.max !== undefined && num > v.max) return say('max', v.max)
    }
  }

  return null
}

export interface ValidationResult {
  valid: boolean
  errors: Record<string, string>
}

export interface ValidateFormOptions {
  /** Multi-step layout — fields on hidden steps are skipped like hidden fields. */
  steps?: FormStep[]
  /** Localized message catalog (defaults to English). */
  messages?: FormMessages
}

/**
 * Runs full form validation across all visible fields; fields hidden by their
 * own showIf or by a hidden step are skipped entirely.
 */
export function validateForm(
  fields: FormField[],
  data: Record<string, unknown>,
  opts: ValidateFormOptions = {},
): ValidationResult {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    if (isValuelessField(field.type)) continue // html/image/submit hold no value
    if (!isFieldVisible(field, data, opts.steps)) continue
    const err = validateField(field, data[field.name], opts.messages)
    if (err) errors[field.name] = err
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

/**
 * Resolve the submit button's text + class. A `submit` field (FL-3) overrides
 * `settings.submitButtonText/Class`; when absent, the settings values are used
 * (backward-compatible), defaulting to "Submit". Only the first submit field
 * is honoured.
 */
export function resolveSubmitButton(
  fields: FormField[],
  settings: Pick<FormSettings, 'submitButtonText' | 'submitButtonClass' | 'submitButtonWidth'>,
): { text: string; className?: string; width?: 'full' | 'auto' } {
  const submit = fields.find((f) => f.type === 'submit')
  return {
    text: submit?.label || settings.submitButtonText || 'Submit',
    className: submit?.className ?? settings.submitButtonClass,
    width: settings.submitButtonWidth,
  }
}

// ─── Confirmations ────────────────────────────────────────────────────────────

export interface ResolvedConfirmation {
  title?: string
  message: string
  redirect?: string
  redirectDelaySeconds?: number
}

/**
 * Picks the confirmation for a submission: the first conditional one whose
 * showIf matches, else the conditionless default, else the legacy
 * successTitle/Message/Redirect fields, else a bare thank-you.
 */
/**
 * A confirmation redirect that is safe to navigate to, or null.
 *
 * `embed/runtime.ts` does `window.top!.location.href = conf.redirect` - the TOP
 * frame, so the appless/iframe isolation does not contain it, and the
 * navigation happens on the SITE's origin. `redirectUrl` was declared as a
 * bare `{ type: 'string' }` with no scheme check anywhere, so a member holding
 * `forms:manage` could store `javascript:...` and have it execute for every
 * visitor who submitted the form. Stored XSS on the production website,
 * authored through an ordinary content capability.
 *
 * Allowed: a relative path (`/thanks`), or an absolute `http:` / `https:` URL -
 * an external thank-you page is a legitimate thing to want. Everything else is
 * refused, protocol-relative `//host` among it: it is an unnecessary way to
 * write a cross-origin target when `https://` says it plainly.
 *
 * The scheme is read from a copy with C0 control characters and spaces removed,
 * because `java\tscript:` and `java\nscript:` are the same URL to a browser
 * and a different string to a naive check.
 *
 * This is the same stance the platform already takes in
 * `extensions/seo/src/lib/canonical.ts` (ALLOWED_SCHEMES) and in Studio's
 * `safeHref`. The forms contract runs on the server, in the admin preview and
 * in the embed runtime, so putting it here is what makes all three agree.
 */
export function safeRedirectTarget(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null

  // Same-document relative target. `//host` is NOT this.
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw

  const stripped = raw.replace(/[\u0000-\u0020]/g, '').toLowerCase()
  if (!/^https?:\/\//.test(stripped)) return null

  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? raw : null
  } catch {
    return null
  }
}

export function pickConfirmation(
  settings: Partial<FormSettings>,
  data: Record<string, unknown>,
): ResolvedConfirmation {
  const list = (settings.confirmations ?? []) as FormConfirmation[]
  const match = list.find((c) => c.showIf && evaluateShowIf(c.showIf, data))
    ?? list.find((c) => !c.showIf)
  if (match) {
    return {
      title: match.title,
      message: match.message ?? 'Thank you for your submission!',
      // An unsafe target is dropped, not passed on: the response is what the
      // embed navigates to, and runtime.js is served
      // `immutable, max-age=31536000`, so a client-side guard alone would take
      // a year to reach deployed sites.
      ...(match.type === 'redirect' && safeRedirectTarget(match.redirectUrl)
        ? { redirect: safeRedirectTarget(match.redirectUrl)!, ...(match.redirectDelaySeconds ? { redirectDelaySeconds: match.redirectDelaySeconds } : {}) }
        : {}),
    }
  }
  return {
    title: (settings as { successTitle?: string }).successTitle,
    message: settings.successMessage ?? 'Thank you for your submission!',
    ...(settings.successRedirect ? { redirect: settings.successRedirect } : {}),
  }
}

// ─── Notifications: conditions, routing, merge tags ───────────────────────────

/** Replaces {field} tags with submitted values; unknown tags become ''. */
export function interpolateMergeTags(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = data[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

/**
 * Recipients for one notification: null when its showIf fails (skip
 * entirely); otherwise the first matching routing rule's address, falling
 * back to `to`. Merge tags resolve from the submission; addresses that
 * resolve empty are dropped.
 */
export function notificationRecipients(
  notification: FormNotification,
  data: Record<string, unknown>,
): string[] | null {
  if (notification.showIf && !evaluateShowIf(notification.showIf, data)) return null
  const route = (notification.routing ?? []).find((r) => evaluateShowIf(r.showIf, data))
  const raw = route?.to ?? notification.to
  const resolved = interpolateMergeTags(raw, data).trim()
  return resolved && resolved.includes('@') ? [resolved] : []
}

// ─── Scheduling & entry limits ────────────────────────────────────────────────

export type FormAvailability = 'open' | 'not_yet' | 'closed'

/** Where a form sits relative to its schedule window. */
export function formAvailability(
  schedule: { opensAt?: string; closesAt?: string } | undefined,
  now: Date = new Date(),
): FormAvailability {
  if (!schedule) return 'open'
  if (schedule.opensAt && now < new Date(schedule.opensAt)) return 'not_yet'
  if (schedule.closesAt && now >= new Date(schedule.closesAt)) return 'closed'
  return 'open'
}

/**
 * UTC start of the calendar window an entry limit counts within.
 * 'total' has no window (count everything) → null.
 */
export function entryLimitWindowStart(
  period: 'total' | 'day' | 'week' | 'month' | 'year',
  now: Date = new Date(),
): Date | null {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate()
  switch (period) {
    case 'total': return null
    case 'day': return new Date(Date.UTC(y, m, d))
    case 'week': {
      const dow = now.getUTCDay() // 0 = Sunday
      const diff = dow === 0 ? 6 : dow - 1 // back to Monday
      return new Date(Date.UTC(y, m, d - diff))
    }
    case 'month': return new Date(Date.UTC(y, m, 1))
    case 'year': return new Date(Date.UTC(y, 0, 1))
  }
}
