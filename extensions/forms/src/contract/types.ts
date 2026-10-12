/**
 * File Name: forms.ts
 * Purpose: Form schema types (fields, validation, settings, hooks) for the Tangen Forms extension.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None — standalone type definitions with no external imports.
 */

/**
 * Supported input types for form field definitions.
 */
export type FormFieldType =
  | 'text' | 'textarea' | 'email' | 'phone' | 'number' | 'date'
  | 'select' | 'multiselect' | 'radio' | 'checkbox' | 'file' | 'hidden'
  // Presentational / layout fields — carry NO submission value:
  | 'html' | 'image'
  // Interaction field — the submit control; no value, rendered as the nav button.
  | 'submit'

/**
 * Presentational fields render inline content but hold no value (html/image).
 * `submit` is NOT presentational — it configures the nav submit button.
 */
export function isPresentationalField(type: FormFieldType): boolean {
  return type === 'html' || type === 'image'
}

/**
 * A field that carries no submission value — excluded from validation and the
 * stored `data`. Presentational fields plus the submit control.
 */
export function isValuelessField(type: FormFieldType): boolean {
  return isPresentationalField(type) || type === 'submit'
}

/**
 * Which "Default value" control the builder shows for a field type (`'none'` = the
 * field can't hold a pre-fillable default: valueless fields + file uploads). Drives
 * the builder control and mirrors what the embed runtime applies. Unset default =
 * nothing pre-filled/checked.
 */
export type DefaultControlKind = 'text' | 'number' | 'date' | 'option' | 'multiOption' | 'checkbox' | 'none'
export function defaultValueControlKind(type: FormFieldType): DefaultControlKind {
  switch (type) {
    case 'number': return 'number'
    case 'date': return 'date'
    case 'select':
    case 'radio': return 'option'
    case 'multiselect': return 'multiOption'
    case 'checkbox': return 'checkbox'
    // no default for valueless (html/image/submit) or file uploads
    case 'html':
    case 'image':
    case 'submit':
    case 'file': return 'none'
    // text, textarea, email, phone, hidden
    default: return 'text'
  }
}

/**
 * Comparison operators used in conditional visibility rules for form fields.
 */
export type FieldOperator =
  | 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty'

/**
 * A single option entry for select, multiselect, or radio form fields.
 */
export interface FormFieldOption {
  label: string
  value: string
}

/**
 * Validation constraints that can be applied to a form field value.
 */
/** The rules a field may word its own message for; `{label}` and `{n}` fill in as in the form-wide catalog. */
export type FieldMessageKey = 'required' | 'email' | 'phone' | 'minLength' | 'maxLength' | 'number' | 'min' | 'max' | 'pattern'

export interface FormFieldValidation {
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  pattern?: string
  /** The pattern's message. Older definitions; `messages.pattern` is the same thing and wins. */
  patternMessage?: string
  /** This field's own message per rule, over the form-wide catalog (Settings > Texts). Translatable per locale. */
  messages?: Partial<Record<FieldMessageKey, string>>
  fileTypes?: string[]   // e.g. ['image/*', '.pdf']
  maxFileSize?: number   // bytes
}

/**
 * Conditional visibility rule — the field is shown only when another field satisfies this condition.
 */
export interface FormFieldCondition {
  field: string
  operator: FieldOperator
  value?: unknown
}

/**
 * A boolean group of conditions (and/or), nestable — `(a AND b) OR c` etc.
 */
export interface FormConditionGroup {
  logic: 'and' | 'or'
  conditions: Array<FormFieldCondition | FormConditionGroup>
}

/**
 * Visibility rule for a field or step: a legacy single condition or a group.
 * Detected structurally — groups carry a `logic` key.
 */
export type ShowIf = FormFieldCondition | FormConditionGroup

/**
 * One step (page) of a multi-step form. Forms without steps behave as a
 * single implicit step. Persisted inside `FormSettings.steps`.
 */
export interface FormStep {
  id: string
  title?: string
  description?: string
  /** Custom "Next" button text for this step (localizable); default "Next". */
  nextButtonText?: string
  /** The step (and every field on it) renders only when this holds. */
  showIf?: ShowIf
}

/**
 * Declarative dynamic options — the server fills a choice field's options from
 * content at render/submit time (TangenQL under the hood, cached).
 */
export interface FormFieldOptionsFrom {
  source: 'content'
  /** Content type to query (published objects). */
  type: string
  /** Field used as the option label (default: title). */
  labelField?: string
  /** Field used as the option value (default: id). */
  valueField?: string
  /** Optional TangenQL filter object. */
  filter?: Record<string, unknown>
  /** Sort field (default: title asc). */
  sort?: string
  /** Max options (server clamps; default 100). */
  limit?: number
}

