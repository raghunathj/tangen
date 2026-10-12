/**
 * File Name: settings.tsx
 * Purpose: A form's settings, one section per page and a way back to the
 *          builder: Form (how it presents and when it is open), Texts (the
 *          button, the thank-you, the validation messages, translated),
 *          Confirmations, Notifications, Personal data, Embed. Every section
 *          saves through the same form state the builder uses.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IconCopy, IconPlus, IconSurvey, IconTrash } from '@tangen/icons'
import {
  AdminPage, Badge, Button, Callout, Card, Checkbox, ChoiceRow, CodeBlock, DatePicker, ErrorState, FormFooter, FormRow, FormSection,
  Input, Label, Select, SelectItem, Textarea, Toggle, toast, useCan, cx,
} from '@/kit'
import type { FormConfirmation, FormNotification, FormSettings, NotificationRoute } from '../../contract'
import { DEFAULT_FORM_MESSAGES } from '../../contract'
import { formsApi, type EmbedUrls } from '../api'
import { useForm, type FormState } from '../use-form'
import { ConditionEditor } from '../conditions'
import { localeTone, useWorkingLocales } from '../locales'
import { DestinationsSectionPage } from './destinations'

export const SETTINGS_SECTIONS = [
  { id: 'form', label: 'Form', icon: 'IconSettings' },
  { id: 'texts', label: 'Texts', icon: 'IconLanguage' },
  { id: 'confirmations', label: 'Confirmations', icon: 'IconCheckCircle' },
  { id: 'notifications', label: 'Notifications', icon: 'IconMail' },
  { id: 'destinations', label: 'Destinations', icon: 'IconGitBranch' },
  { id: 'personal-data', label: 'Personal data', icon: 'IconEyeOff' },
  { id: 'embed', label: 'Embed', icon: 'IconCode' },
] as const
type SectionId = typeof SETTINGS_SECTIONS[number]['id']

const newId = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`

/** A per-locale translation row group with the locale's tone on its edge. */
function LocaleRows({ children, code, codes, label }: { children: React.ReactNode; code: string; codes: string[]; label: string }) {
  const tone = localeTone(code, codes)
  return (
    <div className={cx('space-y-2 border-l-2 pl-3', tone.rail)}>
      <p className="text-ui-2xs font-semibold uppercase tracking-wider text-fg-subtle">{label}</p>
      {children}
    </div>
  )
}

function SaveFooter({ form }: { form: FormState }) {
  return (
    <FormFooter>
      <Button size="sm" isLoading={form.saving} disabled={form.readOnly || !form.dirty} onClick={() => form.save()}>Save changes</Button>
    </FormFooter>
  )
}

// ── Sections ─────────────────────────────────────────────────────────────────

