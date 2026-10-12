/**
 * File Name: builder.tsx
 * Purpose: The form builder: fields on the left, the selected field on the
 *          right (or the live preview), the form's state and actions in the
 *          page header. Saving is one action; publishing is another; settings
 *          are their own pages behind the Settings action.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IconCode, IconEye, IconEyeOff, IconMoreHorizontal, IconSettings, IconSparkles, IconSurvey } from '@tangen/icons'
import { AdminPage, Badge, Button, Callout, EmptyState, ErrorState, Input, Label, Menu, MenuContent, MenuItem, MenuTrigger, useCan, useCapabilities, useConfirm, cx } from '@/kit'
import type { FormField, FormFieldType } from '../../contract'
import { makeField } from '../field-types'
import { useForm } from '../use-form'
import { FieldList } from '../builder/field-list'
import { FieldPalette } from '../builder/field-palette'
import { FieldInspector } from '../builder/field-inspector'
import { StepsBar } from '../builder/steps'
import { FormPreview } from '../builder/preview'
import { EmbedSheet } from '../builder/embed-sheet'
import { GenerateDialog } from '../builder/generate-dialog'

export function FormBuilderPage() {
  const { workspaceId, formId } = useParams<{ workspaceId: string; formId: string }>()
  const navigate = useNavigate()
  const { hasCapability } = useCan()
  const canManage = hasCapability('forms:manage' as never)
  const capabilities = useCapabilities(workspaceId)
  const canAI = capabilities.isOn('ai') && hasCapability('use:ai' as never)
  const form = useForm(formId)
  const readOnly = form.readOnly || !canManage
  const { confirm, confirmDialog } = useConfirm()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeStepId, setActiveStepId] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [embedOpen, setEmbedOpen] = useState(false)
  const [genOpen, setGenOpen] = useState(false)

  const base = `/${workspaceId}/extensions/forms`
  const steps = form.settings.steps ?? []
  const visibleFields = useMemo(
    () => (activeStepId && steps.length > 0 ? form.fields.filter((f) => (f.stepId ?? steps[0]!.id) === activeStepId) : form.fields),
    [form.fields, activeStepId, steps],
  )
  const selected = form.fields.find((f) => f.id === selectedId) ?? null

  function addField(type: FormFieldType) {
    const f = makeField(type, form.fields)
    if (steps.length > 0) f.stepId = activeStepId ?? steps[0]!.id
    form.setFields([...form.fields, f])
    setSelectedId(f.id)
    setPreview(false)
  }
  async function removeField(id: string) {
    const f = form.fields.find((x) => x.id === id)
    if (!f) return
    if (!(await confirm({ title: `Remove ${f.label || 'this field'}?`, message: 'Existing submissions keep their values; the form stops asking for it.', confirmLabel: 'Remove', variant: 'destructive' }))) return
    form.setFields(form.fields.filter((x) => x.id !== id))
    if (selectedId === id) setSelectedId(null)
  }
  async function unpublish() {
    if (!(await confirm({ title: 'Unpublish this form?', message: 'It stops accepting submissions until you publish it again. The embed shows a closed notice.', confirmLabel: 'Unpublish' }))) return
    await form.setLive(false)
  }

  // Secondary actions (preview, AI, share, settings) fold into one menu on
  // narrow screens so the header never overflows; save and publish stay put.
  const secondary = (
    <>
      <Button size="xs" variant="ghost" aria-pressed={preview} icon={preview ? <IconEyeOff className="size-3.5" /> : <IconEye className="size-3.5" />} onClick={() => setPreview((v) => !v)}>
        Preview
      </Button>
      {canAI && !readOnly && (
        <Button size="xs" variant="secondary" icon={<IconSparkles className="size-3.5" />} onClick={() => setGenOpen(true)}>AI</Button>
      )}
      <Button size="xs" variant="secondary" icon={<IconCode className="size-3.5" />} onClick={() => setEmbedOpen(true)}>Share</Button>
      <Button size="xs" variant="secondary" icon={<IconSettings className="size-3.5" />} onClick={() => navigate(`${base}/${formId}/settings`)}>Settings</Button>
    </>
  )
  const actions = (
    <div className="flex items-center gap-2">
      <Badge variant={form.isLive ? 'success' : 'neutral'}>{form.isLive ? 'Live' : 'Draft'}</Badge>
      <div className="hidden items-center gap-2 md:flex">{secondary}</div>
      <div className="md:hidden">
        <Menu>
          <MenuTrigger asChild>
            <Button size="xs" variant="secondary" aria-label="More actions"><IconMoreHorizontal className="size-3.5" /></Button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onSelect={() => setPreview((v) => !v)}>{preview ? 'Hide preview' : 'Preview'}</MenuItem>
            {canAI && !readOnly && <MenuItem onSelect={() => setGenOpen(true)}>Describe with AI</MenuItem>}
            <MenuItem onSelect={() => setEmbedOpen(true)}>Share</MenuItem>
            <MenuItem onSelect={() => navigate(`${base}/${formId}/settings`)}>Settings</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {!readOnly && (
        <>
          <Button size="xs" variant="secondary" disabled={!form.dirty || form.saving} isLoading={form.saving && form.dirty} onClick={() => form.save()}>Save</Button>
          {form.isLive
            ? <Button size="xs" variant="secondary" disabled={form.saving} onClick={unpublish}>Unpublish</Button>
            : <Button size="xs" disabled={form.saving} onClick={() => form.save({ publish: true })}>Publish</Button>}
        </>
      )}
    </div>
  )

  if (form.error) {
    return (
      <AdminPage breadcrumbs={[{ label: 'Forms', href: base, icon: <IconSurvey className="size-4" /> }, { label: 'Form' }]}>
        <ErrorState message={form.error} retry={form.reload} />
      </AdminPage>
    )
  }

  return (
    <AdminPage
      breadcrumbs={[{ label: 'Forms', href: base, icon: <IconSurvey className="size-4" /> }, { label: form.name || 'Untitled form' }]}
      actions={actions}
      loading={form.loading}
      flush
      access={{ capability: 'forms:read' }}
    >
      <div className="flex h-full min-h-0 flex-col" data-testid="form-builder">
        {form.readOnly && (
          <div className="border-b border-border-subtle px-6 py-3">
            <Callout variant="info" title="Defined in code">
              This form comes from app/forms and is read-only here. Edit the file and run tangen push. Preview and Share still work.
            </Callout>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {/* Fields */}
          <div className="flex w-[360px] shrink-0 flex-col border-r border-border-subtle bg-surface-sunken">
            <div className="space-y-3 border-b border-border-subtle px-4 pb-3 pt-4">
              <div>
                <Label htmlFor="form-name" className="mb-1">Form name</Label>
                <Input id="form-name" value={form.name} disabled={readOnly} onChange={(e) => form.setName(e.currentTarget.value)} />
              </div>
              <StepsBar
                steps={steps} fields={form.fields} activeStepId={activeStepId} readOnly={readOnly} translations={form.translations}
                onStepsChange={(s) => form.updateSettings({ steps: s.length > 0 ? s : undefined })}
                onFieldsChange={form.setFields} onSelectStep={setActiveStepId} onTranslate={form.translate}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <FieldList
                fields={visibleFields} allFields={form.fields} selectedId={selectedId} readOnly={readOnly}
                onSelect={(id) => { setSelectedId(id); setPreview(false) }} onRemove={removeField} onReorder={form.setFields}
                empty={!readOnly ? <FieldPalette onAdd={addField} /> : undefined}
              />
            </div>
            {!readOnly && visibleFields.length > 0 && (
              <div className="border-t border-border-subtle p-3">
                <FieldPalette onAdd={addField} />
              </div>
            )}
          </div>
          {/* Inspector or preview */}
          <div className={cx('min-w-0 flex-1', preview ? 'overflow-y-auto bg-surface-sunken p-8' : 'flex flex-col bg-surface')}>
            {preview ? (
              <FormPreview fields={form.fields} formName={form.name} steps={steps} settings={form.settings} initialStepId={activeStepId} />
            ) : selected ? (
              <FieldInspector
                key={selected.id}
                field={selected} allFields={form.fields} steps={steps} readOnly={readOnly}
                translations={form.translations} onChange={form.updateField} onTranslate={form.translate}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-8">
                <EmptyState icon={<IconSurvey className="size-6" />} title={form.fields.length === 0 ? 'Start with a field' : 'Select a field'} description={form.fields.length === 0 ? 'Add a field on the left and it opens here.' : 'Its settings, validation, rules and translations open here.'} />
              </div>
            )}
          </div>
        </div>
      </div>
      {formId && <EmbedSheet open={embedOpen} onOpenChange={setEmbedOpen} formId={formId} formName={form.name} />}
      <GenerateDialog open={genOpen} onOpenChange={setGenOpen} current={{ name: form.name, fields: form.fields, steps, settings: form.settings }} onApply={(def) => { form.replaceDefinition(def as never); setSelectedId(null) }} />
      {confirmDialog}
    </AdminPage>
  )
}

export type { FormField }
