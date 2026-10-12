import { useState } from 'react'
import { useParams } from 'react-router-dom'
import type { FieldDefinition } from '@tangen/types'
import {
  AdminPage, FormSection, FormRow, FormFooter, AutoForm,
  Input, Select, SelectItem, DatePicker, Button, ActionPill, Toggle, Text, toast, FieldControl,
} from '@/kit'
import { Example, ExampleStack, useSinkCrumbs } from './example'

// A tiny field set (same shape as content-object fields) to drive AutoForm.
const AUTOFORM_FIELDS: FieldDefinition[] = [
  { name: 'fullName', label: 'Full name', fieldType: 'text', required: true, helpText: 'Required', config: {}, previousName: [] } as FieldDefinition,
  { name: 'role', label: 'Role', fieldType: 'select', required: true, config: { options: [{ label: 'Editor', value: 'editor' }, { label: 'Admin', value: 'admin' }] }, previousName: [] } as FieldDefinition,
  { name: 'bio', label: 'Bio', fieldType: 'textarea', required: false, config: {}, previousName: [] } as FieldDefinition,
]

/** Forms — the form shells, inputs, and validation states. */
export function SinkFormsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [date, setDate] = useState<string | undefined>(undefined)
  const [notify, setNotify] = useState(true)
  const [protect, setProtect] = useState(true)
  const [cta, setCta] = useState<unknown>({ type: 'external', url: 'https://tangen.app/pricing', label: 'See pricing' })
  const [autoCancel, setAutoCancel] = useState(false)
  const [autoValues, setAutoValues] = useState<Record<string, unknown>>({})

  return (
    <AdminPage breadcrumbs={useSinkCrumbs('Forms')}>
      <ExampleStack>

        <Example
          title="AutoForm - a validated form from field defs"
          description="One component renders every field type and validates on submit (required + format). Point it at an array of field definitions - the same shape content objects use."
          code={`import { AutoForm } from '@/kit'

const fields = [
  { name: 'fullName', label: 'Full name', fieldType: 'text', required: true, config: {}, previousName: [] },
  { name: 'role', label: 'Role', fieldType: 'select', required: true,
    config: { options: [{ label: 'Editor', value: 'editor' }] }, previousName: [] },
]

<AutoForm
  fields={fields}
  value={values}
  onChange={setValues}
  onSubmit={(v) => save(v)}   // called only when validation passes workspaceId={workspaceId}
  title="New member"
/>`}
        >
          <AutoForm
            fields={AUTOFORM_FIELDS}
            value={autoValues}
            onChange={setAutoValues}
            onSubmit={(v) => toast.success('Submitted', JSON.stringify(v))}
            workspaceId={workspaceId!}
            title="New member"
            submitLabel="Create member"
          />
        </Example>


        <Example
          title="FormSection + FormRow + FormFooter"
          description="The complete form pattern - labels, required marks, help text, and the action row"
          code={`import { FormSection, FormRow, FormFooter, Input, Button } from '@/kit'

<FormSection title="Details" description="Shown on the public profile">
  <FormRow label="Name" htmlFor="name" required help="Displayed in the directory">
    <Input id="name" placeholder="Ada Lovelace" />
  </FormRow>
  <FormRow label="Email" htmlFor="email" error="Enter a valid email">
    <Input id="email" hasError placeholder="ada@" />
  </FormRow>
  <FormFooter>
    <Button variant="secondary">Cancel</Button>
    <Button onClick={save}>Save</Button>
  </FormFooter>
</FormSection>`}
        >
          <FormSection title="Details" description="Shown on the public profile">
            <FormRow label="Name" htmlFor="sink-f-name" required help="Displayed in the directory">
              <Input id="sink-f-name" placeholder="Ada Lovelace" />
            </FormRow>
            <FormRow label="Email" htmlFor="sink-f-email" error="Enter a valid email">
              <Input id="sink-f-email" hasError placeholder="ada@" />
            </FormRow>
            <FormFooter>
              <Button size="sm" variant="secondary">Cancel</Button>
              <Button size="sm" onClick={() => toast.success('Saved', 'Your changes are live')}>Save</Button>
            </FormFooter>
          </FormSection>
        </Example>

        <Example
          title="Inputs"
          description="Text, select, and date - DatePicker's default height matches the other fields"
          code={`<Input placeholder="Text input" />
<Select placeholder="Select…"><SelectItem value="a">Option A</SelectItem></Select>
<DatePicker value={date} onChange={setDate} placeholder="Publish date" />
<DatePicker withTime … />   // adds a time row`}
        >
          <div className="grid grid-cols-3 gap-3 max-w-xl">
            <Input placeholder="Text input" />
            <Select placeholder="Select…">
              <SelectItem value="a">Option A</SelectItem>
              <SelectItem value="b">Option B</SelectItem>
            </Select>
            <DatePicker value={date} onChange={setDate} placeholder="Publish date" />
          </div>
        </Example>

        <Example
          title="Checkbox pills"
          description="ActionPill - the admin's checkbox chip (permission grants, toggles in rows)"
          code={`<ActionPill action="notify" checked={notify} onChange={() => setNotify(!notify)} />
<ActionPill action="archive (disabled)" checked disabled onChange={() => {}} />`}
        >
          <div className="flex gap-2">
            <ActionPill action="notify" checked={notify} onChange={() => setNotify(!notify)} />
            <ActionPill action="digest" checked={!notify} onChange={() => setNotify(!notify)} />
            <ActionPill action="archive (disabled)" checked disabled onChange={() => {}} />
          </div>
        </Example>

        <Example
          title="Toggle"
          description="A Switch with its words: a Title Case label and one sentence on what ON does. A toggle takes effect immediately; a setting that waits for Save is a Checkbox."
          code={`import { Toggle } from '@/kit'

<Toggle label="Password protection" description="Visitors need the password to see the site." checked={on} onCheckedChange={setOn} />
<Toggle label="Auto-cancel builds" direction="switch-first" size="sm" checked={auto} onCheckedChange={setAuto} />
<Toggle label="Locked by the plan" disabled checked onCheckedChange={() => {}} />`}
        >
          <div className="max-w-md divide-y divide-border-subtle rounded-lg border border-border-subtle bg-card">
            <Toggle className="px-4 py-3" label="Password protection" description="Visitors need the password to see the site." checked={protect} onCheckedChange={setProtect} />
            <Toggle className="px-4 py-3" label="Auto-cancel builds" description="A new push cancels the build still running." direction="switch-first" size="sm" checked={autoCancel} onCheckedChange={setAutoCancel} />
            <Toggle className="px-4 py-3" label="Locked by the plan" description="Available on the Team plan." disabled checked onCheckedChange={() => {}} />
          </div>
        </Example>

        <Example
          title="Link with its text"
          description="A link field with config.withLabel: one row in the editor - the label and where it goes; the label, picker or URL, postfix and new-tab switch behind the dialog"
          code={`cta: field.link({
  label: 'Call to action',
  config: { withLabel: true, allowedTargets: ['page'] },
}),

// In the editor: FieldControl draws it like any other field.
<FieldControl field={ctaField} value={cta} onChange={setCta} workspaceId={workspaceId} />`}
        >
          <div className="max-w-md">
            <FieldControl
              field={{ name: 'cta', label: 'Call to action', fieldType: 'link', config: { withLabel: true } } as never}
              value={cta}
              onChange={setCta}
              workspaceId={workspaceId!}
            />
          </div>
        </Example>

        <Example
          title="Content-aware fields"
          description="FieldControl renders ANY schema field type - the editor's own renderer, available to your screens"
          code={`import { FieldControl, RelationPicker, MediaPicker } from '@/kit'

// Render a field exactly as the object editor would (validation, i18n, AI):
<FieldControl field={fieldDef} value={value} onChange={setValue} />

// Or use the pickers directly:
<RelationPicker typeName="author" value={id} onChange={setId} />`}
        >
          <Text>
            These need live schema/content data - open any content object to see them, or copy
            the snippet into a page wired to your types.
          </Text>
        </Example>

      </ExampleStack>
    </AdminPage>
  )
}
