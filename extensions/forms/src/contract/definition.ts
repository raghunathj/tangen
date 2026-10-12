/**
 * File Name: definition-schema.ts
 * Purpose: The canonical FormDefinition contract — a JSON Schema used to
 *   constrain AI form generation, and a structural validator shared by the
 *   AI apply path, form CRUD, and tangen push (code-first forms).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: validation is intentionally structural (types,
 *   references, duplicates) — business validation of submissions lives in
 *   @tangen/types form-logic.
 */
import type { FormField, FormSettings, FormStep } from './types'

export const FORM_FIELD_TYPES = [
  'text', 'textarea', 'email', 'phone', 'number', 'date',
  'select', 'multiselect', 'radio', 'checkbox', 'file', 'hidden',
  // Presentational / layout fields (no submission value):
  'html', 'image',
  // Interaction field — the submit control:
  'submit',
] as const

export const FIELD_OPERATORS = [
  'equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty',
] as const

export interface FormDefinition {
  name: string
  slug?: string
  fields: FormField[]
  steps?: FormStep[]
  settings?: Partial<FormSettings>
}

const conditionSchema = {
  type: 'object',
  properties: {
    field: { type: 'string', description: 'Name of the field this condition inspects' },
    operator: { type: 'string', enum: [...FIELD_OPERATORS] },
    value: { type: 'string' },
  },
  required: ['field', 'operator'],
  additionalProperties: false,
}

const showIfSchema = {
  description: 'A single condition, or an and/or group of conditions',
  anyOf: [
    conditionSchema,
    {
      type: 'object',
      properties: {
        logic: { type: 'string', enum: ['and', 'or'] },
        conditions: { type: 'array', items: conditionSchema, minItems: 1 },
      },
      required: ['logic', 'conditions'],
      additionalProperties: false,
    },
  ],
}

/** JSON Schema handed to AI providers for constrained form generation. */
export const FORM_DEFINITION_JSON_SCHEMA: Record<string, any> = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Human form name' },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Stable unique id (short slug is fine)' },
          type: { type: 'string', enum: [...FORM_FIELD_TYPES] },
          name: { type: 'string', description: 'snake_case data key, unique per form' },
          label: { type: 'string' },
          placeholder: { type: 'string' },
          helpText: { type: 'string' },
          required: { type: 'boolean' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, value: { type: 'string' } },
              required: ['label', 'value'],
              additionalProperties: false,
            },
          },
          validation: {
            type: 'object',
            properties: {
              minLength: { type: 'number' }, maxLength: { type: 'number' },
              min: { type: 'number' }, max: { type: 'number' },
              pattern: { type: 'string' }, patternMessage: { type: 'string' },
              messages: { type: 'object', additionalProperties: { type: 'string' } },
              fileTypes: { type: 'array', items: { type: 'string' } }, maxFileSize: { type: 'number' },
            },
            additionalProperties: false,
          },
          showIf: showIfSchema,
          showInList: { type: 'boolean' },
          stepId: { type: 'string' },
          width: { type: 'string', enum: ['full', 'half'] },
          className: { type: 'string', description: 'Custom CSS classes on the field wrapper' },
          content: { type: 'string', description: "Presentational HTML content (type 'html')" },
          imageSrc: { type: 'string', description: "Image URL (type 'image')" },
        },
        required: ['id', 'type', 'name', 'label'],
        additionalProperties: false,
      },
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          nextButtonText: { type: 'string', description: 'Custom "Next" button text for this step' },
          showIf: showIfSchema,
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    settings: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        successTitle: { type: 'string' },
        successMessage: { type: 'string' },
        successRedirect: { type: 'string' },
        submitButtonText: { type: 'string' },
        labelPlacement: { type: 'string', enum: ['top', 'left', 'hidden'] },
        descriptionPlacement: { type: 'string', enum: ['below_label', 'below_input'] },
        validationPlacement: { type: 'string', enum: ['inline', 'summary'] },
        wrapperClass: { type: 'string' },
        honeypot: { type: 'boolean' },
        schedule: {
          type: 'object',
          properties: {
            opensAt: { type: 'string' }, closesAt: { type: 'string' },
            notYetOpenMessage: { type: 'string' }, closedMessage: { type: 'string' },
          },
          additionalProperties: false,
        },
        entryLimit: {
          type: 'object',
          properties: {
            max: { type: 'number' },
            period: { type: 'string', enum: ['total', 'day', 'week', 'month', 'year'] },
            limitMessage: { type: 'string' },
          },
          required: ['max'],
          additionalProperties: false,
        },
        personalData: {
          type: 'object',
          properties: { storeIp: { type: 'boolean' }, retentionDays: { type: 'number' } },
          additionalProperties: false,
        },
        confirmations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' }, name: { type: 'string' },
              type: { type: 'string', enum: ['message', 'redirect'] },
              title: { type: 'string' }, message: { type: 'string' },
              redirectUrl: { type: 'string' }, redirectDelaySeconds: { type: 'number' },
              showIf: showIfSchema,
            },
            required: ['id', 'name', 'type'],
            additionalProperties: false,
          },
        },
        notifications: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' }, name: { type: 'string' },
              to: { type: 'string', description: 'Email or {field} merge tag ({email} = the submitter)' },
              subject: { type: 'string' }, body: { type: 'string' },
              replyTo: { type: 'string' }, format: { type: 'string', enum: ['html', 'text'] },
              showIf: showIfSchema,
              routing: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { showIf: showIfSchema, to: { type: 'string' } },
                  required: ['showIf', 'to'],
                  additionalProperties: false,
                },
              },
            },
            required: ['to'],
            additionalProperties: false,
          },
        },
        embed: {
          type: 'object',
          properties: {
            allowedDomains: { type: 'array', items: { type: 'string' } },
            requireApiKey: { type: 'boolean' },
          },
          additionalProperties: false,
        },
        webhooks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              headers: { type: 'object', additionalProperties: { type: 'string' } },
              secret: { type: 'string' },
            },
            required: ['url'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  required: ['name', 'fields'],
  additionalProperties: false,
}

