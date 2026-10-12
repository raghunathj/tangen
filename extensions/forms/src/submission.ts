/**
 * File Name: form-submission.ts
 * Purpose: THE form submission pipeline — honeypot, captcha, validation
 *   (condition- and step-aware), dedupe, beforeSubmit hook, persistence, and
 *   queued after-work (email notifications, webhooks, afterSubmit hooks).
 *   Both public submit routes (embed + api/v1) are thin wrappers around this.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: heavy work never blocks the response — afterSubmit hooks
 *   and notifications run as BullMQ jobs (services/form-queue) with retries;
 *   only beforeSubmit is synchronous because it may mutate or reject.
 */
import { eq, and, gte, count } from 'drizzle-orm'
import { formSubmissions } from './tables'
import { randomUUID } from 'node:crypto'
import type { FormField, FormSettings, FormAppSettings, FormRecord, FormHooks, FormMessages } from './contract'
import { validateForm, pickConfirmation, notificationRecipients, interpolateMergeTags, formAvailability, entryLimitWindowStart } from './contract'
import { RequestError } from './errors'
import { checkUniqueSubmission, verifyCaptchaToken } from './pipeline'
import type { FormJobData } from './jobs'
import { validateOptionMembership } from './options'

/** Hidden spam-trap input rendered by embeds; bots that fill it get a fake success. */
export const HONEYPOT_FIELD = '_hp'

