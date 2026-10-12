/**
 * File Name: server.ts
 * Purpose: The Forms extension's server: the public embed and headless
 *          routes, their keyed twins, the admin routes the builder and the
 *          submissions views call, the three after-work tasks, the `form`
 *          field type, the search and Porter providers, the flow trigger
 *          (with hydration) and the retention timer. Tables are the
 *          extension's own (./tables.ts, ./migrations.ts); core knows only
 *          the seams (tasks/plan-core-slimming.md S3).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Routes mount at /api/v1/ext/forms/<path> (public and
 *          key) and /api/v1/admin/ext/forms/<path> (member). A form's
 *          `settings.embed.requireApiKey` moves it to the keyed twins:
 *          `keyed/:formId/schema` and `keyed/:formId/submit`, checked with
 *          the key's `forms` grants (`req.keyCan`). `form.submitted` is
 *          announced as a platform event so Flows, webhooks and the
 *          realtime bridge hear it exactly as before.
 */
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm'
import { defineExtensionServer, type ExtensionServerCtx, type ExtensionAdminRoute } from '@tangen/cms'
import { forms, formSubmissions } from './tables'
import { EXT_ID, dbOf, hooksFor, loadAppSettings, loadForm, localeOf, withResolvedOptions } from './context'
import { RequestError } from './errors'
import { processFormSubmission } from './submission'
import { localizeFormDefinition, formMessagesForLocale, mergeFormLocaleData } from './i18n'
import { buildFormDefaults, readCreateFormBody, sanitizeSettings, assertSafeConfirmationRedirects } from './crud'
import { buildNotesUpdate, buildSubmissionListFilter, buildSubmissionsCsv } from './submissions'
import { embedSubmitQs, frameAncestorsHeader, getEmbedRuntime, renderPage, requestOrigin } from './embed/page'
import { runHookJob, runNotificationJob, deliverFormWebhook } from './deliver'
import { queueIdFor, type FormJobData, type FormHookJobData, type FormNotificationJobData, type FormWebhookJobData } from './jobs'
import { purgeExpiredSubmissions } from './retention'
import { validateFormRef } from './field-type'
import { FORM_DEFINITION_JSON_SCHEMA, FORM_FIELD_TYPES, validateFormDefinition, formAvailability, entryLimitWindowStart } from './contract'
import type { FormAppSettings, FormField, FormRecord, FormSettings } from './contract'

type Req = Parameters<ExtensionAdminRoute['handler']>[0]

/** Where the extension's own pages live: the deployment's public API URL, else the origin this request arrived on. */
function originOf(ctx: ExtensionServerCtx, req: Req): string {
  return ctx.publicUrl?.() ?? requestOrigin(req.url ?? 'http://localhost', req.headers ?? {})
}

const RETENTION_TICK_MS = 60 * 60 * 1000

// ─── Shared pieces ───────────────────────────────────────────────────────────

function sinkFor(ctx: ExtensionServerCtx) {
  return {
    enqueue: (job: FormJobData) => ctx.enqueue(queueIdFor(job), job),
    eventBus: {
      emit: (event: Record<string, unknown>) => {
        const p = (event.payload ?? {}) as { formId: string; formSlug?: string; submissionId: string }
        ctx.emitPlatform?.('form.submitted', { formId: p.formId, formSlug: p.formSlug, submissionId: p.submissionId })
      },
    },
  }
}

/** The whole submit path for a loaded form: options, localization, pipeline, after-work. */
async function submit(ctx: ExtensionServerCtx, req: Req, formRow: FormRecord, locale: string | null) {
  const form = localizeFormDefinition(await withResolvedOptions(ctx, formRow), locale) as FormRecord
  return processFormSubmission(
    { db: dbOf(ctx), appSettings: await loadAppSettings(ctx), hooks: hooksFor(ctx, form.slug), http: ctx.http, ...sinkFor(ctx) },
    form,
    (req.body as Record<string, unknown>) ?? {},
    { ipAddress: req.ip ?? '0.0.0.0', userAgent: req.headers?.['user-agent'] ?? null, locale },
    { requireLive: true, messages: formMessagesForLocale(formRow, locale) },
  )
}