function FormSectionPage({ form }: { form: FormState }) {
  const s = form.settings
  const ro = form.readOnly
  const { enabled: localesOn, locales, codes } = useWorkingLocales()
  const rows = [
    s.description ? { key: 'description', label: 'Description', base: s.description } : null,
    s.schedule?.notYetOpenMessage ? { key: 'notYetOpenMessage', label: 'Before it opens', base: s.schedule.notYetOpenMessage } : null,
    s.schedule?.closedMessage ? { key: 'closedMessage', label: 'After it closes', base: s.schedule.closedMessage } : null,
    s.entryLimit?.limitMessage ? { key: 'limitMessage', label: 'At the entry limit', base: s.entryLimit.limitMessage } : null,
  ].filter(Boolean) as { key: string; label: string; base: string }[]
  return (
    <>
      <FormSection title="Presentation" description="How the form reads on the page.">
        <FormRow label="Name" htmlFor="s-name"><Input id="s-name" value={form.name} disabled={ro} onChange={(e) => form.setName(e.currentTarget.value)} /></FormRow>
        <FormRow label="Description" htmlFor="s-desc" help="Shown above the fields.">
          <Textarea id="s-desc" rows={2} value={s.description ?? ''} disabled={ro} onChange={(e) => form.updateSettings({ description: e.currentTarget.value || undefined })} />
        </FormRow>
        <FormRow label="Labels" htmlFor="s-lp">
          <Select id="s-lp" value={s.labelPlacement ?? 'top'} disabled={ro} onValueChange={(v: string) => form.updateSettings({ labelPlacement: v === 'top' ? undefined : (v as FormSettings['labelPlacement']) })}>
            <SelectItem value="top">Above the input</SelectItem>
            <SelectItem value="left">Left of the input</SelectItem>
            <SelectItem value="hidden">Hidden, screen readers keep them</SelectItem>
          </Select>
        </FormRow>
        <FormRow label="Help text" htmlFor="s-dp">
          <Select id="s-dp" value={s.descriptionPlacement ?? 'below_input'} disabled={ro} onValueChange={(v: string) => form.updateSettings({ descriptionPlacement: v === 'below_input' ? undefined : (v as FormSettings['descriptionPlacement']) })}>
            <SelectItem value="below_input">Below the input</SelectItem>
            <SelectItem value="below_label">Below the label</SelectItem>
          </Select>
        </FormRow>
        <FormRow label="Validation messages" htmlFor="s-vp">
          <Select id="s-vp" value={s.validationPlacement ?? 'inline'} disabled={ro} onValueChange={(v: string) => form.updateSettings({ validationPlacement: v === 'inline' ? undefined : (v as FormSettings['validationPlacement']) })}>
            <SelectItem value="inline">Under each field</SelectItem>
            <SelectItem value="summary">As a summary at the top</SelectItem>
          </Select>
        </FormRow>
        <FormRow label="CSS class" htmlFor="s-wc" help="On the form element in the rendered page.">
          <Input id="s-wc" className="font-mono" value={s.wrapperClass ?? ''} disabled={ro} onChange={(e) => form.updateSettings({ wrapperClass: e.currentTarget.value || undefined })} />
        </FormRow>
      </FormSection>

      <FormSection title="Availability" description="When the form accepts entries.">
        <FormRow label="Open between" help="Your local time, stored as UTC. Leave empty for always.">
          <div className="flex items-center gap-2">
            <DatePicker withTime className="flex-1" value={s.schedule?.opensAt} onChange={(v) => form.updateSettings({ schedule: { ...s.schedule, opensAt: v || undefined } })} placeholder="Opens" />
            <span className="text-ui-xs text-fg-subtle">and</span>
            <DatePicker withTime className="flex-1" value={s.schedule?.closesAt} onChange={(v) => form.updateSettings({ schedule: { ...s.schedule, closesAt: v || undefined } })} placeholder="Closes" />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Input value={s.schedule?.notYetOpenMessage ?? ''} disabled={ro} placeholder="Message before it opens" onChange={(e) => form.updateSettings({ schedule: { ...s.schedule, notYetOpenMessage: e.currentTarget.value || undefined } })} />
            <Input value={s.schedule?.closedMessage ?? ''} disabled={ro} placeholder="Message after it closes" onChange={(e) => form.updateSettings({ schedule: { ...s.schedule, closedMessage: e.currentTarget.value || undefined } })} />
          </div>
        </FormRow>
        <FormRow label="Entry limit" help="Stop accepting entries past a count.">
          <div className="flex items-center gap-2">
            <Input type="number" min={0} className="w-28" value={s.entryLimit?.max ?? ''} disabled={ro} placeholder="None"
              onChange={(e) => { const max = Number(e.currentTarget.value); form.updateSettings({ entryLimit: max > 0 ? { period: 'total', ...s.entryLimit, max } : undefined }) }} />
            <div className="w-40">
              <Select value={s.entryLimit?.period ?? 'total'} disabled={ro || !s.entryLimit?.max} onValueChange={(v: string) => form.updateSettings({ entryLimit: { ...s.entryLimit!, period: v as NonNullable<FormSettings['entryLimit']>['period'] } })}>
                <SelectItem value="total">in total</SelectItem>
                <SelectItem value="day">per day</SelectItem>
                <SelectItem value="week">per week</SelectItem>
                <SelectItem value="month">per month</SelectItem>
                <SelectItem value="year">per year</SelectItem>
              </Select>
            </div>
          </div>
          {s.entryLimit?.max ? <Input className="mt-2" value={s.entryLimit.limitMessage ?? ''} disabled={ro} placeholder="Message at the limit" onChange={(e) => form.updateSettings({ entryLimit: { ...s.entryLimit!, limitMessage: e.currentTarget.value || undefined } })} /> : null}
        </FormRow>
        <FormRow label="Spam">
          <ChoiceRow htmlFor="s-hp" label="Honeypot" help="A hidden field bots fill and people never see." control={<Checkbox id="s-hp" disabled={ro} checked={s.honeypot !== false} onCheckedChange={(v) => form.updateSettings({ honeypot: v === true ? undefined : false })} />} />
        </FormRow>
      </FormSection>

      {localesOn && rows.length > 0 && (
        <FormSection title="Translations" description="The texts above, in each language.">
          {locales.map((l) => (
            <LocaleRows key={l.code} code={l.code} codes={codes} label={l.label}>
              {rows.map((r) => (
                <div key={r.key}>
                  <Label className="mb-1">{r.label}</Label>
                  <Input value={form.translations[l.code]?.settings?.[r.key] ?? ''} placeholder={r.base} onChange={(e) => form.translate(l.code, ['settings', r.key], e.currentTarget.value)} />
                </div>
              ))}
            </LocaleRows>
          ))}
        </FormSection>
      )}
      <SaveFooter form={form} />
    </>
  )
}

