/**
 * File Name: embed-runtime.ts
 * Purpose: The browser runtime for embedded forms — renders fields from the
 *   injected JSON payload, evaluates visibility with the SAME shared logic the
 *   server validates with (@tangen/types form-logic), handles multi-step
 *   navigation, localized client validation, the honeypot, and the thank-you
 *   screen. Bundled at API boot (Bun.build) and served at
 *   GET /embed/forms/runtime.js.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: browser-only side effects are guarded so the module can
 *   also be imported in tests (conformance: bundle vs source fixtures).
 */
import { fieldsByStep, isFieldVisible, isStepVisible, evaluateShowIf, validateField, isPresentationalField, resolveSubmitButton, safeRedirectTarget, DEFAULT_FORM_MESSAGES } from '../contract'
import { offeredCountries, resolveDefaultDial, splitPhoneValue, joinPhoneValue, flagOf } from '../contract/phone'
import type { FormField, FormStep, FormMessages } from '../contract'

// Conformance surface — the bundle exports the shared logic so tests can prove
// the embedded interpreter IS the server's implementation.
export { evaluateShowIf, isFieldVisible, isStepVisible, validateField }

export const HONEYPOT_FIELD = '_hp'

export interface EmbedPayload {
  submitUrl: string
  /** Form id — the localStorage draft key when rememberDraft is on. */
  formId?: string
  fields: FormField[]
  steps?: FormStep[]
  settings: {
    rememberDraft?: boolean
    successTitle?: string
    successMessage?: string
    successRedirect?: string
    submitButtonClass?: string
    submitButtonText?: string
    submitButtonWidth?: 'full' | 'auto'
    description?: string
    labelPlacement?: 'top' | 'left' | 'hidden'
    descriptionPlacement?: 'below_label' | 'below_input'
    validationPlacement?: 'inline' | 'summary'
    wrapperClass?: string
    honeypot?: boolean
  }
  /** Render an unavailable screen instead of the form. */
  availability?: { state: 'not_yet' | 'closed'; message: string }
  messages?: FormMessages
  styled: boolean
}

type Data = Record<string, unknown>


// ─── DOM rendering (browser only) ─────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

/**
 * The initial selection a field renders with, derived from `field.defaultValue`.
 * One place for the rule (used by inputFor for every type + unit-testable without a
 * DOM): `value` for single scalar inputs (text/number/date/radio/hidden), `selected`
 * for select/multiselect option matching, `checked` for the boolean checkbox. An
 * unset default → null / [] / false (nothing pre-filled or checked).
 */
export function fieldDefault(field: FormField): { value: string | null; selected: string[]; checked: boolean } {
  const dv = field.defaultValue
  return {
    value: dv != null && !Array.isArray(dv) ? String(dv) : null,
    selected: Array.isArray(dv) ? dv.map(String) : dv != null ? [String(dv)] : [],
    checked: dv === true || dv === 'true',
  }
}

/** The dial-code dropdown for a phone field, value = the dial code (e.g. "+91"). */
function phoneCcSelect(field: FormField): HTMLSelectElement {
  const sel = el('select', 'tf-phone-cc') as HTMLSelectElement
  sel.setAttribute('aria-label', `${field.label} country code`)
  for (const c of offeredCountries(field.phone?.countries)) {
    sel.append(new Option(`${flagOf(c.iso)} ${c.dial}`, c.dial))
  }
  sel.value = resolveDefaultDial(field.phone)
  return sel
}