/**
 * Structural validation of a form definition (AI output, CRUD payloads,
 * code-first defineForm). Returns every problem found, not just the first.
 */
export function validateFormDefinition(def: unknown): { errors: string[] } {
  const errors: string[] = []
  const d = def as Partial<FormDefinition> | null
  if (!d || typeof d !== 'object') return { errors: ['Definition must be an object'] }

  if (!d.name || typeof d.name !== 'string' || !d.name.trim()) errors.push('Form name is required')
  if (!Array.isArray(d.fields)) {
    errors.push('fields must be an array')
    return { errors }
  }

  const stepIds = new Set((d.steps ?? []).map((s) => s?.id).filter(Boolean))
  const seenNames = new Set<string>()
  const seenIds = new Set<string>()

  const validateShowIf = (showIf: any, where: string) => {
    if (!showIf || typeof showIf !== 'object') { errors.push(`${where}: showIf must be an object`); return }
    if ('logic' in showIf) {
      if (!['and', 'or'].includes(showIf.logic)) errors.push(`${where}: unknown group logic "${showIf.logic}"`)
      if (!Array.isArray(showIf.conditions)) errors.push(`${where}: group conditions must be an array`)
      else for (const c of showIf.conditions) validateShowIf(c, where)
      return
    }
    if (!showIf.field) errors.push(`${where}: condition needs a field`)
    if (!FIELD_OPERATORS.includes(showIf.operator)) errors.push(`${where}: unknown operator "${showIf.operator}"`)
  }

  for (const [i, f] of d.fields.entries()) {
    const where = `fields[${i}]`
    if (!f || typeof f !== 'object') { errors.push(`${where}: must be an object`); continue }
    if (!f.id) errors.push(`${where}: id is required`)
    else if (seenIds.has(f.id)) errors.push(`${where}: Duplicate field id "${f.id}"`)
    else seenIds.add(f.id)
    if (!FORM_FIELD_TYPES.includes(f.type as any)) errors.push(`${where}: unknown field type "${f.type}"`)
    if (!f.name) errors.push(`${where}: name is required`)
    else if (seenNames.has(f.name)) errors.push(`${where}: Duplicate field name "${f.name}"`)
    else seenNames.add(f.name)
    if (!f.label) errors.push(`${where}: label is required`)
    if (f.stepId && !stepIds.has(f.stepId)) errors.push(`${where}: unknown stepId "${f.stepId}"`)
    if (f.showIf) validateShowIf(f.showIf, where)
  }

  for (const [i, s] of (d.steps ?? []).entries()) {
    if (!s?.id) errors.push(`steps[${i}]: id is required`)
    if (s?.showIf) validateShowIf(s.showIf, `steps[${i}]`)
  }

  const settings = (d as any).settings ?? {}
  for (const [i, c] of ((settings.confirmations ?? []) as any[]).entries()) {
    if (!c?.id) errors.push(`confirmations[${i}]: id is required`)
    if (c?.showIf) validateShowIf(c.showIf, `confirmations[${i}]`)
  }
  for (const [i, n] of ((settings.notifications ?? []) as any[]).entries()) {
    if (!n?.to) errors.push(`notifications[${i}]: to is required`)
    if (n?.showIf) validateShowIf(n.showIf, `notifications[${i}]`)
    for (const [ri, r] of ((n?.routing ?? []) as any[]).entries()) {
      if (!r?.to) errors.push(`notifications[${i}].routing[${ri}]: to is required`)
      if (r?.showIf) validateShowIf(r.showIf, `notifications[${i}].routing[${ri}]`)
    }
  }

  return { errors }
}
