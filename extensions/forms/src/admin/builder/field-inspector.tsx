/**
 * File Name: field-inspector.tsx
 * Purpose: The builder's right pane for one field: what it is (Settings),
 *          what it accepts (Validation), when it shows (Rules) and how it
 *          reads in each language (Translations). One field, one place.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash , IconSearch, IconChevronDown, IconGlobe } from '@tangen/icons'
import {
  Badge, Button, Checkbox, ChoiceRow, Input, Label, MediaPicker, Popover, PopoverTrigger, PopoverContent, Select, SelectItem,
  Tabs, TabsContent, TabsList, TabsTrigger, Textarea, Toggle, buildThumbnailUrl, cx,
} from '@/kit'
import type { FormField, FormStep, PhoneFieldConfig } from '../../contract'
import { defaultValueControlKind, isValuelessField } from '../../contract'
import { PHONE_COUNTRIES, offeredCountries, phoneCountry, resolveDefaultCountry, flagOf } from '../../contract/phone'
import { fieldTypeConfig, hasOptions } from '../field-types'
import { ConditionEditor } from '../conditions'
import { localeTone, useWorkingLocales } from '../locales'
import type { Translations } from '../use-form'

function Field({ label, htmlFor, help, children }: { label: React.ReactNode; htmlFor?: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-1">{label}</Label>
      {children}
      {help && <p className="mt-1 text-ui-xs text-fg-subtle">{help}</p>}
    </div>
  )
}

const MESSAGE_LABELS: Record<string, string> = {
  required: 'When missing', email: 'When not an email', phone: 'When not a phone number', minLength: 'When too short', maxLength: 'When too long',
  number: 'When not a number', min: 'When below the minimum', max: 'When above the maximum', pattern: 'When it does not match',
}

/** A searchable country picker: `multi` for the offer list (checkboxes), single for the default. */
function CountryPicker({ multi, value, onChange, source, placeholder, readOnly }: {
  multi: boolean
  value: string[]
  onChange: (next: string[]) => void
  source: typeof PHONE_COUNTRIES
  placeholder: string
  readOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? source.filter((c) => c.name.toLowerCase().includes(needle) || c.iso.toLowerCase() === needle || c.dial.includes(needle))
    : source
  const summary = value.length === 0
    ? placeholder
    : value.map((iso) => phoneCountry(iso)).filter(Boolean).map((c) => `${flagOf(c!.iso)} ${multi ? c!.iso : c!.name}`).join(', ')
  function pick(iso: string) {
    if (multi) onChange(value.includes(iso) ? value.filter((x) => x !== iso) : [...value, iso])
    else { onChange([iso]); setOpen(false) }
  }
  return (
    <Popover open={open} onOpenChange={(o) => { if (!readOnly) { setOpen(o); if (!o) setQ('') } }}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" disabled={readOnly} className="w-full justify-between gap-2 font-normal" icon={<IconGlobe className="size-3.5 text-fg-subtle" />}>
          <span className={cx('flex-1 truncate text-left', value.length === 0 && 'text-fg-subtle')}>{summary}</span>
          <IconChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border-subtle p-2">
          <Input autoFocus value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Search countries" icon={<IconSearch className="size-3.5" />} aria-label="Search countries" />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {shown.map((c) => {
            const on = value.includes(c.iso)
            return (
              <Button key={c.iso} type="button" size="sm" variant="ghost" onClick={() => pick(c.iso)}
                className={cx('w-full justify-start gap-2 rounded-none px-3 font-normal', on && 'bg-surface-sunken')}>
                {multi && <Checkbox checked={on} tabIndex={-1} aria-hidden className="pointer-events-none" />}
                <span aria-hidden>{flagOf(c.iso)}</span>
                <span className="flex-1 truncate text-left">{c.name}</span>
                <span className="shrink-0 text-ui-xs text-fg-subtle tabular-nums">{c.dial}</span>
              </Button>
            )
          })}
          {shown.length === 0 && <p className="px-3 py-6 text-center text-ui-xs text-fg-subtle">No country matches.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function FieldInspector({ field, allFields, steps, readOnly, translations, onChange, onTranslate }: {
  field: FormField
  allFields: FormField[]
  steps?: FormStep[]
  readOnly: boolean
  translations: Translations
  onChange: (next: FormField) => void
  onTranslate: (locale: string, path: string[], value: string) => void
}) {
  const [tab, setTab] = useState('settings')
  const [mediaOpen, setMediaOpen] = useState(false)
  const { enabled: localesOn, locales, codes } = useWorkingLocales()
  const [locale, setLocale] = useState<string>('')
  useEffect(() => { if (!locale && locales[0]) setLocale(locales[0].code) }, [locales, locale])
  useEffect(() => { setTab('settings') }, [field.id])

  const config = fieldTypeConfig(field.type)
  const Icon = config?.icon
  const others = allFields.filter((f) => f.id !== field.id)
  const valueless = isValuelessField(field.type)
  const patch = (p: Partial<FormField>) => onChange({ ...field, ...p })
  const options = field.options ?? []
  const setOptions = (next: FormField['options']) => patch({ options: next })
  const kind = defaultValueControlKind(field.type)
  const id = (k: string) => `fi_${field.id}_${k}`

  const tr = locale ? (translations[locale]?.fields?.[field.id] ?? {}) : {}
  // The messages this field words itself (the legacy patternMessage reads as messages.pattern).
  const ownMessages: Record<string, string> = { ...(field.validation?.patternMessage ? { pattern: field.validation.patternMessage } : {}), ...(field.validation?.messages ?? {}) }
  const setMessage = (k: string, value: string) => {
    const { patternMessage: _legacy, ...rest } = field.validation ?? {}
    const messages = { ...(field.validation?.messages ?? {}), ...(k === 'pattern' && _legacy && !field.validation?.messages?.pattern ? { pattern: _legacy } : {}) }
    if (value) messages[k as keyof typeof messages] = value; else delete messages[k as keyof typeof messages]
    patch({ validation: { ...rest, ...(k === 'pattern' ? {} : (_legacy ? { patternMessage: _legacy } : {})), messages: Object.keys(messages).length ? messages : undefined } })
  }
  const MessageRow = ({ k, label }: { k: string; label: string }) => (
    <Field label={label} htmlFor={id(`msg-${k}`)}>
      <Input id={id(`msg-${k}`)} disabled={readOnly} value={ownMessages[k] ?? ''} placeholder="The form-wide message" onChange={(e) => setMessage(k, e.currentTarget.value)} />
    </Field>
  )
  const tone = locale ? localeTone(locale, codes) : null

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="field-inspector">
      <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3">
        <span className="flex size-7 items-center justify-center rounded-control bg-surface-sunken text-fg-muted">{Icon ? <Icon className="size-4" /> : null}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui-sm font-medium text-fg">{field.label || 'Untitled field'}</p>
          <p className="text-ui-xs text-fg-subtle">{config?.label ?? field.type}</p>
        </div>
        {field.required && <Badge variant="neutral">Required</Badge>}
      </div>

      <Tabs value={tab} onValueChange={setTab} variant="underline" className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pt-3">
          <TabsList>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            {!valueless && <TabsTrigger value="validation">Validation</TabsTrigger>}
            <TabsTrigger value="style">Style</TabsTrigger>
            {field.type !== 'submit' && others.length > 0 && <TabsTrigger value="rules">Rules</TabsTrigger>}
            {localesOn && <TabsTrigger value="translations">Translations</TabsTrigger>}
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <TabsContent value="settings" className="space-y-4">
            <Field label={field.type === 'submit' ? 'Button text' : 'Label'} htmlFor={id('label')}>
              <Input id={id('label')} value={field.label} disabled={readOnly} onChange={(e) => patch({ label: e.currentTarget.value })} />
            </Field>

            {field.type === 'html' && (
              <Field label="HTML" htmlFor={id('html')} help="Rendered as written. Holds no submission value.">
                <Textarea id={id('html')} rows={6} className="font-mono text-ui-xs" value={field.content ?? ''} disabled={readOnly} onChange={(e) => patch({ content: e.currentTarget.value })} />
              </Field>
            )}
            {field.type === 'image' && (
              <Field label="Image" help="The label above is its alt text.">
                <div className="flex items-center gap-2">
                  <Input value={field.imageSrc ?? ''} disabled={readOnly} placeholder="https://…" onChange={(e) => patch({ imageSrc: e.currentTarget.value || undefined })} />
                  <Button size="sm" variant="secondary" disabled={readOnly} onClick={() => setMediaOpen(true)}>Choose</Button>
                </div>
                {field.imageSrc && <img src={field.imageSrc} alt="" className="mt-2 max-h-28 rounded-control border border-border" />}
              </Field>
            )}

            {!valueless && (
              <Field label="Field name" htmlFor={id('name')} help="The key in submissions and the API.">
                <Input id={id('name')} className="font-mono" value={field.name} disabled={readOnly}
                  onChange={(e) => patch({ name: e.currentTarget.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') })} />
              </Field>
            )}
            {!valueless && field.type !== 'checkbox' && field.type !== 'hidden' && (
              <Field label="Placeholder" htmlFor={id('ph')}>
                <Input id={id('ph')} value={field.placeholder ?? ''} disabled={readOnly} onChange={(e) => patch({ placeholder: e.currentTarget.value || undefined })} />
              </Field>
            )}
            {!valueless && (
              <Toggle size="sm" label="Show in submissions list" description="A column of its own on the Submissions page. With nothing chosen, the first three fields show." checked={!!field.showInList} disabled={readOnly} onCheckedChange={(v) => patch({ showInList: v || undefined })} />
            )}

            {field.type === 'phone' && (() => {
              const phone = field.phone ?? {}
              const setPhone = (p: Partial<PhoneFieldConfig>) => {
                const next = { ...phone, ...p }
                patch({ phone: next.countryCode ? next : undefined })
              }
              const offered = offeredCountries(phone.countries)
              return (
                <div className="space-y-3 rounded-control border border-border bg-surface-sunken p-3">
                  <Toggle size="sm" label="Country code dropdown" description="A dial-code picker before the number. The submission stores the code with it." checked={!!phone.countryCode} disabled={readOnly} onCheckedChange={(v) => setPhone({ countryCode: v })} />
                  {phone.countryCode && (
                    <>
                      <Field label="Countries to show" help="Leave empty to offer every country.">
                        <CountryPicker multi readOnly={readOnly} source={PHONE_COUNTRIES} placeholder="All countries"
                          value={phone.countries ?? []}
                          onChange={(next) => setPhone({ countries: next.length ? next : undefined, defaultCountry: phone.defaultCountry && next.length && !next.includes(phone.defaultCountry) ? undefined : phone.defaultCountry })} />
                      </Field>
                      <Field label="Default country" help="Selected when the form opens.">
                        <CountryPicker multi={false} readOnly={readOnly} source={offered} placeholder={`First offered (${phoneCountry(resolveDefaultCountry(phone))?.name ?? ''})`}
                          value={phone.defaultCountry ? [phone.defaultCountry] : []}
                          onChange={(next) => setPhone({ defaultCountry: next[0] })} />
                      </Field>
                    </>
                  )}
                </div>
              )
            })()}
            {field.type !== 'submit' && (
              <Field label="Help text" htmlFor={id('help')}>
                <Input id={id('help')} value={field.helpText ?? ''} disabled={readOnly} onChange={(e) => patch({ helpText: e.currentTarget.value || undefined })} />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              {steps && steps.length > 0 && (
                <Field label="Step" htmlFor={id('step')}>
                  <Select id={id('step')} value={field.stepId ?? steps[0]!.id} disabled={readOnly} onValueChange={(v: string) => patch({ stepId: v })}>
                    {steps.map((s, i) => <SelectItem key={s.id} value={s.id}>{s.title || `Step ${i + 1}`}</SelectItem>)}
                  </Select>
                </Field>
              )}
            </div>

            {kind !== 'none' && (
              <Field label="Default value" help="Pre-filled when the form opens.">
                {kind === 'checkbox' ? (
                  <ChoiceRow htmlFor={id('dv')} label="Checked by default" control={<Checkbox id={id('dv')} disabled={readOnly} checked={field.defaultValue === true || field.defaultValue === 'true'} onCheckedChange={(v) => patch({ defaultValue: v === true ? true : undefined })} />} />
                ) : kind === 'option' ? (
                  <Select value={typeof field.defaultValue === 'string' && field.defaultValue ? field.defaultValue : '__none'} disabled={readOnly} onValueChange={(v: string) => patch({ defaultValue: v === '__none' ? undefined : v })}>
                    <SelectItem value="__none">None</SelectItem>
                    {options.filter((o) => o.value).map((o) => <SelectItem key={o.value} value={o.value}>{o.label || o.value}</SelectItem>)}
                  </Select>
                ) : kind === 'multiOption' ? (
                  options.length === 0 ? <p className="text-ui-xs text-fg-subtle">Add options first.</p> : (
                    <div className="space-y-1.5">
                      {options.map((o) => {
                        const chosen = Array.isArray(field.defaultValue) ? (field.defaultValue as string[]) : []
                        const on = chosen.includes(o.value)
                        return <ChoiceRow key={o.value} htmlFor={id(`dv_${o.value}`)} label={o.label || o.value} control={<Checkbox id={id(`dv_${o.value}`)} disabled={readOnly} checked={on} onCheckedChange={() => { const next = on ? chosen.filter((x) => x !== o.value) : [...chosen, o.value]; patch({ defaultValue: next.length ? next : undefined }) }} />} />
                      })}
                    </div>
                  )
                ) : (
                  <Input type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'} disabled={readOnly} value={field.defaultValue == null ? '' : String(field.defaultValue)} onChange={(e) => patch({ defaultValue: e.currentTarget.value === '' ? undefined : e.currentTarget.value })} />
                )}
              </Field>
            )}

            {hasOptions(field.type) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Options</Label>
                  <ChoiceRow htmlFor={id('from')} label={<span className="text-ui-xs text-fg-muted">From content</span>}
                    control={<Checkbox id={id('from')} disabled={readOnly} checked={!!field.optionsFrom}
                      onCheckedChange={(v) => patch({ optionsFrom: v === true ? { source: 'content', type: '', labelField: 'title', valueField: 'id', limit: 100 } : undefined })} />} />
                </div>
                {field.optionsFrom ? (
                  <div className="space-y-2 rounded-control border border-border bg-surface-sunken p-2.5">
                    <Input value={field.optionsFrom.type} disabled={readOnly} placeholder="Content type, e.g. category" onChange={(e) => patch({ optionsFrom: { ...field.optionsFrom!, type: e.currentTarget.value } })} />
                    <div className="grid grid-cols-3 gap-2">
                      <Input value={field.optionsFrom.labelField ?? ''} disabled={readOnly} placeholder="Label field" onChange={(e) => patch({ optionsFrom: { ...field.optionsFrom!, labelField: e.currentTarget.value || undefined } })} />
                      <Input value={field.optionsFrom.valueField ?? ''} disabled={readOnly} placeholder="Value field" onChange={(e) => patch({ optionsFrom: { ...field.optionsFrom!, valueField: e.currentTarget.value || undefined } })} />
                      <Input type="number" value={field.optionsFrom.limit ?? 100} disabled={readOnly} aria-label="Limit" onChange={(e) => patch({ optionsFrom: { ...field.optionsFrom!, limit: Number(e.currentTarget.value) || undefined } })} />
                    </div>
                    <p className="text-ui-xs text-fg-subtle">Published entries of this type become the options, at render and at submit.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {options.map((o, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <Input value={o.label} disabled={readOnly} placeholder="Label" aria-label={`Option ${i + 1} label`} onChange={(e) => setOptions(options.map((x, idx) => (idx === i ? { ...x, label: e.currentTarget.value } : x)))} />
                        <Input value={o.value} disabled={readOnly} placeholder="Value" aria-label={`Option ${i + 1} value`} className="font-mono" onChange={(e) => setOptions(options.map((x, idx) => (idx === i ? { ...x, value: e.currentTarget.value } : x)))} />
                        <Button size="xs" variant="ghost" aria-label="Move up" disabled={readOnly || i === 0} onClick={() => { const n = [...options]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; setOptions(n) }}><IconArrowUp className="size-3.5" /></Button>
                        <Button size="xs" variant="ghost" aria-label="Move down" disabled={readOnly || i === options.length - 1} onClick={() => { const n = [...options]; [n[i + 1], n[i]] = [n[i]!, n[i + 1]!]; setOptions(n) }}><IconArrowDown className="size-3.5" /></Button>
                        <Button size="xs" variant="ghost" aria-label="Remove option" disabled={readOnly} onClick={() => setOptions(options.filter((_, idx) => idx !== i))}><IconTrash className="size-3.5" /></Button>
                      </div>
                    ))}
                    <Button size="xs" variant="ghost" icon={<IconPlus className="size-3.5" />} disabled={readOnly} onClick={() => setOptions([...options, { label: '', value: '' }])}>Add option</Button>
                  </div>
                )}
              </div>
            )}

          </TabsContent>

          <TabsContent value="validation" className="space-y-4">
            <Toggle size="sm" label="Required" description="The form refuses a submission without it." checked={!!field.required} disabled={readOnly} onCheckedChange={(v) => patch({ required: v })} />
            {field.required && <MessageRow k="required" label="Message when it is missing" />}
            {field.type === 'email' && <MessageRow k="email" label="Message when it is not an email" />}
            {field.type === 'phone' && <MessageRow k="phone" label="Message when it is not a phone number" />}
            {(field.type === 'text' || field.type === 'textarea') && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Min length" htmlFor={id('minl')}><Input id={id('minl')} type="number" disabled={readOnly} value={field.validation?.minLength ?? ''} onChange={(e) => patch({ validation: { ...field.validation, minLength: e.currentTarget.value ? Number(e.currentTarget.value) : undefined } })} /></Field>
                <Field label="Max length" htmlFor={id('maxl')}><Input id={id('maxl')} type="number" disabled={readOnly} value={field.validation?.maxLength ?? ''} onChange={(e) => patch({ validation: { ...field.validation, maxLength: e.currentTarget.value ? Number(e.currentTarget.value) : undefined } })} /></Field>
              </div>
            )}
            {field.validation?.minLength !== undefined && <MessageRow k="minLength" label="Message when too short" />}
            {field.validation?.maxLength !== undefined && <MessageRow k="maxLength" label="Message when too long" />}
            {field.type === 'number' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Minimum" htmlFor={id('min')}><Input id={id('min')} type="number" disabled={readOnly} value={field.validation?.min ?? ''} onChange={(e) => patch({ validation: { ...field.validation, min: e.currentTarget.value ? Number(e.currentTarget.value) : undefined } })} /></Field>
                <Field label="Maximum" htmlFor={id('max')}><Input id={id('max')} type="number" disabled={readOnly} value={field.validation?.max ?? ''} onChange={(e) => patch({ validation: { ...field.validation, max: e.currentTarget.value ? Number(e.currentTarget.value) : undefined } })} /></Field>
              </div>
            )}
            {field.type === 'number' && <MessageRow k="number" label="Message when it is not a number" />}
            {field.validation?.min !== undefined && <MessageRow k="min" label="Message when below the minimum" />}
            {field.validation?.max !== undefined && <MessageRow k="max" label="Message when above the maximum" />}
            {field.type === 'file' && (
              <>
                <Field label="Allowed types" htmlFor={id('ft')} help="Comma separated, e.g. image/*, .pdf"><Input id={id('ft')} disabled={readOnly} value={(field.validation?.fileTypes ?? []).join(', ')} onChange={(e) => patch({ validation: { ...field.validation, fileTypes: e.currentTarget.value.split(',').map((s) => s.trim()).filter(Boolean) } })} /></Field>
                <Field label="Max size (MB)" htmlFor={id('fs')}><Input id={id('fs')} type="number" disabled={readOnly} value={field.validation?.maxFileSize ? field.validation.maxFileSize / 1048576 : ''} onChange={(e) => patch({ validation: { ...field.validation, maxFileSize: e.currentTarget.value ? Number(e.currentTarget.value) * 1048576 : undefined } })} /></Field>
              </>
            )}
            <Field label="Pattern" htmlFor={id('pat')} help="A regular expression the value must match.">
              <Input id={id('pat')} className="font-mono" disabled={readOnly} value={field.validation?.pattern ?? ''} placeholder="^[A-Z]{3}$" onChange={(e) => patch({ validation: { ...field.validation, pattern: e.currentTarget.value || undefined } })} />
            </Field>
            {field.validation?.pattern && <MessageRow k="pattern" label="Message when it does not match" />}
            <p className="text-ui-xs text-fg-subtle">A message left empty uses the form-wide one under Settings, Texts. {'{label}'} and {'{n}'} fill in the field's label and the limit.</p>
          </TabsContent>

          <TabsContent value="style" className="space-y-4">
            <Field label="Width" htmlFor={id('width')} help="Half puts two fields side by side.">
              <Select id={id('width')} value={field.width ?? 'full'} disabled={readOnly} onValueChange={(v: string) => patch({ width: v as 'full' | 'half' })}>
                <SelectItem value="full">Full</SelectItem>
                <SelectItem value="half">Half</SelectItem>
              </Select>
            </Field>
            <Field label="CSS class" htmlFor={id('css')} help="On the field's wrapper in the rendered form.">
              <Input id={id('css')} value={field.className ?? ''} disabled={readOnly} className="font-mono" onChange={(e) => patch({ className: e.currentTarget.value || undefined })} />
            </Field>
          </TabsContent>

          <TabsContent value="rules" className="space-y-3">
            <p className="text-ui-sm text-fg-muted">Show this field only when the rules hold. No rules: always shown.</p>
            <ConditionEditor showIf={field.showIf} candidateFields={others} disabled={readOnly} onChange={(showIf) => patch({ showIf })} />
          </TabsContent>

          <TabsContent value="translations" className="space-y-4">
            <Field label="Language" htmlFor={id('loc')}>
              <Select id={id('loc')} value={locale} onValueChange={setLocale}>
                {locales.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
              </Select>
            </Field>
            {locale && tone && (
              <div className={cx('space-y-3 border-l-2 pl-3', tone.rail)}>
                <Field label={<>Label <span className="font-normal text-fg-subtle">· {field.label}</span></>}>
                  <Input value={tr.label ?? ''} placeholder={field.label} onChange={(e) => onTranslate(locale, ['fields', field.id, 'label'], e.currentTarget.value)} />
                </Field>
                {!valueless && field.type !== 'checkbox' && field.type !== 'hidden' && (
                  <Field label={<>Placeholder{field.placeholder && <span className="font-normal text-fg-subtle"> · {field.placeholder}</span>}</>}>
                    <Input value={tr.placeholder ?? ''} disabled={!field.placeholder} placeholder={field.placeholder || 'Set a placeholder under Settings first'} onChange={(e) => onTranslate(locale, ['fields', field.id, 'placeholder'], e.currentTarget.value)} />
                  </Field>
                )}
                {field.type !== 'submit' && (
                  <Field label={<>Help text{field.helpText && <span className="font-normal text-fg-subtle"> · {field.helpText}</span>}</>}>
                    <Input value={tr.helpText ?? ''} disabled={!field.helpText} placeholder={field.helpText || 'Set a help text under Settings first'} onChange={(e) => onTranslate(locale, ['fields', field.id, 'helpText'], e.currentTarget.value)} />
                  </Field>
                )}
                {(field.type === 'text' || field.type === 'textarea' || field.type === 'email' || field.type === 'phone' || field.type === 'hidden') && (
                  <Field label={<>Default value{typeof field.defaultValue === 'string' && field.defaultValue && <span className="font-normal text-fg-subtle"> · {field.defaultValue}</span>}</>} help="This language's own pre-filled value.">
                    <Input value={tr.defaultValue ?? ''} placeholder={typeof field.defaultValue === 'string' ? field.defaultValue : ''} onChange={(e) => onTranslate(locale, ['fields', field.id, 'defaultValue'], e.currentTarget.value)} />
                  </Field>
                )}
                {Object.entries(ownMessages).map(([k, base]) => (
                  <Field key={k} label={<>{MESSAGE_LABELS[k] ?? k} <span className="font-normal text-fg-subtle">· {base}</span></>}>
                    <Input value={tr.messages?.[k] ?? ''} placeholder={base} onChange={(e) => onTranslate(locale, ['fields', field.id, 'messages', k], e.currentTarget.value)} />
                  </Field>
                ))}
                {!valueless && Object.keys(ownMessages).length === 0 && <p className="text-ui-xs text-fg-subtle">Validation messages worded under Validation appear here for translation; the form-wide ones translate under Settings, Texts.</p>}
                {field.type === 'html' && field.content && (
                  <Field label="HTML">
                    <Textarea rows={5} className="font-mono text-ui-xs" value={tr.content ?? ''} placeholder={field.content} onChange={(e) => onTranslate(locale, ['fields', field.id, 'content'], e.currentTarget.value)} />
                  </Field>
                )}
                {!field.optionsFrom && options.filter((o) => o.value).map((o) => (
                  <Field key={o.value} label={<>Option <span className="font-normal text-fg-subtle">· {o.label}</span></>}>
                    <Input value={tr.options?.[o.value] ?? ''} placeholder={o.label} onChange={(e) => onTranslate(locale, ['fields', field.id, 'options', o.value], e.currentTarget.value)} />
                  </Field>
                ))}
                {field.optionsFrom && <p className="text-ui-xs text-fg-subtle">Options come from content and translate with it.</p>}
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>

      <MediaPicker open={mediaOpen} onOpenChange={setMediaOpen} accept={['image']} onSelect={(asset: { id: string; url?: string }) => { patch({ imageSrc: asset.url ?? buildThumbnailUrl(asset.id) }); setMediaOpen(false) }} />
    </div>
  )
}
