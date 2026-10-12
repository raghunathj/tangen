/**
 * File Name: embed/page.ts
 * Purpose: The public embed: the styled shell, the shared browser runtime
 *          bundled once from ./runtime.ts, and the two small request helpers
 *          the routes need (the caller's origin, the frame-ancestors header).
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { FormField, FormSettings } from '../contract'
import { formAvailability } from '../contract'

const STYLED_CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;color:#111827;background:transparent;line-height:1.5;}
.tf-form{max-width:600px;}
.tf-field{margin-bottom:20px;}
.tf-label{display:block;font-size:14px;font-weight:500;margin-bottom:6px;color:#374151;}
.tf-req{color:#ef4444;margin-left:2px;}
.tf-input{width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;color:#111827;outline:none;transition:border-color .15s,box-shadow .15s;background:#fff;font-family:inherit;}
.tf-input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15);}
textarea.tf-input{min-height:100px;resize:vertical;}
select.tf-input{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%236b7280' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14L2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:36px;}
.tf-radio-label,.tf-checkbox-label{display:flex;align-items:center;gap:8px;font-size:14px;color:#374151;margin-bottom:6px;cursor:pointer;}
.tf-phone{display:flex;gap:8px;align-items:stretch;}
.tf-phone .tf-phone-cc{flex:0 0 auto;width:auto;min-width:96px;max-width:140px;padding:9px 28px 9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;color:#111827;background:#fff;font-family:inherit;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%236b7280' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14L2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;cursor:pointer;}
.tf-phone .tf-input{flex:1 1 auto;}
.tf-phone .tf-phone-cc:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15);}
.tf-radio-label input,.tf-checkbox-label input{width:16px;height:16px;accent-color:#3b82f6;flex-shrink:0;cursor:pointer;}
.tf-help{font-size:12px;color:#6b7280;margin-top:4px;}
.tf-err{font-size:12px;color:#ef4444;margin-top:4px;min-height:1em;}
.tf-form-error{padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:13px;color:#b91c1c;margin-bottom:16px;}
.tf-submit{display:inline-flex;align-items:center;padding:10px 24px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;transition:background .15s;font-family:inherit;margin-top:4px;}
.tf-submit:hover:not(:disabled){background:#1d4ed8;}
.tf-submit:disabled{opacity:.6;cursor:not-allowed;}
.tf-success{display:none;padding:16px 20px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;color:#166534;font-size:14px;margin-top:8px;}
.tf-success-title{font-size:18px;font-weight:600;margin-bottom:6px;}
.tf-step-title{font-size:16px;font-weight:600;color:#111827;margin-bottom:4px;}
.tf-step-desc{font-size:13px;color:#6b7280;margin-bottom:16px;}
.tf-nav{display:flex;align-items:center;gap:12px;margin-top:8px;}
.tf-progress{font-size:12px;color:#9ca3af;margin-left:auto;margin-right:12px;}
.tf-back{background:none;border:1px solid #d1d5db;border-radius:8px;padding:9px 18px;font-size:14px;color:#374151;cursor:pointer;font-family:inherit;}
.tf-back:hover{border-color:#9ca3af;}
.tf-form-desc{font-size:14px;color:#6b7280;margin-bottom:20px;max-width:600px;}
.tf-field-left{display:grid;grid-template-columns:160px 1fr;gap:4px 16px;align-items:start;}
.tf-field-left .tf-label{padding-top:9px;margin-bottom:0;}
.tf-field-left .tf-help,.tf-field-left .tf-err{grid-column:2;}
.tf-summary{padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;margin-bottom:16px;}
.tf-summary-list{margin:0;padding-left:18px;font-size:13px;color:#b91c1c;}
.tf-unavailable{max-width:600px;padding:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;}
.tf-unavailable-msg{font-size:14px;color:#4b5563;}`

let _runtime: { code: string; hash: string } | null = null

/**
 * Bundles embed-runtime.ts for the browser on first use and caches it for the
 * process lifetime. The runtime imports @tangen/types form-logic, so the
 * client-side interpreter is literally the server's implementation.
 */
