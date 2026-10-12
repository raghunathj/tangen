/**
 * File Name: steps.tsx
 * Purpose: Multi-step forms in the builder: a row of step chips above the
 *          field list (All, then one per step with its field count), and a
 *          popover to edit a step - title, description, the Next button's
 *          text, the rules that show it, its translations, and removal.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useState } from 'react'
import { IconPlus, IconSettings, IconTrash } from '@tangen/icons'
import { Button, Input, Label, Popover, PopoverContent, PopoverTrigger, cx } from '@/kit'
import type { FormField, FormStep } from '../../contract'
import { ConditionEditor } from '../conditions'
import { localeTone, useWorkingLocales } from '../locales'
import type { Translations } from '../use-form'

const makeStep = (n: number): FormStep => ({ id: `stp_${Math.random().toString(36).slice(2, 8)}`, title: `Step ${n}` })

export function StepsBar({ steps, fields, activeStepId, readOnly, translations, onStepsChange, onFieldsChange, onSelectStep, onTranslate }: {
  steps: FormStep[]
  fields: FormField[]
  activeStepId: string | null
  readOnly: boolean
  translations: Translations
  onStepsChange: (steps: FormStep[]) => void
  onFieldsChange: (fields: FormField[]) => void
  onSelectStep: (id: string | null) => void
  onTranslate: (locale: string, path: string[], value: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const { enabled: localesOn, locales, codes } = useWorkingLocales()

  function addStep() {
    if (steps.length === 0) {
      const first = makeStep(1)
      onFieldsChange(fields.map((f) => ({ ...f, stepId: f.stepId ?? first.id })))
      onStepsChange([first, makeStep(2)])
      onSelectStep(first.id)
      return
    }
    const step = makeStep(steps.length + 1)
    onStepsChange([...steps, step])
    onSelectStep(step.id)
  }
  function removeStep(id: string) {
    const remaining = steps.filter((s) => s.id !== id)
    setEditing(null)
    if (remaining.length <= 1) {
      onStepsChange([])
      onFieldsChange(fields.map(({ stepId: _s, ...f }) => f as FormField))
      onSelectStep(null)
      return
    }
    const fallback = remaining[0]!.id
    onStepsChange(remaining)
    onFieldsChange(fields.map((f) => (f.stepId === id ? { ...f, stepId: fallback } : f)))
    if (activeStepId === id) onSelectStep(fallback)
  }
  const patchStep = (id: string, p: Partial<FormStep>) => onStepsChange(steps.map((s) => (s.id === id ? { ...s, ...p } : s)))
  const countFor = (step: FormStep) => fields.filter((f) => (f.stepId ?? steps[0]?.id) === step.id).length

  const chip = (active: boolean) => cx(
    'inline-flex h-7 items-center gap-1.5 rounded-control border pl-2.5 pr-1 text-ui-xs font-medium transition-colors motion-fast',
    active ? 'border-accent/40 bg-accent-muted text-accent-fg' : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg',
  )

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="steps-bar">
      {steps.length > 0 && (
        <Button size="xs" variant={activeStepId === null ? 'secondary' : 'ghost'} aria-pressed={activeStepId === null} onClick={() => onSelectStep(null)}>All</Button>
      )}
      {steps.map((step, i) => (
        <Popover key={step.id} open={editing === step.id} onOpenChange={(o) => setEditing(o ? step.id : null)}>
          <span className={chip(activeStepId === step.id)}>
            <Button size="xs" variant="ghost" className="h-6 gap-1.5 px-1 font-medium text-current hover:bg-transparent" aria-pressed={activeStepId === step.id} onClick={() => onSelectStep(step.id)}>
              <span className="text-fg-subtle">{i + 1}</span>
              {step.title || `Step ${i + 1}`}
              <span className="text-fg-subtle">{countFor(step)}</span>
              {step.showIf && <span className="size-1.5 rounded-full bg-warning" title="Shown on a rule" />}
            </Button>
            <PopoverTrigger asChild>
              <Button size="xs" variant="ghost" className="size-5 p-0" aria-label={`Edit ${step.title || `step ${i + 1}`}`}>
                <IconSettings className="size-3" />
              </Button>
            </PopoverTrigger>
          </span>
          <PopoverContent align="start" className="w-80 space-y-3 p-3">
            <div>
              <Label className="mb-1">Title</Label>
              <Input value={step.title ?? ''} disabled={readOnly} onChange={(e) => patchStep(step.id, { title: e.currentTarget.value })} />
            </div>
            <div>
              <Label className="mb-1">Description</Label>
              <Input value={step.description ?? ''} disabled={readOnly} onChange={(e) => patchStep(step.id, { description: e.currentTarget.value || undefined })} />
            </div>
            <div>
              <Label className="mb-1">Next button</Label>
              <Input value={step.nextButtonText ?? ''} disabled={readOnly} placeholder="Next" onChange={(e) => patchStep(step.id, { nextButtonText: e.currentTarget.value || undefined })} />
            </div>
            <div>
              <Label className="mb-1">Show this step only when</Label>
              <ConditionEditor showIf={step.showIf} candidateFields={fields.filter((f) => f.stepId !== step.id)} disabled={readOnly} onChange={(showIf) => patchStep(step.id, { showIf })} />
            </div>
            {localesOn && (
              <div className="space-y-2 border-t border-border-subtle pt-3">
                <Label>Translations</Label>
                {locales.map((l) => {
                  const tone = localeTone(l.code, codes)
                  const t = translations[l.code]?.steps?.[step.id] ?? {}
                  return (
                    <div key={l.code} className={cx('space-y-1.5 border-l-2 pl-2.5', tone.rail)}>
                      <p className="text-ui-2xs font-semibold uppercase tracking-wider text-fg-subtle">{l.label}</p>
                      <Input value={t.title ?? ''} placeholder={step.title || 'Title'} onChange={(e) => onTranslate(l.code, ['steps', step.id, 'title'], e.currentTarget.value)} />
                      <Input value={t.description ?? ''} placeholder={step.description || 'Description'} onChange={(e) => onTranslate(l.code, ['steps', step.id, 'description'], e.currentTarget.value)} />
                      <Input value={t.nextButtonText ?? ''} placeholder={step.nextButtonText || 'Next'} onChange={(e) => onTranslate(l.code, ['steps', step.id, 'nextButtonText'], e.currentTarget.value)} />
                    </div>
                  )
                })}
              </div>
            )}
            <div className="flex justify-end border-t border-border-subtle pt-3">
              <Button size="xs" variant="ghost" icon={<IconTrash className="size-3.5" />} disabled={readOnly} onClick={() => removeStep(step.id)}>Remove step</Button>
            </div>
          </PopoverContent>
        </Popover>
      ))}
      {!readOnly && (
        <Button size="xs" variant="ghost" icon={<IconPlus className="size-3.5" />} onClick={addStep} title={steps.length === 0 ? 'Split the form into steps' : 'Add a step'}>
          {steps.length === 0 ? 'Steps' : 'Step'}
        </Button>
      )}
    </div>
  )
}
