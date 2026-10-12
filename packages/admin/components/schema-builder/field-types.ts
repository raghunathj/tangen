/**
 * File Name: field-types.ts
 * Purpose: The catalogue of field types offered by the schema builder — one entry
 *   per type with a friendly label, a one-line description and an icon, grouped
 *   into sections. Shared by the canvas (icon lookup) and the Add Field modal.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ComponentType } from 'react'
import {
  IconText, IconAlignLeft, IconHash, IconCheckbox, IconCalendar, IconSelect,
  IconImage, IconLink, IconStack, IconListOrdered, IconDropdownList } from '@tangen/icons'

type Ico = ComponentType<{ className?: string }>

export type FieldTypeGroup = 'Text' | 'Data' | 'Media & Relations' | 'Layout'

export interface FieldTypeMeta {
  type: string
  label: string
  description: string
  group: FieldTypeGroup
  Icon: Ico
}

/** Every field type the builder can add, grouped for the Add Field modal. */
export const FIELD_TYPES: FieldTypeMeta[] = [
  { type: 'text', label: 'Text', description: 'A single line of text', group: 'Text', Icon: IconText },
  { type: 'slug', label: 'Slug', description: 'URL-safe unique identifier, generated from another field', group: 'Text', Icon: IconText },
  { type: 'textarea', label: 'Text Area', description: 'Multiple lines of plain text', group: 'Text', Icon: IconAlignLeft },
  { type: 'email', label: 'Email', description: 'An email address with format validation', group: 'Text', Icon: IconText },
  { type: 'url', label: 'URL', description: 'A web address with format validation', group: 'Text', Icon: IconText },
  { type: 'phone', label: 'Phone', description: 'A phone number', group: 'Text', Icon: IconText },
  { type: 'code', label: 'Code', description: 'A code snippet with monospace editing', group: 'Text', Icon: IconAlignLeft },
  { type: 'richtext', label: 'Rich Text', description: 'Formatted content with a WYSIWYG editor', group: 'Text', Icon: IconAlignLeft },
  { type: 'number', label: 'Number', description: 'An integer or decimal value', group: 'Data', Icon: IconHash },
  { type: 'range', label: 'Range', description: 'Two numbers (min–max) stored in one range column', group: 'Data', Icon: IconHash },
  { type: 'boolean', label: 'Boolean', description: 'A true / false toggle', group: 'Data', Icon: IconCheckbox },
  { type: 'date', label: 'Date', description: 'A date or date-time value', group: 'Data', Icon: IconCalendar },
  { type: 'time', label: 'Time', description: 'A time of day (HH:MM) without a date', group: 'Data', Icon: IconCalendar },
  { type: 'select', label: 'Select', description: 'A choice from predefined options', group: 'Data', Icon: IconDropdownList },
  { type: 'multiselect', label: 'Multi-select', description: 'Several choices from predefined options', group: 'Data', Icon: IconDropdownList },
  { type: 'tags', label: 'Tags', description: 'Free-form tags, entered as chips', group: 'Data', Icon: IconSelect },
  { type: 'color', label: 'Color', description: 'A color value with a visual picker', group: 'Data', Icon: IconSelect },
  { type: 'rating', label: 'Rating', description: 'A star rating (configurable scale)', group: 'Data', Icon: IconHash },
  { type: 'currency', label: 'Currency', description: 'A money amount with a currency code', group: 'Data', Icon: IconHash },
  { type: 'geopoint', label: 'Geopoint', description: 'A latitude/longitude coordinate', group: 'Data', Icon: IconHash },
  { type: 'json', label: 'JSON', description: 'Raw JSON data with a structured editor', group: 'Data', Icon: IconAlignLeft },
  { type: 'media', label: 'Media', description: 'An image or file from the media library', group: 'Media & Relations', Icon: IconImage },
  { type: 'object', label: 'Reference (any type)', description: 'Points at an entry from one of SEVERAL types - leave the list empty to allow all', group: 'Media & Relations', Icon: IconSelect },
  { type: 'relation', label: 'Relation', description: 'A link to another content type', group: 'Media & Relations', Icon: IconLink },
  { type: 'link', label: 'Link', description: 'A destination: content in this workspace, or an external URL', group: 'Media & Relations', Icon: IconLink },
  { type: 'repeater', label: 'Repeater', description: 'A repeatable group of fields', group: 'Layout', Icon: IconListOrdered },
  { type: 'group', label: 'Group', description: 'Visually groups fields under an accordion - columns stay flat', group: 'Layout', Icon: IconSelect },
  { type: 'component', label: 'Component', description: 'A reusable block of fields', group: 'Layout', Icon: IconStack },
]

export const FIELD_TYPE_GROUPS: FieldTypeGroup[] = ['Text', 'Data', 'Media & Relations', 'Layout']

/** type → Icon, for rendering a field card's leading glyph. */
export const ICON_FOR: Record<string, Ico> = Object.fromEntries(FIELD_TYPES.map((f) => [f.type, f.Icon]))

/** A stable starter name/label for a freshly-added field of a given type. */
export function starterField(fieldType: string, existing: Set<string>): { name: string; label: string } {
  const meta = FIELD_TYPES.find((f) => f.type === fieldType)
  const baseLabel = meta?.label ?? fieldType
  let name = fieldType
  let i = 2
  while (existing.has(name)) name = `${fieldType}${i++}`
  return { name, label: baseLabel }
}
