/**
 * File Name: types.ts
 * Purpose: Shared TypeScript types and constants for the object-list component's filtering, saved-view, and status system.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */
export type Status = 'all' | 'draft' | 'published' | 'archived'

export interface DateFilters {
  publishedAtFrom?: string
  publishedAtTo?: string
  createdAtFrom?: string
  createdAtTo?: string
}

export interface FieldFilter {
  fieldName: string
  fieldLabel: string
  fieldType: string
  operator: string
  value: unknown
  /** Human-readable labels for relation ID values */
  valueLabels?: string[]
  /** Options list for select/multiselect chips */
  options?: { label: string; value: string }[]
  /** Target type slug for relation fields */
  targetType?: string
}

export interface FilterState {
  status: Status
  search: string
  dateFilters: DateFilters
  fieldFilters: FieldFilter[]
  /** Locales filter — selected content languages (empty/absent = default). */
  locales?: string[]
}

export interface SavedView {
  id: string
  name: string
  typeName: string
  filters: FilterState
  visibility: 'private' | 'shared'
  createdBy: string
  createdAt: string
}

export interface FilterableField {
  name: string
  label: string
  fieldType: string
  options?: { label: string; value: string }[]
  targetType?: string
}

export const FILTERABLE_FIELD_TYPES = new Set([
  'text', 'email', 'url', 'phone', 'textarea', 'slug', 'number', 'boolean', 'date', 'select', 'multiselect', 'relation',
])