function requiresKey(form: FormRecord): boolean {
  return Boolean((form.settings as { embed?: { requireApiKey?: boolean } } | undefined)?.embed?.requireApiKey)
}

function refuseWithoutKey(form: FormRecord, action: 'read' | 'submit'): never {
  throw new RequestError('UNAUTHORIZED', `This form requires an API key - call keyed/${form.id}/${action === 'read' ? 'schema' : 'submit'} with a key that grants forms:${action}`, 401)
}

function assertKey(req: Req, form: FormRecord, action: 'read' | 'submit'): void {
  if (!req.keyCan?.(action, { id: form.id, slug: form.slug })) {
    throw new RequestError('FORBIDDEN', `This API key does not grant forms:${action} on "${form.slug}"`, 403)
  }
}

async function schemaPayload(ctx: ExtensionServerCtx, req: Req, row: FormRecord) {
  const db = dbOf(ctx)
  const origin = originOf(ctx, req)
  const base = `${origin}/api/v1/ext/${EXT_ID}`
  const locale = localeOf(ctx, req.query?.locale)
  const resolvedSchema = localizeFormDefinition(await withResolvedOptions(ctx, row), locale)
  const s = (resolvedSchema.settings ?? {}) as FormSettings & Record<string, unknown>
  const app = await loadAppSettings(ctx) as FormAppSettings
  let availability: { state: string; message?: string } = { state: 'open' }
  const schedState = formAvailability(s.schedule)
  if (schedState === 'not_yet') availability = { state: 'not_yet', message: s.schedule?.notYetOpenMessage ?? 'This form is not open yet' }
  else if (schedState === 'closed') availability = { state: 'closed', message: s.schedule?.closedMessage ?? 'This form is closed' }
  else if (!row.isLive) availability = { state: 'closed', message: 'This form is not currently accepting submissions' }
  else if (s.entryLimit?.max) {
    const windowStart = entryLimitWindowStart(s.entryLimit.period ?? 'total')
    const conds = [eq(formSubmissions.formId, row.id), eq(formSubmissions.workspaceId, row.workspaceId)]
    if (windowStart) conds.push(gte(formSubmissions.createdAt, windowStart))
    const cnt = await db.select({ n: count() }).from(formSubmissions).where(and(...conds))
    if (Number(cnt[0]?.n ?? 0) >= s.entryLimit.max) availability = { state: 'limit_reached', message: s.entryLimit.limitMessage ?? 'This form is not accepting more entries right now' }
  }
  return {
    data: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      availability,
      submitUrl: `${base}/embed/${row.id}/submit`,
      embedUrl: `${base}/embed/${row.id}`,
      applessUrl: `${base}/embed/${row.id}/appless`,
      fields: resolvedSchema.fields,
      steps: s.steps ?? undefined,
      messages: formMessagesForLocale(row, locale),
      settings: {
        successTitle: s.successTitle,
        successMessage: s.successMessage,
        submitButtonText: s.submitButtonText,
        description: s.description,
        labelPlacement: s.labelPlacement,
        descriptionPlacement: s.descriptionPlacement,
        validationPlacement: s.validationPlacement,
        wrapperClass: s.wrapperClass,
        honeypot: s.honeypot,
        successRedirect: s.successRedirect,
        submitButtonClass: s.submitButtonClass,
        // Only the public captcha fields: provider and siteKey, never secretKey.
        captcha: app.captcha?.provider ? { provider: app.captcha.provider, siteKey: app.captcha.siteKey } : undefined,
      },
    },
  }
}

/** The workspace's default locale code, 'en' when localization is off. */
function defaultLocaleOf(ctx: ExtensionServerCtx): string {
  const localization = (ctx.workspaceConfig?.() as { localization?: { enabled?: boolean; defaultLocale?: string } } | undefined)?.localization
  return (localization?.enabled && localization.defaultLocale) || 'en'
}