function inputFor(field: FormField): HTMLElement {
  const v = field.validation
  const dflt = fieldDefault(field)
  const setCommon = (i: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    i.name = field.name
    i.id = `f_${field.id}`
    i.classList.add('tf-input')
    if (field.placeholder && 'placeholder' in i) (i as HTMLInputElement).placeholder = field.placeholder
  }

  switch (field.type) {
    case 'textarea': {
      const i = el('textarea')
      setCommon(i)
      if (v?.minLength) i.minLength = v.minLength
      if (v?.maxLength) i.maxLength = v.maxLength
      if (dflt.value !== null) i.value = dflt.value
      return i
    }
    case 'select': case 'multiselect': {
      const i = el('select')
      setCommon(i)
      if (field.type === 'multiselect') i.multiple = true
      else i.append(new Option('Select…', ''))
      for (const o of field.options ?? []) {
        const opt = new Option(o.label, o.value)
        if (dflt.selected.includes(o.value)) opt.selected = true
        i.append(opt)
      }
      return i
    }
    case 'radio': {
      const wrap = el('div')
      for (const o of field.options ?? []) {
        const label = el('label', 'tf-radio-label')
        const r = el('input')
        r.type = 'radio'; r.name = field.name; r.value = o.value
        if (dflt.value !== null && o.value === dflt.value) r.checked = true
        label.append(r, ` ${o.label}`)
        wrap.append(label)
      }
      return wrap
    }
    case 'checkbox': {
      const label = el('label', 'tf-checkbox-label')
      const c = el('input')
      c.type = 'checkbox'; c.name = field.name; c.id = `f_${field.id}`; c.value = 'true'
      if (dflt.checked) c.checked = true
      label.append(c, ` ${field.label}`)
      return label
    }
    case 'file': {
      const i = el('input')
      setCommon(i)
      i.type = 'file'
      if (v?.fileTypes?.length) i.accept = v.fileTypes.join(',')
      return i
    }
    case 'hidden': {
      const i = el('input')
      i.type = 'hidden'; i.name = field.name
      if (dflt.value !== null) i.value = dflt.value
      return i
    }
    default: {
      const i = el('input')
      setCommon(i)
      i.type = ({ email: 'email', phone: 'tel', number: 'number', date: 'date' } as Record<string, string>)[field.type] ?? 'text'
      if (v?.minLength) i.minLength = v.minLength
      if (v?.maxLength) i.maxLength = v.maxLength
      if (v?.min !== undefined) i.min = String(v.min)
      if (v?.max !== undefined) i.max = String(v.max)
      if (dflt.value !== null) i.value = dflt.value
      // A phone with the country-code dropdown on: a dial-code select before
      // the number. The input keeps the field name; readData combines them.
      if (field.type === 'phone' && field.phone?.countryCode) {
        const wrap = el('div', 'tf-phone')
        wrap.append(phoneCcSelect(field), i)
        return wrap
      }
      return i
    }
  }
}

function fieldRow(
  field: FormField,
  placement: { label?: 'top' | 'left' | 'hidden'; description?: 'below_label' | 'below_input' } = {},
): HTMLElement {
  // Presentational fields (html) render content only — no label/input/error.
  if (isPresentationalField(field.type)) {
    const wrap = el('div', ['tf-field', 'tf-presentational', field.className].filter(Boolean).join(' '))
    if (field.type === 'html') {
      const box = el('div', 'tf-html')
      box.innerHTML = field.content ?? ''
      wrap.append(box)
    } else if (field.type === 'image' && field.imageSrc) {
      const img = el('img', 'tf-image')
      img.src = field.imageSrc
      img.alt = field.label ?? ''
      wrap.append(img)
    }
    return wrap
  }
  const wrap = el('div', ['tf-field', placement.label === 'left' ? 'tf-field-left' : '', field.className].filter(Boolean).join(' '))
  wrap.dataset.field = field.name
  const input = inputFor(field)
  const help = field.helpText && field.type !== 'hidden' ? el('p', 'tf-help', field.helpText) : null

  if (field.type !== 'hidden' && field.type !== 'checkbox') {
    if (placement.label === 'hidden') {
      input.setAttribute?.('aria-label', field.label)
    } else {
      const label = el('label', 'tf-label', field.label)
      ;(label as HTMLLabelElement).htmlFor = `f_${field.id}`
      if (field.required) label.append(Object.assign(el('span', 'tf-req'), { textContent: '*' }))
      wrap.append(label)
      if (help && placement.description === 'below_label') wrap.append(help)
    }
  }
  wrap.append(input)
  if (help && placement.description !== 'below_label') wrap.append(help)
  const err = el('p', 'tf-err')
  err.id = `e_${field.id}`
  wrap.append(err)
  return wrap
}