/**
 * The phone field's optional country-code dropdown. When `countryCode` is on,
 * a dial-code select sits before the number and the stored value is
 * "<dial> <number>" (e.g. "+91 98765 43210").
 */
export interface PhoneFieldConfig {
  /** Show a country-code (dial code) dropdown before the number. */
  countryCode?: boolean
  /** ISO 3166-1 alpha-2 codes to offer, in this order; empty/unset = every country. */
  countries?: string[]
  /** ISO code selected when the form opens; falls back to the first offered. */
  defaultCountry?: string
}

/**
 * A single field definition within a form, including its type, validation, and display options.
 */
export interface FormField {
  id: string
  type: FormFieldType
  name: string
  label: string
  placeholder?: string
  helpText?: string
  required?: boolean
  defaultValue?: unknown
  options?: FormFieldOption[]      // select / multiselect / radio
  /** Load options from a data source instead of the static list. */
  optionsFrom?: FormFieldOptionsFrom
  validation?: FormFieldValidation
  showIf?: ShowIf
  /** Step this field belongs to (multi-step forms); unset = the implicit first step. */
  stepId?: string
  width?: 'full' | 'half'
  /** Shown as a column of the submissions list (with nothing flagged, the first three value fields are). */
  showInList?: boolean
  className?: string               // custom CSS classes applied to the field wrapper
  /** Presentational HTML content (type 'html') — author-trusted, localizable. */
  content?: string
  /** Image source URL (type 'image') — a media-asset URL or an external URL.
   *  Alt text uses the field `label` (already localizable). */
  imageSrc?: string
  /** Phone field only: the country-code dropdown. */
  phone?: PhoneFieldConfig
}

/**
 * Supported CAPTCHA providers for form spam protection.
 */
export type CaptchaProvider = 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'turnstile'
/**
 * Transactional email services supported for sending form notification emails.
 */
export type MailService = 'smtp' | 'sendgrid' | 'resend'
/**
 * Strategy for deduplicating form submissions to prevent repeated entries.
 */
export type UniqueBy = 'field' | 'ip' | 'session' | null

/**
 * Email notification sent to an administrator when a form submission is received.
 */
export interface FormNotification {
  id?: string
  name?: string
  /** Recipient — {field} merge tags resolve from the submission (e.g. '{email}' = the submitter). */
  to: string
  subject?: string     // custom subject line
  body?: string        // custom body - supports {field_name} placeholders; auto-generated if omitted
  replyTo?: string     // reply-to header - merge tags supported
  /** 'html' (default — text + styled HTML parts) or 'text' (plain text only). */
  format?: 'html' | 'text'
  /** Send only when this matches the submission. */
  showIf?: ShowIf
  /** Conditional routing — the first matching rule's address replaces `to`. */
  routing?: NotificationRoute[]
}

/**
 * CAPTCHA provider configuration for a form.
 */
export interface FormCaptchaConfig {
  provider: CaptchaProvider
  siteKey: string
  secretKey: string   // write-only - never returned to browser
  minScore?: number   // reCAPTCHA v3 only (0–1)
}

/**
 * A webhook fired (queued, with retries) on every accepted submission.
 */
export interface FormWebhook {
  url: string
  /** Extra request headers (e.g. auth). */
  headers?: Record<string, string>
  /** Sent as X-Tangen-Secret so receivers can verify origin. */
  secret?: string
}

/**
 * One confirmation shown after submission — pick by conditional logic; the
 * conditionless one is the default. type 'redirect' may delay after showing
 * the message.
 */
export interface FormConfirmation {
  id: string
  name: string
  type: 'message' | 'redirect'
  title?: string
  /** HTML allowed — same trust level as successMessage. */
  message?: string
  redirectUrl?: string
  redirectDelaySeconds?: number
  /** Absent = the default confirmation. */
  showIf?: ShowIf
}

/** One notification routing rule — first match supplies the recipient. */
export interface NotificationRoute {
  showIf: ShowIf
  to: string
}

/**
 * Per-form settings — notifications, deduplication, success messaging, and styling.
 */