async function embedPage(ctx: ExtensionServerCtx, req: Req, styled: boolean): Promise<Response> {
  let row: FormRecord
  try { row = await loadForm(ctx, req.params.formId!) } catch (e) { return new Response((e as Error).message ?? 'Form not found', { status: (e as { statusCode?: number }).statusCode ?? 404 }) }
  if (requiresKey(row)) return new Response('This form requires an API key and cannot be embedded publicly', { status: 401 })
  const origin = originOf(ctx, req)
  const base = `${origin}/api/v1/ext/${EXT_ID}`
  const locale = localeOf(ctx, req.query?.locale)
  const resolved = localizeFormDefinition(await withResolvedOptions(ctx, row), locale)
  const csp = frameAncestorsHeader((row.settings as { embed?: { allowedDomains?: string[] } }).embed?.allowedDomains)
  const workspaceQs = `workspace=${encodeURIComponent(ctx.workspaceId)}`
  const submitQs = embedSubmitQs(locale, undefined)
  return new Response(renderPage({
    formName: row.name,
    formId: row.id,
    fields: (resolved.fields ?? []) as FormField[],
    settings: (resolved.settings ?? {}) as FormSettings,
    messages: formMessagesForLocale(row, locale) as unknown as Record<string, string>,
    submitUrl: `${base}/embed/${row.id}/submit${submitQs ? `${submitQs}&` : '?'}${workspaceQs}`,
    runtimeUrl: `${base}/embed/runtime.js?v=${(await getEmbedRuntime()).hash}&${workspaceQs}`,
    styled,
    lang: locale ?? defaultLocaleOf(ctx),
  }), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...(csp ? { 'Content-Security-Policy': csp } : {}) } })
}

/**
 * The WHERE of a submissions read: the form, the dates, the locale, the
 * labels (through the platform's label seam) and a selection of ids. Null
 * when a label filter matches nothing, so the caller answers an empty page.
 */
async function submissionConditions(ctx: ExtensionServerCtx, formId: string, filter: ReturnType<typeof buildSubmissionListFilter>) {
  const conditions = [eq(formSubmissions.workspaceId, ctx.workspaceId), eq(formSubmissions.formId, formId)]
  if (filter.from) conditions.push(gte(formSubmissions.createdAt, new Date(filter.from)))
  if (filter.to) conditions.push(lte(formSubmissions.createdAt, new Date(filter.to)))
  if (filter.locales.length > 0) conditions.push(sql`${formSubmissions.metadata}->>'locale' IN (${sql.join(filter.locales.map((l) => sql`${l}`), sql`, `)})`)
  // Search: the submitted values as text, and the team's notes.
  if (filter.q) conditions.push(sql`(${formSubmissions.data}::text ILIKE ${'%' + filter.q + '%'} OR ${formSubmissions.notes} ILIKE ${'%' + filter.q + '%'})`)
  if (filter.ids) {
    if (filter.ids.length === 0) return null
    conditions.push(inArray(formSubmissions.id, filter.ids))
  }
  if (filter.labels.length > 0) {
    const find = ctx.tangen?.labels?.find
    if (!find) throw new RequestError('INTERNAL', 'Labels are not available on this runtime', 501)
    const ids = await find('submission', filter.labels, filter.labelsOp === 'none' ? 'any' : filter.labelsOp)
    if (filter.labelsOp === 'none') {
      if (ids.length > 0) conditions.push(sql`${formSubmissions.id} NOT IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
    } else {
      if (ids.length === 0) return null
      conditions.push(inArray(formSubmissions.id, ids))
    }
  }
  return conditions
}

async function loadOwnForm(ctx: ExtensionServerCtx, formId: string) {
  const [row] = await dbOf(ctx).select().from(forms).where(and(eq(forms.id, formId), eq(forms.workspaceId, ctx.workspaceId))).limit(1)
  if (!row) throw new RequestError('NOT_FOUND', 'Form not found', 404)
  return row as FormRecord & { source: string }
}

/**
 * The CSV of one form's submissions: the same filter as the list plus a
 * selection of ids (a POST body or the query), with the team's labels and
 * notes as the last columns.
 */
async function exportSubmissions(ctx: ExtensionServerCtx, req: Req): Promise<Response> {
  const formRow = await loadOwnForm(ctx, req.params.formId!)
  const filter = buildSubmissionListFilter({ ...(req.query ?? {}), ...((req.body ?? {}) as Record<string, unknown>) })
  const conditions = await submissionConditions(ctx, formRow.id, filter)
  const rows = conditions
    ? await dbOf(ctx).select().from(formSubmissions).where(and(...conditions)).orderBy(filter.sort === 'asc' ? asc(formSubmissions.createdAt) : desc(formSubmissions.createdAt))
    : []
  const labelsById = rows.length ? await ctx.tangen.labels.listMany('submission', rows.map((r) => r.id)) : {}
  const csv = buildSubmissionsCsv((formRow.fields ?? []) as Array<{ name: string }>, rows as never, labelsById)
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${formRow.slug}-submissions.csv"` } })
}

