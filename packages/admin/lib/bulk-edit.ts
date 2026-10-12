/**
 * File Name: bulk-edit.ts
 * Purpose: Utility functions for the bulk editor — field eligibility, conditional-visibility
 *          evaluation, and per-cell validation that mirrors the single-record editor rules.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on @tangen/types (FieldDefinition, flattenFields) and lib/editor (evalConditionalRule).
 */
import type { FieldDefinition } from '@tangen/types'
import { flattenFields } from '@tangen/types'
import { evalVisibility } from './editor'

// Field types that can be edited in the bulk editor.
// Flat types are edited inline; richtext opens a Dialog; relation uses its built-in picker.
// repeater, component, section remain excluded — too complex for a grid cell.
export const BULK_EDITABLE_TYPES = new Set([
  'text', 'textarea', 'email', 'url', 'phone',
  'number', 'date', 'boolean', 'select', 'multiselect',
  'relation', 'richtext',
])

/**
 * Returns only the fields eligible for bulk editing — flat types only.
 * Group markers, richtext, repeater, component, and section are excluded.
 */
export function getEligibleBulkFields(fields: FieldDefinition[]): FieldDefinition[] {
  return flattenFields(fields).filter(f => BULK_EDITABLE_TYPES.has(f.fieldType))
}

/**
 * Evaluates whether a field's `conditionalVisibility` rule is satisfied for
 * a particular row, considering any in-progress dirty changes for that row.
 * Dirty values take precedence over the base row data so reactive re-evaluation
 * happens as the user edits controlling fields in the same row.
 *
 * Returns `true` when no condition is configured (field is always visible).
 */
export function evalFieldCondition(
  field:       FieldDefinition,
  baseRow:     Record<string, unknown>,
  dirtyValues: Record<string, unknown>,
): boolean {
  const cv = field.config.admin?.conditionalVisibility
  if (!cv) return true
  // Dirty values take precedence over the base row per referenced field.
  return evalVisibility(cv, (n) => (n in dirtyValues ? dirtyValues[n] : baseRow[n]))
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validates a single bulk-edit cell value.
 * Returns an error string, or `null` when the value is valid.
 */
export function validateBulkCell(field: FieldDefinition, value: unknown): string | null {
  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0)

  if (field.required && empty) return `${field.label} is required`
  if (empty) return null

  const vr = field.config.validation ?? {}

  switch (field.fieldType) {
    case 'email':
      if (typeof value === 'string' && !EMAIL_RE.test(value.trim())) {
        return 'Please enter a valid email address'
      }
      break

    case 'url':
      if (typeof value === 'string') {
        try { new URL(value.trim()) } catch { return 'Please enter a valid URL' }
        if (vr.httpsOnly && !value.trim().startsWith('https://')) return 'URL must use HTTPS'
      }
      break

    case 'phone':
      if (typeof value === 'string' && !/^\+?[\d\s\-().]+$/.test(value.trim())) {
        return 'Please enter a valid phone number'
      }
      break

    case 'number': {
      const n = Number(value)
      if (isNaN(n)) return `${field.label} must be a number`
      if (vr.min != null && n < vr.min) return `${field.label} must be at least ${vr.min}`
      if (vr.max != null && n > vr.max) return `${field.label} must be at most ${vr.max}`
      if (vr.integer && !Number.isInteger(n)) return `${field.label} must be a whole number`
      if (vr.positiveOnly && n <= 0) return `${field.label} must be greater than zero`
      break
    }

    case 'text':
    case 'textarea':
      if (typeof value === 'string') {
        if (vr.minLength != null && value.length < vr.minLength) {
          return `${field.label} must be at least ${vr.minLength} characters`
        }
        if (vr.maxLength != null && value.length > vr.maxLength) {
          return `${field.label} must be at most ${vr.maxLength} characters`
        }
        if (vr.pattern && !new RegExp(vr.pattern).test(value)) {
          return `${field.label} has an invalid format`
        }
      }
      break
  }

  return null
}