export interface FormSettings {
  notifications: FormNotification[]
  uniqueBy: UniqueBy
  uniqueField?: string    // which field name to dedup on when uniqueBy === 'field'
  /** Multi-step layout — ordered steps; absent = single-step form. */
  steps?: FormStep[]
  /** Webhooks fired on accepted submissions (queued with retries). */
  webhooks?: FormWebhook[]
  /** Thank-you screen heading (rich successMessage renders beneath). */
  successTitle?: string
  successMessage?: string
  successRedirect?: string
  /** Submit button label (default: Submit) — localizable. */
  submitButtonText?: string
  submitButtonClass?: string
  /** Default submit button fill — 'full' stretches to 100%, 'auto' hugs its
   *  content. Applies to the settings-derived button (a Submit field controls
   *  its own layout width). */
  submitButtonWidth?: 'full' | 'auto'
  /** Styled-embed CSS appended after the base stylesheet. */
  customCss?: string
  /** Shown under the form name on embeds and in the admin. */
  description?: string
  /** Where field labels render (default: top). 'hidden' keeps aria-labels. */
  labelPlacement?: 'top' | 'left' | 'hidden'
  /** Where helpText renders relative to the input (default: below_input). */
  descriptionPlacement?: 'below_label' | 'below_input'
  /** Inline per-field errors (default) or a summary block at the top. */
  validationPlacement?: 'inline' | 'summary'
  /** Extra class on the rendered <form> element. */
  wrapperClass?: string
  /** Availability window — closed forms reject with the configured message. */
  schedule?: { opensAt?: string; closesAt?: string; notYetOpenMessage?: string; closedMessage?: string }
  /** Cap accepted entries within a calendar window. */
  entryLimit?: { max: number; period: 'total' | 'day' | 'week' | 'month' | 'year'; limitMessage?: string }
  /** Spam honeypot on rendered embeds (default true). */
  honeypot?: boolean
  /** Personal-data handling — IP storage and retention. */
  personalData?: { storeIp?: boolean; retentionDays?: number }
  /** Conditional confirmations — first matching wins; conditionless = default. */
  confirmations?: FormConfirmation[]
  /** Embed hardening — iframe origin allow-list and API-key gating. */
  embed?: FormEmbedSettings
  /** Remember what the visitor typed in localStorage and restore it on reload
   *  (cleared on successful submit). Opt-in — the draft may hold PII. */
  rememberDraft?: boolean
}

/**
 * Embed + access hardening for a form. `allowedDomains` limits which origins
 * may iframe the embed pages (CSP frame-ancestors — direct URL opens still
 * work); `requireApiKey` gates schema reads and submissions behind a tgn_
 * API key carrying the forms permission.
 */
export interface FormEmbedSettings {
  /** Origins allowed to iframe this form, e.g. "https://example.com". Empty = anyone. */
  allowedDomains?: string[]
  /** Require an API key (forms: read/submit) on the schema and submit endpoints. */
  requireApiKey?: boolean
}

/**
 * Workspace-level Forms app settings — the notification sender override and
 * the global CAPTCHA config. Mail transport and credentials are the
 * workspace's `mail.*` configuration, never stored here.
 */
export interface FormAppSettings {
  fromEmail?: string
  fromName?: string
  captcha?: FormCaptchaConfig
}

/**
 * A persisted form definition stored in the database, including its fields and settings.
 */
export interface FormRecord {
  id: string
  workspaceId: string
  name: string
  slug: string
  /** 'admin' (built in the UI) or 'code' (app/forms - read-only in the builder). */
  source?: 'admin' | 'code' | string
  /** Accepting public submissions. */
  isLive?: boolean
  fields: FormField[]
  settings: FormSettings
  createdAt: string | Date
  updatedAt: string | Date
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/**
 * Context passed to every form lifecycle hook function.
 */
export interface FormHookContext {
  workspaceId: string
  ipAddress?: string
}

/**
 * Hook called before a form submission is persisted; may return modified data or throw to reject.
 */
export type BeforeSubmitHook = (
  data: Record<string, unknown>,
  form: FormRecord,
  ctx: FormHookContext,
) => Promise<Record<string, unknown>> | Record<string, unknown>

/**
 * Hook called after a form submission is successfully saved to the database.
 */
export type AfterSubmitHook = (
  submission: { id: string; data: Record<string, unknown> },
  form: FormRecord,
  ctx: FormHookContext,
) => Promise<void> | void

/**
 * Hook called after the notification email has been dispatched for a form submission.
 */
export type AfterMailSentHook = (
  submission: { id: string; data: Record<string, unknown> },
  form: FormRecord,
  ctx: FormHookContext,
) => Promise<void> | void

/**
 * Collection of lifecycle hooks for a single form slug — attach logic before/after submission.
 */
export interface FormHookSet {
  beforeSubmit?: BeforeSubmitHook
  afterSubmit?: AfterSubmitHook
  afterMailSent?: AfterMailSentHook
}

/** Keyed by form slug */
export type FormHooks = Record<string, FormHookSet>