/** Reads current values from the rendered inputs (multiselects become arrays). */
function readData(form: HTMLFormElement, fields: FormField[]): Data {
  const data: Data = {}
  for (const f of fields) {
    if (isPresentationalField(f.type)) continue // no value - never collect from html content
    const inputs = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${CSS.escape(f.name)}"]`)
    if (inputs.length === 0) continue
    if (f.type === 'checkbox') {
      data[f.name] = (inputs[0] as HTMLInputElement).checked ? 'true' : ''
    } else if (f.type === 'radio') {
      const checked = [...inputs].find((i) => (i as HTMLInputElement).checked)
      data[f.name] = checked?.value ?? ''
    } else if (f.type === 'multiselect') {
      data[f.name] = [...(inputs[0] as HTMLSelectElement).selectedOptions].map((o) => o.value)
    } else if (f.type === 'phone' && f.phone?.countryCode) {
      const num = (inputs[0] as HTMLInputElement).value
      const sel = (inputs[0] as HTMLElement).closest('.tf-phone')?.querySelector<HTMLSelectElement>('.tf-phone-cc')
      data[f.name] = joinPhoneValue(sel?.value ?? '', num)
    } else {
      data[f.name] = inputs[0].value
    }
  }
  return data
}

/**
 * Boots the interactive form inside `root` from the injected payload.
 */