const codeOwned = (row: { slug: string }, want: string) =>
  new RequestError('CONFLICT', `This form is defined in code - ${want} in app/forms/${row.slug}.ts and run tangen push`, 409)

// ─── Routes ──────────────────────────────────────────────────────────────────

const publicRoutes: ExtensionAdminRoute[] = [
  {
    method: 'GET', path: 'embed/runtime.js', auth: 'public',
    handler: async () => {
      const { code } = await getEmbedRuntime()
      return new Response(code, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' } })
    },
  },
  { method: 'GET', path: 'embed/:formId', auth: 'public', handler: (req, ctx) => embedPage(ctx, req, true) },
  { method: 'GET', path: 'embed/:formId/appless', auth: 'public', handler: (req, ctx) => embedPage(ctx, req, false) },
  {
    method: 'GET', path: ':formId/schema', auth: 'public',
    handler: async (req, ctx) => {
      const row = await loadForm(ctx, req.params.formId!)
      if (requiresKey(row)) refuseWithoutKey(row, 'read')
      return schemaPayload(ctx, req, row)
    },
  },
  {
    method: 'POST', path: 'embed/:formId/submit', auth: 'public',
    handler: async (req, ctx) => {
      const row = await loadForm(ctx, req.params.formId!)
      if (requiresKey(row)) refuseWithoutKey(row, 'submit')
      return { data: await submit(ctx, req, row, localeOf(ctx, req.query?.locale)) }
    },
  },
  // The keyed twins: the same reads and the same pipeline, reached with a credential.
  {
    method: 'GET', path: 'keyed/:formId/schema', auth: 'key',
    handler: async (req, ctx) => {
      const row = await loadForm(ctx, req.params.formId!)
      if (requiresKey(row)) assertKey(req, row, 'read')
      return schemaPayload(ctx, req, row)
    },
  },
  {
    method: 'POST', path: 'keyed/:formId/submit', auth: 'key',
    handler: async (req, ctx) => {
      const row = await loadForm(ctx, req.params.formId!)
      if (requiresKey(row)) assertKey(req, row, 'submit')
      return { data: await submit(ctx, req, row, localeOf(ctx, req.query?.locale)) }
    },
  },
]

const memberRoutes: ExtensionAdminRoute[] = [
  {
    method: 'GET', path: '', capability: 'forms:read',
    handler: async (_req, ctx) => {
      const db = dbOf(ctx)
      const rows = await db.select().from(forms).where(eq(forms.workspaceId, ctx.workspaceId)).orderBy(desc(forms.updatedAt))
      const counts = await db
        .select({ formId: formSubmissions.formId, count: sql<number>`count(*)::int` })
        .from(formSubmissions).where(eq(formSubmissions.workspaceId, ctx.workspaceId)).groupBy(formSubmissions.formId)
      const countMap: Record<string, number> = {}
      for (const c of counts) countMap[c.formId] = Number(c.count)
      return { data: rows.map((r: FormRecord) => ({ ...r, settings: sanitizeSettings(r.settings as FormSettings), submissionCount: countMap[r.id] ?? 0 })) }
    },
  },
  {
    method: 'POST', path: '', capability: 'forms:manage',
    handler: async (req, ctx) => {
      const defaults = readCreateFormBody(req.body, { workspaceId: ctx.workspaceId })
      const now = new Date()
      const row = { id: crypto.randomUUID(), ...defaults, createdAt: now, updatedAt: now }
      await dbOf(ctx).insert(forms).values(row)
      return { data: { ...row, settings: sanitizeSettings(row.settings) } }
    },
  },
  {
    method: 'GET', path: 'widget-data', capability: 'forms:read',
    handler: async (_req, ctx) => {
      const db = dbOf(ctx)
      const [all] = await db.select({ n: count() }).from(forms).where(eq(forms.workspaceId, ctx.workspaceId))
      const [live] = await db.select({ n: count() }).from(forms).where(and(eq(forms.workspaceId, ctx.workspaceId), eq(forms.isLive, true)))
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
      const weekStart = new Date(dayStart.getTime() - 6 * 24 * 60 * 60 * 1000)
      const [today] = await db.select({ n: count() }).from(formSubmissions).where(and(eq(formSubmissions.workspaceId, ctx.workspaceId), gte(formSubmissions.createdAt, dayStart)))
      const [week] = await db.select({ n: count() }).from(formSubmissions).where(and(eq(formSubmissions.workspaceId, ctx.workspaceId), gte(formSubmissions.createdAt, weekStart)))
      return {
        stats: [
          { label: 'Forms', value: Number(all?.n ?? 0), href: '/extensions/forms' },
          { label: 'Live', value: Number(live?.n ?? 0), tone: Number(live?.n ?? 0) > 0 ? 'success' : 'neutral', href: '/extensions/forms' },
          { label: 'Submissions today', value: Number(today?.n ?? 0), href: '/extensions/forms/submissions' },
          { label: 'This week', value: Number(week?.n ?? 0), href: '/extensions/forms/submissions' },
        ],
      }
    },
  },
  {
    method: 'POST', path: 'generate', capability: 'forms:manage',
    handler: async (req, ctx) => {
      if (!req.can?.('use:ai')) throw new RequestError('FORBIDDEN', 'Your role cannot use AI', 403)
      if (!ctx.ai) throw new RequestError('AI_UNAVAILABLE', 'AI is not available for this workspace', 503)
      const body = (req.body ?? {}) as { prompt?: string; mode?: 'create' | 'edit'; current?: unknown }
      if (!body.prompt || body.prompt.trim().length < 3) throw new RequestError('VALIDATION_ERROR', 'A brief of at least three characters is required', 422)
      const mode = body.mode === 'edit' ? 'edit' : 'create'
      if (mode === 'edit' && !body.current) throw new RequestError('VALIDATION_ERROR', 'Edit mode needs the current form definition', 422)
      const system = [
        'You design web forms for a CMS. Output a complete form definition matching the JSON schema.',
        `Field types available: ${FORM_FIELD_TYPES.join(', ')}. Field "name" is the snake_case data key and must be unique; "id" is a short stable slug.`,
        'Use steps (with stepId on fields) when the form has distinct phases or more than ~6 fields. Use showIf conditions (single, or {logic, conditions[]} groups) when a field or step only applies in some cases.',
        'Choice fields (select/multiselect/radio) need options with label + value.',
        'In edit mode you receive the current definition: return the FULL updated definition - keep every existing field id unless the brief says to remove or replace it, and apply only the requested changes.',
      ].join('\n')
      const user = [mode === 'edit' ? `Current form definition:\n${JSON.stringify(body.current, null, 2)}` : '', `Brief: ${body.prompt}`].filter(Boolean).join('\n\n')
      const generate = (extra?: string) => ctx.ai!.generateJSON({ system, prompt: extra ? `${user}\n\n${extra}` : user, jsonSchema: FORM_DEFINITION_JSON_SCHEMA, maxTokens: 16000 })
      let result = await generate()
      let check = validateFormDefinition(result.value)
      if (check.errors.length > 0) {
        result = await generate(`Your previous output had these problems - fix them and return the corrected full definition:\n- ${check.errors.join('\n- ')}`)
        check = validateFormDefinition(result.value)
        if (check.errors.length > 0) throw new RequestError('VALIDATION_ERROR', 'AI produced an invalid form definition', 422, undefined, { errors: check.errors })
      }
      return { data: { definition: result.value, provider: result.provider, model: result.model, usage: result.usage } }
    },
  },
  {
    method: 'GET', path: ':formId', capability: 'forms:read',
    handler: async (req, ctx) => {
      const row = await loadOwnForm(ctx, req.params.formId!)
      return { data: { ...row, settings: sanitizeSettings(row.settings as FormSettings) } }
    },
  },
  {
    // The builder's share sheet: where this form lives on the public web,
    // from the API's own origin (the admin may sit on another domain).
    method: 'GET', path: ':formId/embed', capability: 'forms:read',
    handler: async (req, ctx) => {
      const row = await loadOwnForm(ctx, req.params.formId!)
      const origin = originOf(ctx, req)
      const base = `${origin}/api/v1/ext/${EXT_ID}`
      const ws = `?workspace=${encodeURIComponent(ctx.workspaceId)}`
      return { data: {
        id: row.id, slug: row.slug, requireApiKey: requiresKey(row),
        styled: `${base}/embed/${row.id}${ws}`,
        appless: `${base}/embed/${row.id}/appless${ws}`,
        schema: `${base}/${row.id}/schema${ws}`,
        submit: `${base}/embed/${row.id}/submit${ws}`,
        keyedSchema: `${base}/keyed/${row.id}/schema`,
        keyedSubmit: `${base}/keyed/${row.id}/submit`,
      } }
    },
  },
  {
    method: 'PATCH', path: ':formId', capability: 'forms:manage',
    handler: async (req, ctx) => {
      const db = dbOf(ctx)
      const existing = await loadOwnForm(ctx, req.params.formId!)
      const b = (req.body ?? {}) as Record<string, unknown>
      // A locale-scoped write (?locale=ta plus { i18n }) patches translations only; allowed for code-defined forms too.
      const localeParam = req.query?.locale
      if (localeParam) {
        const locale = localeOf(ctx, localeParam, true)
        if (!locale || locale === 'all') throw new RequestError('VALIDATION_ERROR', 'A concrete non-default locale is required', 422)
        if (req.canWriteLocale && !req.canWriteLocale(locale)) throw new RequestError('FORBIDDEN', `Your role cannot edit ${locale} content`, 403)
        const settings = mergeFormLocaleData((existing.settings ?? {}) as never, locale, (b.i18n ?? {}) as never)
        await db.update(forms).set({ settings, updatedAt: new Date() }).where(eq(forms.id, existing.id))
        return { data: { ...(await loadOwnForm(ctx, existing.id)), settings: sanitizeSettings(settings as unknown as FormSettings) } }
      }
      if (existing.source === 'code') {
        throw typeof b.isLive === 'boolean'
          ? codeOwned(existing, `to ${b.isLive ? 'publish' : 'unpublish'} it set \`isLive: ${b.isLive}\``)
          : codeOwned(existing, 'edit it (publish state is its `isLive` field)')
      }
      const patch: Record<string, unknown> = { updatedAt: new Date() }
      if (typeof b.name === 'string') patch.name = b.name
      if (typeof b.isLive === 'boolean') patch.isLive = b.isLive
      if (Array.isArray(b.fields)) {
        const check = validateFormDefinition({
          name: typeof b.name === 'string' ? b.name : existing.name,
          fields: b.fields,
          steps: ((b.settings as { steps?: unknown } | undefined)?.steps ?? (existing.settings as { steps?: unknown })?.steps) ?? undefined,
        })
        if (check.errors.length > 0) throw new RequestError('VALIDATION_ERROR', 'Invalid form definition', 422, undefined, { errors: check.errors })
        patch.fields = b.fields
      }
      if (b.settings && typeof b.settings === 'object') {
        patch.settings = { ...(existing.settings as object), ...(b.settings as object) }
        assertSafeConfirmationRedirects(patch.settings)
      }
      await db.update(forms).set(patch).where(eq(forms.id, existing.id))
      const updated = await loadOwnForm(ctx, existing.id)
      return { data: { ...updated, settings: sanitizeSettings(updated.settings as FormSettings) } }
    },
  },
  {
    method: 'DELETE', path: ':formId', capability: 'forms:manage',
    handler: async (req, ctx) => {
      const existing = await loadOwnForm(ctx, req.params.formId!)
      if (existing.source === 'code') throw codeOwned(existing, 'remove it from app/forms')
      await dbOf(ctx).delete(forms).where(eq(forms.id, existing.id))
      return { data: { deleted: true } }
    },
  },
  {
    method: 'GET', path: ':formId/submissions', capability: 'forms:submissions',
    handler: async (req, ctx) => {
      const db = dbOf(ctx)
      await loadOwnForm(ctx, req.params.formId!)
      const filter = buildSubmissionListFilter(req.query ?? {})
      const conditions = await submissionConditions(ctx, req.params.formId!, filter)
      if (!conditions) return { data: [], meta: { total: 0 } }
      const [countResult, rows] = await Promise.all([
        db.select({ count: count() }).from(formSubmissions).where(and(...conditions)),
        db.select().from(formSubmissions).where(and(...conditions)).orderBy(filter.sort === 'asc' ? asc(formSubmissions.createdAt) : desc(formSubmissions.createdAt)).limit(filter.limit).offset(filter.offset),
      ])
      return { data: rows, meta: { total: Number(countResult[0]?.count ?? 0) } }
    },
  },
  {
    method: 'GET', path: ':formId/submissions/export', capability: 'forms:submissions',
    handler: async (req, ctx) => {
      return exportSubmissions(ctx, req)
    },
  },
  {
    method: 'POST', path: ':formId/submissions/export', capability: 'forms:submissions',
    handler: async (req, ctx) => {
      return exportSubmissions(ctx, req)
    },
  },
  {
    method: 'DELETE', path: ':formId/submissions/:id', capability: 'forms:submissions',
    handler: async (req, ctx) => {
      const db = dbOf(ctx)
      const where = and(eq(formSubmissions.id, req.params.id!), eq(formSubmissions.formId, req.params.formId!), eq(formSubmissions.workspaceId, ctx.workspaceId))
      const [existing] = await db.select().from(formSubmissions).where(where).limit(1)
      if (!existing) throw new RequestError('NOT_FOUND', 'Submission not found', 404)
      await db.delete(formSubmissions).where(where)
      return { data: { id: req.params.id, deleted: true } }
    },
  },
  {
    method: 'PATCH', path: ':formId/submissions/:id', capability: 'forms:submissions',
    handler: async (req, ctx) => {
      const db = dbOf(ctx)
      const update = buildNotesUpdate(req.body)
      if (!update) throw new RequestError('VALIDATION_ERROR', 'A `notes` string is required', 422)
      const where = and(eq(formSubmissions.id, req.params.id!), eq(formSubmissions.formId, req.params.formId!), eq(formSubmissions.workspaceId, ctx.workspaceId))
      const [existing] = await db.select().from(formSubmissions).where(where).limit(1)
      if (!existing) throw new RequestError('NOT_FOUND', 'Submission not found', 404)
      await db.update(formSubmissions).set(update).where(where)
      const [updated] = await db.select().from(formSubmissions).where(where).limit(1)
      return { data: updated }
    },
  },
]

// ─── The server ──────────────────────────────────────────────────────────────

export default defineExtensionServer({
  adminRoutes: [...publicRoutes, ...memberRoutes],

  fieldTypes: {
    form: { validate: (value) => validateFormRef(value) },
  },

  // The after-work of a submission, as three durable-queue tasks that run
  // with the extension's own authority: a hook creating content, a mail
  // reading a whole submission, a webhook posting it.
  tasks: [
    { name: 'notify', description: 'Send a form notification mail', runAs: 'extension', handler: async (payload, ctx) => { const job = payload as FormNotificationJobData; await runNotificationJob(job, ctx, hooksFor(ctx, job.formSlug ?? '')) } },
    { name: 'webhook', description: 'Deliver a form webhook', runAs: 'extension', handler: async (payload, ctx) => { await deliverFormWebhook(payload as FormWebhookJobData, ctx.http) } },
    { name: 'hook', description: 'Run a form lifecycle hook', runAs: 'extension', handler: async (payload, ctx) => { const job = payload as FormHookJobData; await runHookJob(job, ctx, hooksFor(ctx, job.formSlug)) } },
  ],

  // Personal-data retention: every hour the extension asks; the purge itself runs once a day.
  onStart: async (ctx) => {
    const tick = () => purgeExpiredSubmissions(dbOf(ctx), new Date(), (m) => ctx.log?.(m)).catch((err) => ctx.log?.(`retention failed: ${err instanceof Error ? err.message : String(err)}`))
    void tick()
    const handle = setInterval(tick, RETENTION_TICK_MS)
    return () => clearInterval(handle)
  },

  // The key editor's per-form overrides.
  apiKeyScopeItems: async (ctx) => {
    const rows = await dbOf(ctx).select({ id: forms.id, name: forms.name, slug: forms.slug }).from(forms).where(eq(forms.workspaceId, ctx.workspaceId))
    return rows.map((r: { id: string; name: string; slug: string }) => ({ id: r.id, name: r.name, slug: r.slug }))
  },

  // Form DEFINITIONS by name (submissions are a reporting view, not search).
  searchProviders: [
    {
      id: 'forms',
      label: 'Forms',
      audiences: ['internal'],
      search: async (q, ctx) => {
        const rows = await dbOf(ctx).select().from(forms)
          .where(and(eq(forms.workspaceId, ctx.workspaceId), ilike(forms.name, `%${q}%`))).limit(10)
        return rows.map((r: FormRecord) => ({ id: r.id, title: r.name, to: `/extensions/forms/${r.id}`, status: r.isLive ? 'published' : 'draft', icon: 'IconSurvey' }))
      },
    },
  ],

  // Definitions travel; submissions stay (the user's decision of 2026-08-08).
  porterProviders: [
    {
      key: 'forms',
      label: 'Form definitions',
      async count(db, workspaceId) {
        const rows = await (db as any).select({ id: forms.id }).from(forms).where(eq(forms.workspaceId, workspaceId))
        return rows.length
      },
      async exportRows(db, workspaceId) {
        const rows = await (db as any).select().from(forms).where(eq(forms.workspaceId, workspaceId)) as Record<string, unknown>[]
        return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'workspaceId')))
      },
      async importRows(db, workspaceId, rows) {
        let created = 0, updated = 0
        for (const row of rows) {
          const slug = String(row.slug ?? '')
          if (!slug) continue
          const values = Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'workspaceId' && k !== 'id'))
          for (const k of ['createdAt', 'updatedAt'] as const) if (typeof values[k] === 'string') values[k] = new Date(values[k] as string)
          const [existing] = await (db as any).select({ id: forms.id }).from(forms).where(and(eq(forms.workspaceId, workspaceId), eq(forms.slug, slug))).limit(1)
          if (existing) {
            await (db as any).update(forms).set(values).where(eq(forms.id, existing.id))
            updated += 1
          } else {
            const sourceId = String(row.id ?? '') || crypto.randomUUID()
            const [idTaken] = await (db as any).select({ id: forms.id }).from(forms).where(eq(forms.id, sourceId)).limit(1)
            await (db as any).insert(forms).values({ ...values, id: idTaken ? crypto.randomUUID() : sourceId, workspaceId })
            created += 1
          }
        }
        return { created, updated }
      },
    },
  ],

  // What Flows knows about forms comes from here: the trigger, and what a
  // matched flow may read of it (the values never ride the bus).
  flowTriggers: [
    {
      type: 'form.submitted',
      label: 'Form submitted',
      description: 'A form accepted a submission (after validation and spam checks)',
      payloadFields: [
        { path: 'formId', label: 'Form id', sample: 'frm_123' },
        { path: 'formSlug', label: 'Form slug', sample: 'contact' },
        { path: 'submissionId', label: 'Submission id', sample: 'sub_123' },
        { path: 'submission.values', label: 'Submitted values', sample: { email: 'grace@example.com' } },
      ],
      hydrate: async (event, ctx) => {
        const payload = (event.payload ?? {}) as { submissionId?: string; formSlug?: string }
        if (!payload.submissionId) return {}
        const [found] = await dbOf(ctx)
          .select({ id: formSubmissions.id, formId: formSubmissions.formId, data: formSubmissions.data, createdAt: formSubmissions.createdAt })
          .from(formSubmissions)
          .where(and(eq(formSubmissions.id, payload.submissionId), eq(formSubmissions.workspaceId, ctx.workspaceId)))
          .limit(1)
        if (!found) return {}
        return { submission: { id: found.id, formId: found.formId, formSlug: payload.formSlug, values: found.data ?? {}, createdAt: found.createdAt instanceof Date ? found.createdAt.toISOString() : found.createdAt } }
      },
    },
  ],
})
