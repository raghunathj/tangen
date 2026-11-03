/**
 * File Name: global-field-row.tsx
 * Purpose: One field in the globals edit sheet: its label, its control, and the
 *          sentence that says what to type. Lifted out of the sheet so the row
 *          is assertable on its own - the sheet fetches and holds locale state,
 *          so a static render of it only ever proves the skeleton.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `subFieldAdmin` resolves the admin options, which is how
 *          a repeater's rows already resolve theirs. A `GlobalField` is
 *          `FieldDefinition`-shaped and authors its options at `config.admin`;
 *          reading both homes means a root `admin` is accepted rather than
 *          silently dropped, and costs one function call.
 */
import { FieldControl } from '@/components/fields/field-control'
import { fieldColSpanSm, subFieldAdmin } from '@/lib/field-presentation'
import type { GlobalField, FieldDefinition } from '@tangen/types'

const toFieldDef = (f: GlobalField): FieldDefinition => ({
  ...f, previousName: f.previousName ?? [], required: f.required ?? false,
})

export function GlobalFieldRow({ field, value, onChange, workspaceId }: {
  field: GlobalField
  value: unknown
  onChange: (v: unknown) => void
  workspaceId: string
}) {
  // A global has no per-field description and no column header, so this
  // sentence is the only instruction it can carry. The sheet used to render
  // the label and the control and stop, which made every `helpText` authored
  // on a global dead text in a config file.
  const { helpText, width } = subFieldAdmin(field)
  return (
    <div className={fieldColSpanSm(width)}>
      <label className="block text-sm font-medium text-fg mb-1.5">
        {field.label}
        {field.required && <span className="text-danger-fg ml-0.5">*</span>}
      </label>
      <FieldControl
        field={toFieldDef(field)}
        value={value}
        onChange={onChange}
        workspaceId={workspaceId}
      />
      {helpText && <p className="mt-1 text-[11px] text-fg-subtle">{helpText}</p>}
    </div>
  )
}