export function initTangenForm(root: HTMLElement, payload: EmbedPayload): void {
  const { fields, submitUrl } = payload
  const steps = payload.steps && payload.steps.length > 0 ? payload.steps : undefined
  const messages = payload.messages ?? DEFAULT_FORM_MESSAGES
  const grouped = fieldsByStep(fields, steps)
  // FL-3: a `submit` field overrides settings for the submit button text/class.
  const submitBtn = resolveSubmitButton(fields, payload.settings)
  const btnText = submitBtn.text
  const placement = {
    label: payload.settings.labelPlacement,
    description: payload.settings.descriptionPlacement,
  }
  let stepIndex = 0

  // Scheduled availability — show the message instead of the form
  if (payload.availability) {
    const box = el('div', 'tf-unavailable')
    box.append(el('p', 'tf-unavailable-msg', payload.availability.message))
    root.append(box)
    return
  }

  const form = el('form', ['tf-form', payload.settings.wrapperClass].filter(Boolean).join(' ')) as HTMLFormElement
  form.noValidate = true
  form.id = 'tf'

  if (payload.settings.description) {
    root.append(el('p', 'tf-form-desc', payload.settings.description))
  }

  // Validation summary block (populated when validationPlacement === 'summary')
  const summary = el('div', 'tf-summary')
  summary.style.display = 'none'
  if (payload.settings.validationPlacement === 'summary') form.append(summary)

  // Steps render as sections toggled by navigation
  const sections = grouped.map(({ step, fields: stepFields }, i) => {
    const section = el('div', 'tf-step')
    section.dataset.step = step.id
    if (step.title && grouped.length > 1) section.append(el('h3', 'tf-step-title', step.title))
    if (step.description && grouped.length > 1) section.append(el('p', 'tf-step-desc', step.description))
    // submit fields configure the nav button (below), not inline content.
    for (const f of stepFields) { if (f.type === 'submit') continue; section.append(fieldRow(f, placement)) }
    if (i !== 0) section.style.display = 'none'
    return section
  })
  form.append(...sections)

  // Honeypot — visually hidden, real inputs ignore it (skippable per form)
  const honeypotOn = payload.settings.honeypot !== false
  const hp = el('input')
  hp.type = 'text'; hp.name = HONEYPOT_FIELD; hp.tabIndex = -1
  hp.autocomplete = 'off'
  hp.setAttribute('aria-hidden', 'true')
  hp.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0'
  if (honeypotOn) form.append(hp)

  const globalErr = el('p', 'tf-form-error')
  globalErr.id = 'tf-form-error'
  globalErr.style.display = 'none'
  form.append(globalErr)

  // Navigation row: Back / progress / Next-or-Submit
  const nav = el('div', 'tf-nav')
  const backBtn = el('button', 'tf-back', 'Back') as HTMLButtonElement
  backBtn.type = 'button'
  const progress = el('span', 'tf-progress')
  const nextBtn = el('button', ['tf-submit', submitBtn.className].filter(Boolean).join(' ')) as HTMLButtonElement
  nextBtn.type = 'submit'
  if (submitBtn.width === 'full') nextBtn.style.width = '100%'
  else if (submitBtn.width === 'auto') nextBtn.style.width = 'auto'
  if (grouped.length > 1) nav.append(backBtn, progress)
  nav.append(nextBtn)
  form.append(nav)

  const success = el('div', 'tf-success')
  success.id = 'tf-success'
  success.style.display = 'none'

  root.append(form, success)

  const data = () => readData(form, fields)

  /** Steps currently visible given the data (conditional steps can appear/disappear). */
  const visibleStepIdx = () => {
    const d = data()
    return grouped.map((g, i) => ({ i, visible: isStepVisible(g.step, d) })).filter((x) => x.visible).map((x) => x.i)
  }

  function refresh(): void {
    const d = data()
    // per-field visibility
    for (const f of fields) {
      const wrap = form.querySelector<HTMLElement>(`.tf-field[data-field="${CSS.escape(f.name)}"]`)
      if (!wrap) continue
      const show = isFieldVisible(f, d, steps)
      wrap.style.display = show ? '' : 'none'
    }
    // step display + nav state
    const vis = visibleStepIdx()
    if (!vis.includes(stepIndex)) stepIndex = vis[0] ?? 0
    sections.forEach((s, i) => { s.style.display = i === stepIndex ? '' : 'none' })
    const pos = vis.indexOf(stepIndex)
    const isLast = pos === vis.length - 1
    backBtn.style.display = grouped.length > 1 && pos > 0 ? '' : 'none'
    progress.textContent = grouped.length > 1 ? `Step ${pos + 1} of ${vis.length}` : ''
    // FL-3b: per-step custom Next text (localizable), default "Next".
    nextBtn.textContent = isLast ? btnText : (grouped[stepIndex]?.step?.nextButtonText || 'Next')
  }

  function validateStep(onlyStep: number | null): boolean {
    const d = data()
    let ok = true
    const problems: string[] = []
    for (const f of fields) {
      if (onlyStep !== null && grouped.findIndex((g) => g.fields.includes(f)) !== onlyStep) continue
      const errEl = form.querySelector<HTMLElement>(`#e_${CSS.escape(f.id)}`)
      if (errEl) errEl.textContent = ''
      if (!isFieldVisible(f, d, steps)) continue
      const err = validateField(f, d[f.name], messages)
      if (err) {
        ok = false
        problems.push(err)
        if (errEl) errEl.textContent = err
      }
    }
    if (payload.settings.validationPlacement === 'summary') {
      summary.innerHTML = ''
      if (problems.length > 0) {
        const ul = el('ul', 'tf-summary-list')
        for (const pMsg of problems) ul.append(el('li', undefined, pMsg))
        summary.append(ul)
        summary.style.display = ''
        summary.scrollIntoView?.({ block: 'nearest' })
      } else {
        summary.style.display = 'none'
      }
    }
    return ok
  }

  // #53a — remember the visitor's input across reloads (opt-in; may hold PII).
  const draftKey = payload.settings.rememberDraft && payload.formId ? 'tgn:formdraft:' + payload.formId : null
  const saveDraft = () => { if (draftKey) { try { localStorage.setItem(draftKey, JSON.stringify(data())) } catch {} } }
  const clearDraft = () => { if (draftKey) { try { localStorage.removeItem(draftKey) } catch {} } }
  if (draftKey) {
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw) {
        const saved = JSON.parse(raw) as Data
        for (const f of fields) {
          const val = saved[f.name]
          if (val == null) continue
          const inputs = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(f.name)}"]`)
          if (!inputs.length) continue
          const first = inputs[0]
          if (first instanceof HTMLInputElement && first.type === 'checkbox' && inputs.length === 1) {
            first.checked = val === true || val === 'true'
          } else if (first instanceof HTMLInputElement && (first.type === 'checkbox' || first.type === 'radio')) {
            const arr = (Array.isArray(val) ? val : [val]).map(String)
            inputs.forEach((i) => { (i as HTMLInputElement).checked = arr.includes((i as HTMLInputElement).value) })
          } else if (first instanceof HTMLSelectElement && first.multiple) {
            const arr = (Array.isArray(val) ? val : [val]).map(String)
            for (const o of Array.from(first.options)) o.selected = arr.includes(o.value)
          } else if (f.type === 'phone' && f.phone?.countryCode) {
            const { dial, number } = splitPhoneValue(String(val))
            ;(first as HTMLInputElement).value = number
            const sel = (first as HTMLElement).closest('.tf-phone')?.querySelector<HTMLSelectElement>('.tf-phone-cc')
            if (sel && dial) sel.value = dial
          } else {
            (first as HTMLInputElement).value = String(val)
          }
        }
      }
    } catch {}
  }

  form.addEventListener('input', () => { refresh(); saveDraft() })
  form.addEventListener('change', () => { refresh(); saveDraft() })

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    globalErr.style.display = 'none'

    const vis = visibleStepIdx()
    const pos = vis.indexOf(stepIndex)
    if (!validateStep(stepIndex)) return

    if (pos < vis.length - 1) {
      stepIndex = vis[pos + 1]
      refresh()
      return
    }

    // Final step — full validation then submit
    if (!validateStep(null)) return
    const payloadData: Data = { ...data(), ...(honeypotOn ? { [HONEYPOT_FIELD]: hp.value } : {}) }
    nextBtn.disabled = true
    nextBtn.textContent = 'Submitting…'

    fetch(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadData),
    })
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then((res) => {
        if (res.ok && res.body.data?.submitted) {
          clearDraft()
          const conf = res.body.data.confirmation ?? res.body.data
          const delay = Number(conf.redirectDelaySeconds ?? 0)
          // The server already drops an unsafe target (pickConfirmation), and
          // that is the gate that matters because THIS file is cached
          // `immutable, max-age=31536000` - a fix here takes a year to reach
          // deployed sites. The check is repeated anyway because the sink is
          // here: navigating the TOP frame runs on the site's own origin.
          const target = safeRedirectTarget(conf.redirect)
          if (target && delay <= 0) {
            window.top!.location.href = target
            return
          }
          form.style.display = 'none'
          success.innerHTML = ''
          const title = conf.title ?? payload.settings.successTitle
          if (title) success.append(el('h2', 'tf-success-title', title))
          const msgBox = el('div', 'tf-success-msg')
          // confirmation message is author-controlled content — HTML allowed by design
          msgBox.innerHTML = conf.message || res.body.data.message || 'Thank you!'
          success.append(msgBox)
          success.style.display = 'block'
          if (target && delay > 0) {
            setTimeout(() => { window.top!.location.href = target }, delay * 1000)
          }
        } else {
          nextBtn.disabled = false
          nextBtn.textContent = btnText
          const errObj = res.body.error ?? {}
          const fieldErrors: Record<string, string> = errObj.fieldErrors ?? {}
          for (const [name, msg] of Object.entries(fieldErrors)) {
            const f = fields.find((x) => x.name === name)
            const errEl = f && form.querySelector<HTMLElement>(`#e_${CSS.escape(f.id)}`)
            if (errEl) errEl.textContent = msg
          }
          globalErr.textContent = typeof errObj === 'string' ? errObj : (errObj.message ?? 'Submission failed. Please try again.')
          globalErr.style.display = ''
        }
      })
      .catch(() => {
        nextBtn.disabled = false
        nextBtn.textContent = btnText
        globalErr.textContent = 'Network error. Please try again.'
        globalErr.style.display = ''
      })
  })

  backBtn.addEventListener('click', () => {
    const vis = visibleStepIdx()
    const pos = vis.indexOf(stepIndex)
    if (pos > 0) { stepIndex = vis[pos - 1]; refresh() }
  })

  refresh()
}

// Auto-init when running in a page with an injected payload
declare global { interface Window { __TANGEN_FORM__?: EmbedPayload } }
if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.__TANGEN_FORM__) {
  const boot = () => {
    const root = document.getElementById('tangen-form')
    if (root && window.__TANGEN_FORM__) initTangenForm(root, window.__TANGEN_FORM__)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
}