function TextsSectionPage({ form }: { form: FormState }) {
  const s = form.settings as FormSettings & Record<string, any>
  const ro = form.readOnly
  const { enabled: localesOn, locales, codes } = useWorkingLocales()
  const messageKeys = Object.keys(DEFAULT_FORM_MESSAGES) as (keyof typeof DEFAULT_FORM_MESSAGES)[]
  return (
    <>
      <FormSection title="Submit button" description="A Submit field in the builder overrides these.">
        <FormRow label="Text" htmlFor="t-btn"><Input id="t-btn" value={s.submitButtonText ?? ''} disabled={ro} placeholder="Submit" onChange={(e) => form.updateSettings({ submitButtonText: e.currentTarget.value || undefined })} /></FormRow>
        <FormRow label="Width" htmlFor="t-w">
          <Select id="t-w" value={s.submitButtonWidth === 'auto' ? 'auto' : 'full'} disabled={ro} onValueChange={(v: string) => form.updateSettings({ submitButtonWidth: v === 'auto' ? 'auto' : undefined })}>
            <SelectItem value="full">Full width</SelectItem>
            <SelectItem value="auto">Fits the text</SelectItem>
          </Select>
        </FormRow>
        <FormRow label="CSS class" htmlFor="t-bc"><Input id="t-bc" className="font-mono" value={s.submitButtonClass ?? ''} disabled={ro} onChange={(e) => form.updateSettings({ submitButtonClass: e.currentTarget.value || undefined })} /></FormRow>
      </FormSection>
      <FormSection title="Thank you" description="Shown after a submission when no confirmation rule matches.">
        <FormRow label="Title" htmlFor="t-st"><Input id="t-st" value={s.successTitle ?? ''} disabled={ro} placeholder="Thanks!" onChange={(e) => form.updateSettings({ successTitle: e.currentTarget.value || undefined })} /></FormRow>
        <FormRow label="Message" htmlFor="t-sm"><Textarea id="t-sm" rows={2} value={s.successMessage ?? ''} disabled={ro} placeholder="We have received your submission." onChange={(e) => form.updateSettings({ successMessage: e.currentTarget.value || undefined })} /></FormRow>
      </FormSection>
      {localesOn && (
        <FormSection title="Translations" description="The button, the thank-you and the validation messages in each language. {label} and {n} fill in by themselves.">
          {locales.map((l) => {
            const ts = form.translations[l.code]?.settings ?? {}
            const tm = form.translations[l.code]?.messages ?? {}
            return (
              <LocaleRows key={l.code} code={l.code} codes={codes} label={l.label}>
                <Input value={ts.submitButtonText ?? ''} placeholder={s.submitButtonText || 'Submit'} aria-label={`Submit button, ${l.label}`} onChange={(e) => form.translate(l.code, ['settings', 'submitButtonText'], e.currentTarget.value)} />
                <Input value={ts.successTitle ?? ''} placeholder={s.successTitle || 'Thanks!'} aria-label={`Thank-you title, ${l.label}`} onChange={(e) => form.translate(l.code, ['settings', 'successTitle'], e.currentTarget.value)} />
                <Textarea rows={2} value={ts.successMessage ?? ''} placeholder={s.successMessage || 'We have received your submission.'} aria-label={`Thank-you message, ${l.label}`} onChange={(e) => form.translate(l.code, ['settings', 'successMessage'], e.currentTarget.value)} />
                <details className="group">
                  <summary className="cursor-pointer text-ui-xs text-fg-muted">Validation messages</summary>
                  <div className="mt-2 space-y-1.5">
                    {messageKeys.map((k) => <Input key={k} value={tm[k] ?? ''} placeholder={DEFAULT_FORM_MESSAGES[k]} aria-label={`${k}, ${l.label}`} onChange={(e) => form.translate(l.code, ['messages', k], e.currentTarget.value)} />)}
                  </div>
                </details>
              </LocaleRows>
            )
          })}
        </FormSection>
      )}
      <SaveFooter form={form} />
    </>
  )
}