export async function getEmbedRuntime(): Promise<{ code: string; hash: string }> {
  if (_runtime) return _runtime
  const entry = new URL('./runtime.ts', import.meta.url).pathname
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'esm',
    minify: true,
  })
  if (!result.success || result.outputs.length === 0) {
    throw new Error('Failed to bundle the forms embed runtime: ' + result.logs.map(l => String(l)).join('; '))
  }
  const code = await result.outputs[0].text()
  const hash = Bun.hash(code).toString(16).slice(0, 12)
  _runtime = { code, hash }
  return _runtime
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** JSON payload safe for inline <script> injection. */
function safeJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c')
}

/**
 * Renders the embed HTML shell: base styles (styled variant) + the form's
 * custom CSS, the JSON payload, and the shared runtime module.
 */
export function renderPage(opts: {
  formName: string
  formId?: string
  fields: FormField[]
  settings: FormSettings
  submitUrl: string
  runtimeUrl: string
  styled: boolean
  messages?: Record<string, string>
  /** The language the page renders in (the locale asked for, else the workspace default). */
  lang?: string
}): string {
  const { formName, fields, settings, submitUrl, runtimeUrl, styled } = opts
  const availability = formAvailability(settings.schedule)
  const payload = {
    submitUrl,
    formId: opts.formId,
    fields,
    messages: opts.messages,
    steps: settings.steps ?? undefined,
    settings: {
      rememberDraft: settings.rememberDraft,
      successTitle: (settings as any).successTitle,
      successMessage: settings.successMessage,
      successRedirect: settings.successRedirect,
      submitButtonClass: settings.submitButtonClass,
      submitButtonText: (settings as any).submitButtonText,
      description: settings.description,
      labelPlacement: settings.labelPlacement,
      descriptionPlacement: settings.descriptionPlacement,
      validationPlacement: settings.validationPlacement,
      wrapperClass: settings.wrapperClass,
      honeypot: settings.honeypot,
    },
    ...(availability !== 'open' ? {
      availability: {
        state: availability,
        message: availability === 'not_yet'
          ? settings.schedule?.notYetOpenMessage ?? 'This form is not open yet'
          : settings.schedule?.closedMessage ?? 'This form is closed',
      },
    } : {}),
    styled,
  }
  const customCss = styled && (settings as any).customCss ? `<style>${(settings as any).customCss}</style>` : ''

  return `<!DOCTYPE html>
<html lang="${esc(opts.lang || 'en')}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(formName)}</title>
  ${styled ? `<style>${STYLED_CSS}</style>` : ''}${customCss}
</head>
<body>
  <div id="tangen-form"></div>
  <script>window.__TANGEN_FORM__ = ${safeJson(payload)}</script>
  <script type="module" src="${esc(runtimeUrl)}"></script>
</body>
</html>`
}

/** Query string for the embed submit URL — carries ?locale= and a ?key= through. */
export function embedSubmitQs(locale: string | null, key: unknown): string {
  const qs = new URLSearchParams()
  if (locale) qs.set('locale', locale)
  if (typeof key === 'string' && key.startsWith('tgn_')) qs.set('key', key)
  const str = qs.toString()
  return str ? `?${str}` : ''
}

/** The Content-Security-Policy that limits who may iframe a form; null when any site may. */
export function frameAncestorsHeader(allowedDomains?: string[]): string | null {
  const domains = (allowedDomains ?? [])
    .map((d) => String(d).replace(/[\r\n\s]+/g, ''))
    .filter(Boolean)
  if (domains.length === 0) return null
  return `frame-ancestors 'self' ${domains.join(' ')}`
}

/** The origin a browser reached us on, honouring a proxy's x-forwarded-proto. */
export function requestOrigin(url: string, headers: Record<string, string>): string {
  const u = new URL(url)
  const proto = headers['x-forwarded-proto']?.split(',')[0]?.trim()
  if (proto === 'https' && u.protocol === 'http:') return `https://${u.host}`
  return u.origin
}
