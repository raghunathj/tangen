/**
 * File Name: preview.tsx
 * Purpose: A live preview of the form as a visitor meets it: the same
 *          visibility rules the runtime applies, defaults seeded, the submit
 *          button the form resolves to. Nothing here posts anywhere.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, ChoiceRow, Heading, Input, RadioGroup, RadioGroupItem, Select, SelectItem, Textarea, cx } from '@/kit'
import type { FormField, FormSettings, FormStep } from '../../contract'
import { fieldsByStep, isFieldVisible, isPresentationalField, isStepVisible, isValuelessField, resolveSubmitButton } from '../../contract'
import { offeredCountries, resolveDefaultDial, splitPhoneValue, joinPhoneValue, flagOf } from '../../contract/phone'

/** The values a fresh render starts with: every default the author set. */
export function seedDefaults(fields: FormField[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fields) {
    if (isValuelessField(f.type) || f.type === 'file') continue
    const dv = f.defaultValue
    if (dv == null) continue
    if (f.type === 'checkbox') { if (dv === true || dv === 'true') out[f.name] = 'true' }
    else if (f.type === 'multiselect') { const arr = Array.isArray(dv) ? dv.map(String) : [String(dv)]; if (arr.length) out[f.name] = arr.join(',') }
    else out[f.name] = String(dv)
  }
  return out
}

