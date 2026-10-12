/**
 * File Name: schema-display.ts
 * Purpose: Display helpers for schema field types — human-readable labels and
 *   configuration summaries used in the schema editor and field list UI.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types (FieldType, FieldConfig)
 */

import type { FieldType, FieldTypeRef, FieldConfig } from '@tangen/types'

/**
 * Returns a human-readable label for a FieldType identifier.
 * @param fieldType - The internal field type key (e.g. "richtext", "multiselect")
 * @returns Display label string (e.g. "Rich Text", "Multi-select")
 */
export function fieldTypeLabel(fieldType: FieldTypeRef): string {
  const labels: Record<FieldType, string> = {
    text:        'Text',
    email:       'Email',
    url:         'URL',
    phone:       'Phone',
    textarea:    'Textarea',
    richtext:    'Rich Text',
    number:      'Number',
    boolean:     'Boolean',
    date:        'Date',
    select:      'Select',
    multiselect: 'Multi-select',
    relation:    'Relation',
    object:      'Object',
    media:       'Media',
    repeater:    'Repeater',
    component:   'Component',
    json:        'JSON',
  }
  return labels[fieldType as FieldType] ?? fieldType
}

/**
 * Produces a compact config summary string for display next to a field's type label.
 * @param fieldType - The type of the field being summarised
 * @param config - The field's FieldConfig object containing options, validation, etc.
 * @returns A short description such as "→ Post (many)", "3 options", "max 255", or null if nothing notable
 */
export function fieldConfigSummary(fieldType: FieldTypeRef, config: FieldConfig): string | null {
  if (fieldType === 'relation') {
    if (!config.targetType) return null
    return config.many ? `→ ${config.targetType} (many)` : `→ ${config.targetType}`
  }
  if (fieldType === 'select' || fieldType === 'multiselect') {
    const count = config.options?.length ?? 0
    return count === 1 ? '1 option' : `${count} options`
  }
  if (fieldType === 'text' || fieldType === 'textarea' || fieldType === 'email' || fieldType === 'url' || fieldType === 'phone') {
    if (config.validation?.maxLength != null) return `max ${config.validation.maxLength}`
    return null
  }
  if (fieldType === 'number') {
    const vr = config.validation
    if (vr?.min != null && vr?.max != null) return `${vr.min}–${vr.max}`
    if (vr?.min != null) return `min ${vr.min}`
    if (vr?.max != null) return `max ${vr.max}`
    return null
  }
  if (fieldType === 'date') {
    return config.includeTime ? 'with time' : null
  }
  return null
}

/**
 * Read-only list of built-in system fields present on every content object.
 */
export const SYSTEM_FIELDS: { name: string; label: string; fieldType: FieldType }[] = [
  { name: 'title',       label: 'Title',        fieldType: 'text'    },
  { name: 'slug',        label: 'Slug',         fieldType: 'text'    },
  { name: 'status',      label: 'Status',       fieldType: 'select'  },
  { name: 'createdAt',   label: 'Created at',   fieldType: 'date'    },
  { name: 'updatedAt',   label: 'Updated at',   fieldType: 'date'    },
  { name: 'publishedAt', label: 'Published at', fieldType: 'date'    },
  { name: 'scheduledAt', label: 'Scheduled at', fieldType: 'date'    },
]