export interface SubmissionDeps {
  db: any
  /** Workspace-level mail + captcha settings (resolved by the caller). */
  appSettings: FormAppSettings | Record<string, never>
  /** Lifecycle hooks for this form's slug (workspace config / behavior registry). */
  hooks: Partial<FormHooks[string]>
  /** Job sink - the extension's tasks (`ctx.enqueue`); absent means the after-work is dropped (tests). */
  enqueue?: (job: FormJobData) => Promise<void>
  /** Entry-limit counter — injectable for tests; defaults to a count query. */
  countSubmissions?: (formId: string, workspaceId: string, windowStart: Date | null) => Promise<number>
  /**
   * Where `form.submitted` goes. It is announced HERE, once, for every route
   * that accepts a submission - the keyed one and the public embed. It used to
   * be emitted by the keyed route alone, so a form on a real website triggered
   * no flow and no webhook, which is the only path a public site has.
   */
  eventBus?: { emit: (event: Record<string, unknown>) => void }
  /** Outbound HTTP for captcha verification: the extension's `ctx.http` (network grants). Absent = captcha cannot verify, the submission is refused. */
  http?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

export interface SubmissionMeta {
  ipAddress: string
  userAgent?: string | null
  /** The locale the form was rendered and sent in, when the site asked for one. */
  locale?: string | null
}

export interface SubmissionOptions {
  /** Reject non-live forms (both public paths). Member previews may pass false. */
  requireLive?: boolean
  /** Localized validation strings (defaults to English). */
  messages?: FormMessages
}

export interface SubmissionResult {
  id?: string
  submitted: true
  message: string
  title?: string
  redirect?: string
  redirectDelaySeconds?: number
  /** The resolved confirmation (same data as the top-level convenience keys). */
  confirmation: {
    title?: string
    message: string
    redirect?: string
    redirectDelaySeconds?: number
  }
}

/**
 * Runs the full submission pipeline for a loaded form row and returns the
 * public response payload. Throws RequestError for every rejection case.
 */
export async function processFormSubmission(
  deps: SubmissionDeps,
  form: FormRecord,
  rawBody: Record<string, unknown>,
  meta: SubmissionMeta,
  opts: SubmissionOptions = {},
): Promise<SubmissionResult> {
  const settings = (form.settings ?? {}) as FormSettings
  const fields = (form.fields ?? []) as FormField[]
  const appSettings = deps.appSettings as FormAppSettings
  const enqueue = deps.enqueue ?? (async () => {})

  const successPayload = (data: Record<string, unknown>, id?: string): SubmissionResult => {
    const c = pickConfirmation(settings, data)
    return {
      ...(id ? { id } : {}),
      submitted: true,
      message: c.message,
      ...(c.title ? { title: c.title } : {}),
      ...(c.redirect ? { redirect: c.redirect } : {}),
      ...(c.redirectDelaySeconds ? { redirectDelaySeconds: c.redirectDelaySeconds } : {}),
      confirmation: c,
    }
  }

  if (opts.requireLive && !form.isLive) {
    throw new RequestError('FORM_DISABLED', 'This form is not currently accepting submissions', 403)
  }

  // Availability window
  const availability = formAvailability(settings.schedule)
  if (availability === 'not_yet') {
    throw new RequestError('FORM_NOT_OPEN', settings.schedule?.notYetOpenMessage ?? 'This form is not open yet', 403)
  }
  if (availability === 'closed') {
    throw new RequestError('FORM_CLOSED', settings.schedule?.closedMessage ?? 'This form is closed', 403)
  }

  // Honeypot — bots that fill the trap get a believable success and nothing else
  const { _captchaToken, [HONEYPOT_FIELD]: honeypot, ...data0 } = rawBody
  if (settings.honeypot !== false && typeof honeypot === 'string' && honeypot !== '') {
    return successPayload({})
  }

  // The form's fields ARE the contract. Undeclared keys are dropped here,
  // before anything stores, emails or forwards them.
  //
  // This surface is `auth: 'public'`, so the body is anonymous internet input.
  // validateForm below checks the DECLARED fields and validateOptionMembership
  // checks choice values, but neither removed anything, so whatever else was
  // posted was persisted into form_submissions.data, interpolated into the
  // operator's notification email, and forwarded to every configured webhook.
  // The body cap is the only thing that bounded it.
  //
  // Dropping rather than refusing, for two reasons: it matches what the
  // platform already does to a member's write of a field they cannot reach -
  // it strips rather than erroring - and a refusal would tell a prober which
  // field names exist. The first-party client already sends exactly this set:
  // embed/runtime.ts builds its body from `readData(form, fields)`, so no
  // legitimate caller loses anything.
  //
  // BEFORE beforeSubmit, not after: the body is the attacker's, but the hook
  // is the site's own code and is documented to mutate, so anything IT adds is
  // trusted and must survive.
  const declaredFields = new Set(fields.map((f) => f.name))
  let data: Record<string, unknown> = Object.fromEntries(
    Object.entries(data0).filter(([key]) => declaredFields.has(key)),
  )

  // beforeSubmit — synchronous by design: it may mutate or reject
  if (deps.hooks.beforeSubmit) {
    try {
      data = await deps.hooks.beforeSubmit(data, form, {
        workspaceId: form.workspaceId, ipAddress: meta.ipAddress,
      })
    } catch (err: any) {
      throw new RequestError('VALIDATION_ERROR', err?.message ?? 'Submission rejected by hook', 400)
    }
  }

  // Captcha (workspace-level config)
  if (appSettings.captcha?.provider) {
    if (!_captchaToken) throw new RequestError('VALIDATION_ERROR', 'Captcha token required', 400)
    const result = await verifyCaptchaToken(
      appSettings.captcha.provider,
      appSettings.captcha.secretKey,
      String(_captchaToken),
      appSettings.captcha.minScore,
      deps.http,
    )
    if (!result.success) throw new RequestError('VALIDATION_ERROR', result.error ?? 'Captcha failed', 400)
  }

  // Entry limit — calendar-window count against accepted submissions
  if (settings.entryLimit?.max) {
    const windowStart = entryLimitWindowStart(settings.entryLimit.period ?? 'total')
    const countFn = deps.countSubmissions ?? (async (formId: string, workspaceId: string, ws: Date | null) => {
      const conds = [eq(formSubmissions.formId, formId), eq(formSubmissions.workspaceId, workspaceId)]
      if (ws) conds.push(gte(formSubmissions.createdAt, ws))
      const rows = await deps.db.select({ n: count() }).from(formSubmissions).where(and(...conds))
      return Number(rows[0]?.n ?? 0)
    })
    const current = await countFn(form.id, form.workspaceId, windowStart)
    if (current >= settings.entryLimit.max) {
      throw new RequestError('ENTRY_LIMIT', settings.entryLimit.limitMessage ?? 'This form is not accepting more entries right now', 403)
    }
  }

  // Validation — condition groups + hidden steps skip their fields
  const { valid, errors } = validateForm(fields, data, { steps: settings.steps, messages: opts.messages })
  if (!valid) throw new RequestError('VALIDATION_ERROR', 'Validation failed', 400, errors)

  // Choice fields only accept values from their (possibly dynamic) options
  const optionErrors: Record<string, string> = {}
  for (const field of fields) {
    const err = validateOptionMembership(field, data[field.name])
    if (err) optionErrors[field.name] = err
  }
  if (Object.keys(optionErrors).length > 0) {
    throw new RequestError('VALIDATION_ERROR', 'Validation failed', 400, optionErrors)
  }

  // Dedupe
  if (settings.uniqueBy) {
    const existing = await deps.db
      .select({ data: formSubmissions.data, ipAddress: formSubmissions.ipAddress })
      .from(formSubmissions)
      .where(and(eq(formSubmissions.formId, form.id), eq(formSubmissions.workspaceId, form.workspaceId)))
    const dupError = checkUniqueSubmission(settings, data, existing, meta.ipAddress)
    if (dupError) throw new RequestError('CONFLICT', dupError, 409)
  }

  // Persist
  const id = crypto.randomUUID()
  await deps.db.insert(formSubmissions).values({
    id,
    formId: form.id,
    workspaceId: form.workspaceId,
    data,
    ipAddress: settings.personalData?.storeIp === false ? null : meta.ipAddress,
    metadata: { userAgent: meta.userAgent ?? null, ...(meta.locale ? { locale: meta.locale } : {}) },
  })

  // Queued after-work — failures never block the response
  const jobs: FormJobData[] = []
  for (const notification of settings.notifications ?? []) {
    const recipients = notificationRecipients(notification, data)
    if (recipients === null) continue // showIf gated this notification off
    for (const to of recipients) {
      jobs.push({
        kind: 'email',
        formId: form.id,
        formSlug: form.slug,
        formName: form.name,
        workspaceId: form.workspaceId,
        submissionId: id,
        data,
        notification: {
          ...notification,
          to,
          ...(notification.replyTo ? { replyTo: interpolateMergeTags(notification.replyTo, data) } : {}),
        },
        fromEmail: appSettings.fromEmail,
        fromName: appSettings.fromName,
        ipAddress: meta.ipAddress,
      })
    }
  }
  for (const webhook of settings.webhooks ?? []) {
    jobs.push({
      kind: 'webhook',
      formId: form.id,
      formSlug: form.slug,
      formName: form.name,
      workspaceId: form.workspaceId,
      submissionId: id,
      data,
      submittedAt: new Date().toISOString(),
      webhook,
    })
  }
  if (deps.hooks.afterSubmit) {
    jobs.push({
      kind: 'hook',
      hookName: 'afterSubmit',
      formId: form.id,
      formSlug: form.slug,
      formName: form.name,
      workspaceId: form.workspaceId,
      submissionId: id,
      data,
      ipAddress: meta.ipAddress,
    })
  }
  if (jobs.length > 0) {
    await Promise.all(jobs.map((j) => enqueue(j))).catch(() => { /* queue down ≠ lost submission */ })
  }

  // Accepted, stored, and now announced - flows and webhooks subscribe to this.
  if (id) {
    deps.eventBus?.emit({
      id: randomUUID(),
      type: 'form.submitted',
      workspaceId: form.workspaceId,
      timestamp: new Date().toISOString(),
      payload: { formId: form.id, formSlug: form.slug, submissionId: id },
    })
  }

  return successPayload(data, id)
}