function ConfirmationsSectionPage({ form }: { form: FormState }) {
  const list = (form.settings.confirmations ?? []) as FormConfirmation[]
  const ro = form.readOnly
  const { enabled: localesOn, locales, codes } = useWorkingLocales()
  const set = (next: FormConfirmation[]) => form.updateSettings({ confirmations: next.length > 0 ? next : undefined })
  const patch = (id: string, p: Partial<FormConfirmation>) => set(list.map((c) => (c.id === id ? { ...c, ...p } : c)))
  return (
    <>
      <FormSection
        title="Confirmations"
        description="What a person sees after sending. The first confirmation whose rules match is shown; the one without rules is the default."
      >
        <div className="space-y-3">
          {list.map((c) => (
            <Card key={c.id} title={<span className="flex items-center gap-2"><Input value={c.name} disabled={ro} aria-label="Confirmation name" className="h-7 w-56" onChange={(e) => patch(c.id, { name: e.currentTarget.value })} />{!c.showIf && <Badge>Default</Badge>}</span>}
              action={<Button size="xs" variant="ghost" aria-label="Remove confirmation" disabled={ro} onClick={() => set(list.filter((x) => x.id !== c.id))}><IconTrash className="size-3.5" /></Button>}>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1">Then</Label>
                    <Select value={c.type} disabled={ro} onValueChange={(v: string) => patch(c.id, { type: v as FormConfirmation['type'] })}>
                      <SelectItem value="message">Show a message</SelectItem>
                      <SelectItem value="redirect">Redirect</SelectItem>
                    </Select>
                  </div>
                  <div>
                    <Label className="mb-1">Title</Label>
                    <Input value={c.title ?? ''} disabled={ro} onChange={(e) => patch(c.id, { title: e.currentTarget.value || undefined })} />
                  </div>
                </div>
                <div>
                  <Label className="mb-1">Message</Label>
                  <Textarea rows={2} value={c.message ?? ''} disabled={ro} placeholder="HTML allowed" onChange={(e) => patch(c.id, { message: e.currentTarget.value || undefined })} />
                </div>
                {c.type === 'redirect' && (
                  <div className="grid grid-cols-[1fr_140px] gap-3">
                    <div><Label className="mb-1">Redirect to</Label><Input value={c.redirectUrl ?? ''} disabled={ro} placeholder="https://example.com/thanks" onChange={(e) => patch(c.id, { redirectUrl: e.currentTarget.value || undefined })} /></div>
                    <div><Label className="mb-1">After (seconds)</Label><Input type="number" min={0} value={c.redirectDelaySeconds ?? ''} disabled={ro} placeholder="0" onChange={(e) => patch(c.id, { redirectDelaySeconds: Number(e.currentTarget.value) || undefined })} /></div>
                  </div>
                )}
                {c.showIf !== undefined && (
                  <div>
                    <Label className="mb-1">Use it when</Label>
                    <ConditionEditor showIf={c.showIf} candidateFields={form.fields} disabled={ro} onChange={(showIf) => patch(c.id, { showIf: showIf ?? ({ logic: 'and', conditions: [] } as never) })} />
                  </div>
                )}
                {localesOn && (
                  <div className="space-y-2 border-t border-border-subtle pt-3">
                    {locales.map((l) => {
                      const t = form.translations[l.code]?.confirmations?.[c.id] ?? {}
                      return (
                        <LocaleRows key={l.code} code={l.code} codes={codes} label={l.label}>
                          <Input value={t.title ?? ''} placeholder={c.title || 'Title'} onChange={(e) => form.translate(l.code, ['confirmations', c.id, 'title'], e.currentTarget.value)} />
                          <Textarea rows={2} value={t.message ?? ''} placeholder={c.message || 'Message'} onChange={(e) => form.translate(l.code, ['confirmations', c.id, 'message'], e.currentTarget.value)} />
                        </LocaleRows>
                      )
                    })}
                  </div>
                )}
              </div>
            </Card>
          ))}
          <Button size="sm" variant="secondary" icon={<IconPlus className="size-3.5" />} disabled={ro}
            onClick={() => set([...list, { id: newId('cnf'), name: `Confirmation ${list.length + 1}`, type: 'message', message: 'Thank you for your submission.', ...(list.some((c) => !c.showIf) ? { showIf: { logic: 'and', conditions: [] } as never } : {}) }])}>
            {list.length === 0 ? 'Add a confirmation' : 'Add another'}
          </Button>
          {list.length === 0 && <p className="text-ui-xs text-fg-subtle">Without one, the thank-you from Texts is shown.</p>}
        </div>
      </FormSection>
      <SaveFooter form={form} />
    </>
  )
}