function PreviewField({ field, value, onChange }: { field: FormField; value: string; onChange: (v: string) => void }) {
  const span = field.width === 'half' ? 'col-span-1' : 'col-span-2'
  if (isPresentationalField(field.type)) {
    return (
      <div className={cx(span, field.className)}>
        {field.type === 'html' && <div className="prose prose-sm max-w-none text-fg" dangerouslySetInnerHTML={{ __html: field.content ?? '' }} />}
        {field.type === 'image' && (field.imageSrc
          ? <img src={field.imageSrc} alt={field.label} className="max-w-full rounded-control" />
          : <div className="rounded-control border border-dashed border-border bg-surface-sunken px-3 py-6 text-center text-ui-xs text-fg-subtle">No image chosen</div>)}
      </div>
    )
  }
  const id = `pv_${field.id}`
  if (field.type === 'checkbox') {
    return (
      <div className={span}>
        <ChoiceRow htmlFor={id} label={<>{field.label}{field.required && <span className="ml-0.5 text-danger">*</span>}</>} help={field.helpText}
          control={<Checkbox id={id} checked={value === 'true'} onCheckedChange={(c) => onChange(c === true ? 'true' : '')} />} />
      </div>
    )
  }
  return (
    <div className={cx('space-y-1', span)}>
      <label htmlFor={id} className="block text-ui-sm font-medium text-fg">
        {field.label}{field.required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {field.type === 'textarea' && <Textarea id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)} placeholder={field.placeholder} rows={3} />}
      {(field.type === 'text' || field.type === 'email' || field.type === 'number' || field.type === 'date') && (
        <Input id={id} type={field.type} value={value} onChange={(e) => onChange(e.currentTarget.value)} placeholder={field.placeholder} />
      )}
      {field.type === 'phone' && (field.phone?.countryCode ? (
        (() => {
          const { dial, number } = splitPhoneValue(value)
          const cc = dial || resolveDefaultDial(field.phone)
          return (
            <div className="flex items-stretch gap-2">
              <div className="w-28 shrink-0">
                <Select value={cc} onValueChange={(v: string) => onChange(joinPhoneValue(v, number))}>
                  {offeredCountries(field.phone.countries).map((c) => <SelectItem key={c.iso} value={c.dial}>{flagOf(c.iso)} {c.dial}</SelectItem>)}
                </Select>
              </div>
              <Input id={id} type="tel" className="min-w-0 flex-1" value={number} onChange={(e) => onChange(joinPhoneValue(cc, e.currentTarget.value))} placeholder={field.placeholder} />
            </div>
          )
        })()
      ) : (
        <Input id={id} type="tel" value={value} onChange={(e) => onChange(e.currentTarget.value)} placeholder={field.placeholder} />
      ))}
      {field.type === 'select' && (
        <Select value={value || '__none'} onValueChange={(v: string) => onChange(v === '__none' ? '' : v)}>
          <SelectItem value="__none">{field.placeholder ?? 'Choose'}</SelectItem>
          {(field.options ?? []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </Select>
      )}
      {field.type === 'multiselect' && (
        <div className="flex flex-col gap-1.5">
          {(field.options ?? []).map((o) => {
            const chosen = value ? value.split(',') : []
            const on = chosen.includes(o.value)
            return (
              <ChoiceRow key={o.value} htmlFor={`${id}_${o.value}`} label={o.label}
                control={<Checkbox id={`${id}_${o.value}`} checked={on} onCheckedChange={() => onChange((on ? chosen.filter((x) => x !== o.value) : [...chosen, o.value]).join(','))} />} />
            )
          })}
        </div>
      )}
      {field.type === 'radio' && (
        <RadioGroup value={value} onValueChange={onChange} className="flex flex-col gap-1.5">
          {(field.options ?? []).map((o) => (
            <ChoiceRow key={o.value} htmlFor={`${id}_${o.value}`} label={o.label} control={<RadioGroupItem id={`${id}_${o.value}`} value={o.value} />} />
          ))}
        </RadioGroup>
      )}
      {field.type === 'file' && <Input id={id} type="file" accept={(field.validation?.fileTypes ?? []).join(',')} />}
      {field.type === 'hidden' && <Input id={id} value={value} readOnly className="font-mono" />}
      {field.helpText && <p className="text-ui-xs text-fg-subtle">{field.helpText}</p>}
    </div>
  )
}

export function FormPreview({ fields, formName, steps, settings, initialStepId }: { fields: FormField[]; formName: string; steps?: FormStep[]; settings?: FormSettings; initialStepId?: string | null }) {
  const submit = resolveSubmitButton(fields, settings ?? {})
  const [data, setData] = useState<Record<string, string>>(() => seedDefaults(fields))
  const defaultsSig = useMemo(() => JSON.stringify(fields.map((f) => [f.name, f.defaultValue])), [fields])
  useEffect(() => { setData((prev) => ({ ...prev, ...seedDefaults(fields) })) // eslint-disable-line react-hooks/exhaustive-deps
  }, [defaultsSig])

  // The walk the embed makes: one step at a time, conditional steps skipped,
  // Next and Back between them, the submit on the last. Opens on the step
  // selected in the builder, so what you edit is what you see.
  const stepped = Boolean(steps && steps.length > 0)
  const grouped = useMemo(() => fieldsByStep(fields, stepped ? steps : undefined), [fields, steps, stepped])
  const visibleIdx = grouped.map((g, i) => ({ i, on: isStepVisible(g.step, data) })).filter((x) => x.on).map((x) => x.i)
  const [stepIndex, setStepIndex] = useState(() => Math.max(0, grouped.findIndex((g) => g.step.id === initialStepId)))
  useEffect(() => { const i = grouped.findIndex((g) => g.step.id === initialStepId); if (i >= 0) setStepIndex(i) }, [initialStepId, grouped])
  const current = visibleIdx.includes(stepIndex) ? stepIndex : (visibleIdx[0] ?? 0)
  const pos = visibleIdx.indexOf(current)
  const isLast = pos === visibleIdx.length - 1
  const group = grouped[current]
  const visible = (group?.fields ?? []).filter((f) => f.type !== 'submit' && isFieldVisible(f, data, steps))

  return (
    <div className="mx-auto w-full max-w-lg rounded-card border border-border bg-surface p-6 shadow-raised" data-testid="form-preview">
      <Heading level={3} className="mb-5">{formName || 'Untitled form'}</Heading>
      {settings?.description && <p className="-mt-3 mb-5 text-ui-sm text-fg-muted">{settings.description}</p>}
      {stepped && group && (
        <div className="mb-5 flex items-baseline justify-between gap-3 border-b border-border-subtle pb-3">
          <div className="min-w-0">
            <p className="truncate text-ui-sm font-medium text-fg">{group.step.title || `Step ${current + 1}`}</p>
            {group.step.description && <p className="text-ui-xs text-fg-muted">{group.step.description}</p>}
          </div>
          <span className="shrink-0 text-ui-xs text-fg-subtle tabular-nums">Step {pos + 1} of {visibleIdx.length}</span>
        </div>
      )}
      {fields.length === 0 ? (
        <p className="py-8 text-center text-ui-sm text-fg-subtle">Add fields to see the form.</p>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-ui-sm text-fg-subtle">{stepped ? 'This step has no fields yet.' : 'No field is visible.'}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {visible.map((f) => <PreviewField key={f.id} field={f} value={data[f.name] ?? ''} onChange={(v) => setData((p) => ({ ...p, [f.name]: v }))} />)}
        </div>
      )}
      {fields.length > 0 && (
        <div className={cx('mt-5 flex items-center gap-2', submit.width === 'auto' && !stepped ? '' : 'justify-between')}>
          {stepped && pos > 0 ? (
            <Button type="button" variant="secondary" onClick={() => setStepIndex(visibleIdx[pos - 1] ?? 0)}>Back</Button>
          ) : <span />}
          {stepped && !isLast ? (
            <Button type="button" onClick={() => setStepIndex(visibleIdx[pos + 1] ?? current)}>{group?.step.nextButtonText || 'Next'}</Button>
          ) : (
            <Button className={cx(submit.width === 'auto' || stepped ? '' : 'w-full justify-center')} type="button">{submit.text}</Button>
          )}
        </div>
      )}
    </div>
  )
}
