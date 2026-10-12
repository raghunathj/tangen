/**
 * File Name: field-types.ts
 * Purpose: The palette of a form's field types: label, icon, group, and how
 *          a fresh field of each type starts.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ComponentType } from 'react'
import {
  IconText, IconAlignLeft, IconMail, IconPhone, IconHash, IconCalendar,
  IconSelect, IconListChecks, IconRadioButton, IconCheckbox, IconAttachment, IconEyeOff,
  IconCode, IconImage, IconCheckCircle,
} from '@tangen/icons'
import type { FormField, FormFieldType } from '../contract'

export interface FieldTypeConfig {
  type: FormFieldType
  label: string
  icon: ComponentType<{ className?: string }>
  group: 'Basic' | 'Choice' | 'Advanced' | 'Layout'
}

export const FIELD_TYPE_CONFIGS: FieldTypeConfig[] = [
  { type: 'text', label: 'Short text', icon: IconText, group: 'Basic' },
  { type: 'textarea', label: 'Paragraph', icon: IconAlignLeft, group: 'Basic' },
  { type: 'email', label: 'Email', icon: IconMail, group: 'Basic' },
  { type: 'phone', label: 'Phone', icon: IconPhone, group: 'Basic' },
  { type: 'number', label: 'Number', icon: IconHash, group: 'Basic' },
  { type: 'date', label: 'Date', icon: IconCalendar, group: 'Basic' },
  { type: 'select', label: 'Dropdown', icon: IconSelect, group: 'Choice' },
  { type: 'multiselect', label: 'Multi select', icon: IconListChecks, group: 'Choice' },
  { type: 'radio', label: 'Radio group', icon: IconRadioButton, group: 'Choice' },
  { type: 'checkbox', label: 'Checkbox', icon: IconCheckbox, group: 'Choice' },
  { type: 'file', label: 'File upload', icon: IconAttachment, group: 'Advanced' },
  { type: 'hidden', label: 'Hidden', icon: IconEyeOff, group: 'Advanced' },
  { type: 'html', label: 'HTML block', icon: IconCode, group: 'Layout' },
  { type: 'image', label: 'Image', icon: IconImage, group: 'Layout' },
  { type: 'submit', label: 'Submit button', icon: IconCheckCircle, group: 'Layout' },
]

export const FIELD_GROUPS = ['Basic', 'Choice', 'Advanced', 'Layout'] as const

export function fieldTypeConfig(type: FormFieldType): FieldTypeConfig | undefined {
  return FIELD_TYPE_CONFIGS.find((c) => c.type === type)
}

export const hasOptions = (type: FormFieldType) => ['select', 'multiselect', 'radio'].includes(type)

export function makeField(type: FormFieldType, existing: FormField[]): FormField {
  const config = fieldTypeConfig(type)
  const label = config?.label ?? type
  const base = type.replace(/[^a-z0-9]/g, '_')
  let name = base
  let n = 2
  while (existing.some((f) => f.name === name)) name = `${base}_${n++}`
  return {
    id: crypto.randomUUID(),
    type,
    name,
    label,
    required: false,
    width: 'full',
    options: hasOptions(type) ? [{ label: 'Option 1', value: 'option_1' }] : undefined,
  }
}