function NotificationsSectionPage({ form }: { form: FormState }) {
  const list = (form.settings.notifications ?? []) as FormNotification[]
  const ro = form.readOnly
  const set = (next: FormNotification[]) => form.updateSettings({ notifications: next })
  const patch = (i: number, p: Partial<FormNotification>) => set(list.map((n, idx) => (idx === i ? { ...n, ...p } : n)))
  const tags = form.fields.filter((f) => ['email', 'text'].includes(f.type)).map((f) => `{${f.name}}`)
  return (
    <>
      <FormSection title="Notifications" description={`Who is emailed on a submission. A {field} in the recipient sends it to the person who filled the form${tags[0] ? `, e.g. ${tags[0]}` : ''}.`}>
        <div className="space-y-3">
          {list.map((n, i) => (
            <Card key={n.id ?? i} title={<Input value={n.name ?? ''} disabled={ro} aria-label="Notification name" placeholder="Notification" className="h-7 w-56" onChange={(e) => patch(i, { name: e.currentTarget.value || undefined })} />}
              action={<Button size="xs" variant="ghost" aria-label="Remove notification" disabled={ro} onClick={() => set(list.filter((_, idx) => idx !== i))}><IconTrash className="size-3.5" /></Button>}>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="mb-1">To</Label><Input value={n.to} disabled={ro} placeholder="email or {field}" onChange={(e) => patch(i, { to: e.currentTarget.value })} /></div>
                  <div><Label className="mb-1">Reply to</Label><Input value={n.replyTo ?? ''} disabled={ro} placeholder="optional" onChange={(e) => patch(i, { replyTo: e.currentTarget.value || undefined })} /></div>
                </div>
                <div className="grid grid-cols-[1fr_150px] gap-3">
                  <div><Label className="mb-1">Subject</Label><Input value={n.subject ?? ''} disabled={ro} placeholder="{field} tags fill in" onChange={(e) => patch(i, { subject: e.currentTarget.value || undefined })} /></div>
                  <div>
                    <Label className="mb-1">Format</Label>
                    <Select value={n.format ?? 'html'} disabled={ro} onValueChange={(v: string) => patch(i, { format: v === 'html' ? undefined : 'text' })}>
                      <SelectItem value="html">HTML</SelectItem>
                      <SelectItem value="text">Plain text</SelectItem>
                    </Select>
                  </div>
                </div>
                <div><Label className="mb-1">Body</Label><Textarea rows={3} value={n.body ?? ''} disabled={ro} placeholder="Empty: a summary of the submission" onChange={(e) => patch(i, { body: e.currentTarget.value || undefined })} /></div>
                <div>
                  <Label className="mb-1">Send only when</Label>
                  <ConditionEditor showIf={n.showIf} candidateFields={form.fields} disabled={ro} onChange={(showIf) => patch(i, { showIf })} />
                </div>
                <div className="space-y-2">
                  <Label>Route to someone else when</Label>
                  {(n.routing ?? []).map((r, ri) => (
                    <div key={ri} className="space-y-2 rounded-control border border-border bg-surface-sunken p-2.5">
                      <div className="flex items-center gap-2">
                        <Input value={r.to} disabled={ro} placeholder="email or {field}" onChange={(e) => patch(i, { routing: n.routing!.map((x, xi) => (xi === ri ? { ...x, to: e.currentTarget.value } : x)) })} />
                        <Button size="xs" variant="ghost" aria-label="Remove rule" disabled={ro} onClick={() => patch(i, { routing: n.routing!.filter((_, xi) => xi !== ri) })}><IconTrash className="size-3.5" /></Button>
                      </div>
                      <ConditionEditor showIf={r.showIf} candidateFields={form.fields} disabled={ro} onChange={(showIf) => patch(i, { routing: n.routing!.map((x, xi) => (xi === ri ? { ...x, showIf: showIf ?? ({ logic: 'and', conditions: [] } as never) } : x)) })} />
                    </div>
                  ))}
                  <Button size="xs" variant="ghost" icon={<IconPlus className="size-3.5" />} disabled={ro} onClick={() => patch(i, { routing: [...(n.routing ?? []), { showIf: { logic: 'and', conditions: [] } as never, to: '' } as NotificationRoute] })}>Add a routing rule</Button>
                </div>
              </div>
            </Card>
          ))}
          <Button size="sm" variant="secondary" icon={<IconPlus className="size-3.5" />} disabled={ro} onClick={() => set([...list, { name: `Notification ${list.length + 1}`, to: '' }])}>
            {list.length === 0 ? 'Add a notification' : 'Add another'}
          </Button>
          {list.length === 0 && <p className="text-ui-xs text-fg-subtle">Nobody is emailed until you add one.</p>}
        </div>
      </FormSection>
      <SaveFooter form={form} />
    </>
  )
}

function PersonalDataSectionPage({ form }: { form: FormState }) {
  const pd = form.settings.personalData ?? {}
  const ro = form.readOnly
  return (
    <>
      <FormSection title="Personal data" description="What the form keeps about the people who send it.">
        <div className="space-y-4">
          <Toggle label="Store IP addresses" description="Off stores nothing; duplicate protection by IP stops working." checked={pd.storeIp !== false} disabled={ro} onCheckedChange={(v) => form.updateSettings({ personalData: { ...pd, storeIp: v ? undefined : false } })} />
          {pd.storeIp === false && form.settings.uniqueBy === 'ip' && <Callout variant="warning" title="This form dedupes by IP">With IP storage off, its duplicate protection is off too.</Callout>}
          <Toggle label="Remember drafts in the browser" description="Restores half-typed answers on reload; cleared on submit. A shared device keeps them too." checked={form.settings.rememberDraft === true} disabled={ro} onCheckedChange={(v) => form.updateSettings({ rememberDraft: v ? true : undefined })} />
          <FormRow label="Keep submissions for" htmlFor="pd-ret" help="Older ones are deleted daily. Empty keeps them forever.">
            <div className="flex items-center gap-2">
              <Input id="pd-ret" type="number" min={1} className="w-28" value={pd.retentionDays ?? ''} disabled={ro} placeholder="Forever" onChange={(e) => { const d = Number(e.currentTarget.value); form.updateSettings({ personalData: { ...pd, retentionDays: d > 0 ? d : undefined } }) }} />
              <span className="text-ui-sm text-fg-muted">days</span>
            </div>
          </FormRow>
        </div>
      </FormSection>
      <SaveFooter form={form} />
    </>
  )
}

function EmbedSectionPage({ form, formId, workspaceId }: { form: FormState; formId: string; workspaceId: string }) {
  const embed = (form.settings.embed ?? {}) as { allowedDomains?: string[]; requireApiKey?: boolean }
  const ro = form.readOnly
  const [urls, setUrls] = useState<EmbedUrls | null>(null)
  useEffect(() => { formsApi.embed(formId).then(setUrls).catch(() => {}) }, [formId])
  return (
    <>
      <FormSection title="Where it lives" description="Open these directly, or frame them on a page.">
        {urls ? (
          <div className="space-y-2">
            {[['Styled page', urls.styled], ['Unstyled page', urls.appless], ['Schema', urls.schema], ['Submit', urls.submit]].map(([label, url]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-ui-xs text-fg-muted">{label}</span>
                <code className="min-w-0 flex-1 truncate rounded-control border border-border bg-surface-sunken px-2 py-1 font-mono text-ui-xs text-fg-muted">{url}</code>
                <Button size="xs" variant="ghost" aria-label={`Copy ${label}`} onClick={() => navigator.clipboard.writeText(url!).then(() => toast.success('Copied'))}><IconCopy className="size-3.5" /></Button>
              </div>
            ))}
          </div>
        ) : <CodeBlock code="…" copyable={false} />}
      </FormSection>
      <FormSection title="Who may frame it" description="Sites allowed to put this form in an iframe. Opening the link directly always works.">
        <FormRow label="Allowed origins" htmlFor="e-dom" help="One per line, e.g. https://example.com. Empty allows any site.">
          <Textarea id="e-dom" rows={3} className="font-mono" value={(embed.allowedDomains ?? []).join('\n')} disabled={ro}
            onChange={(e) => { const d = e.currentTarget.value.split('\n').map((x) => x.trim()).filter(Boolean); form.updateSettings({ embed: { ...embed, allowedDomains: d.length ? d : undefined } }) }} />
        </FormRow>
        <Toggle label="Require an API key" description="Schema reads and submissions must come through the keyed endpoints with a key that grants Forms." checked={embed.requireApiKey === true} disabled={ro} onCheckedChange={(v) => form.updateSettings({ embed: { ...embed, requireApiKey: v ? true : undefined } })} />
        {embed.requireApiKey && (
          <Callout variant="info" title="Server-side only" actions={<Button size="xs" variant="secondary" onClick={() => window.location.assign(`/${workspaceId}/settings/api-keys`)}>API keys</Button>}>
            A public iframe cannot carry a key. Use the keyed schema and submit endpoints from your own server, with a key scoped to this form.
          </Callout>
        )}
      </FormSection>
      <SaveFooter form={form} />
    </>
  )
}

// ── The page ─────────────────────────────────────────────────────────────────

export function FormSettingsPage() {
  const { workspaceId, formId, section: sectionParam } = useParams<{ workspaceId: string; formId: string; section?: string }>()
  const navigate = useNavigate()
  const { hasCapability } = useCan()
  const form = useForm(formId)
  const base = `/${workspaceId}/extensions/forms`
  const section: SectionId = (SETTINGS_SECTIONS.find((s) => s.id === sectionParam)?.id ?? 'form') as SectionId
  const current = SETTINGS_SECTIONS.find((s) => s.id === section)!
  const canManage = hasCapability('forms:manage' as never)
  const state: FormState = canManage ? form : { ...form, readOnly: true }

  if (form.error) {
    return <AdminPage breadcrumbs={[{ label: 'Forms', href: base }, { label: 'Settings' }]}><ErrorState message={form.error} retry={form.reload} /></AdminPage>
  }
  return (
    <AdminPage
      breadcrumbs={[{ label: 'Forms', href: base, icon: <IconSurvey className="size-4" /> }, { label: form.name || 'Form', href: `${base}/${formId}` }, { label: current.label }]}
      description={form.readOnly ? 'Defined in code, read-only here' : undefined}
      loading={form.loading}
      width="form"
      access={{ capability: 'forms:read' }}
      actions={<Button size="xs" variant="secondary" onClick={() => navigate(`${base}/${formId}`)}>Back to builder</Button>}
    >
      <div className="space-y-8">
        {section === 'form' && <FormSectionPage form={state} />}
        {section === 'texts' && <TextsSectionPage form={state} />}
        {section === 'confirmations' && <ConfirmationsSectionPage form={state} />}
        {section === 'notifications' && <NotificationsSectionPage form={state} />}
        {section === 'destinations' && formId && workspaceId && (
          <DestinationsSectionPage formId={formId} workspaceId={workspaceId} formName={form.name || 'this form'} fields={form.fields} />
        )}
        {section === 'personal-data' && <PersonalDataSectionPage form={state} />}
        {section === 'embed' && formId && workspaceId && <EmbedSectionPage form={state} formId={formId} workspaceId={workspaceId} />}
      </div>
    </AdminPage>
  )
}
