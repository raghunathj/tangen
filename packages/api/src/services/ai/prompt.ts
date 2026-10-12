/**
 * File Name: prompt.ts
 * Purpose: Prompt assembly for Content AI. The server composes every prompt —
 *          workspace guidelines become the system prompt, the current object's
 *          values become truncated context, and the target field's descriptor
 *          (label, type, constraints, ai.hint) frames the task.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: pure functions — providers and DB stay out of here.
 */
import type { AIGuidelines, FieldDefinition } from '@tangen/types'

const GUIDELINE_LABELS: Record<string, string> = {
  audience: 'Audience & context',
  voiceTone: 'Brand voice & tone',
  glossary: 'Glossary (preferred terms)',
  legal: 'Legal & compliance',
  general: 'General instructions',
}

const MAX_CONTEXT_VALUE_CHARS = 500
const MAX_CONTEXT_TOTAL_CHARS = 6000

/** Renders the non-empty guideline sections as a labelled block (or ''). */
export function renderGuidelines(guidelines: AIGuidelines): string {
  const sections = Object.entries(GUIDELINE_LABELS)
    .map(([key, label]) => ({ label, text: (guidelines as any)[key]?.trim?.() ?? '' }))
    .filter(s => s.text.length > 0)
  if (sections.length === 0) return ''
  return sections.map(s => `## ${s.label}\n${s.text}`).join('\n\n')
}

/** Compact, truncated JSON-ish rendering of the object's current values. */
export function renderValuesContext(values: Record<string, unknown>, excludeField?: string): string {
  const parts: string[] = []
  let total = 0
  for (const [key, raw] of Object.entries(values ?? {})) {
    if (key === excludeField) continue
    if (raw === null || raw === undefined || raw === '') continue
    let text = typeof raw === 'string' ? raw : JSON.stringify(raw)
    if (!text) continue
    if (text.length > MAX_CONTEXT_VALUE_CHARS) text = text.slice(0, MAX_CONTEXT_VALUE_CHARS) + '…'
    const line = `- ${key}: ${text}`
    if (total + line.length > MAX_CONTEXT_TOTAL_CHARS) break
    parts.push(line)
    total += line.length
  }
  return parts.join('\n')
}

export interface FieldPromptInput {
  guidelines: AIGuidelines
  typeDef: { name: string; label?: string; fields: FieldDefinition[] }
  field: FieldDefinition
  values: Record<string, unknown>
  instruction?: string
}

/**
 * Builds the system + user prompt for filling a single field.
 */
export function buildFieldPrompt(input: FieldPromptInput): { system: string; user: string } {
  const { guidelines, typeDef, field, values, instruction } = input

  const guidelinesBlock = renderGuidelines(guidelines)
  const system = [
    `You are a content assistant for a CMS. You write field values for "${typeDef.label ?? typeDef.name}" content objects.`,
    'Follow the workspace guidelines below in every response. Output only the requested value - no commentary.',
    guidelinesBlock,
  ].filter(Boolean).join('\n\n')

  const constraints: string[] = []
  const validation = (field.config as any)?.validation ?? {}
  if (validation.maxLength) constraints.push(`max ${validation.maxLength} characters`)
  if (validation.minLength) constraints.push(`min ${validation.minLength} characters`)
  if (validation.min !== undefined) constraints.push(`min value ${validation.min}`)
  if (validation.max !== undefined) constraints.push(`max value ${validation.max}`)
  const hint = (field.config as any)?.ai?.hint

  const context = renderValuesContext(values, field.name)

  const user = [
    context ? `Current object content:\n${context}` : '',
    `Write the value for the field "${field.label}" (name: ${field.name}, type: ${field.fieldType}).`,
    hint ? `Field purpose: ${hint}` : '',
    constraints.length ? `Constraints: ${constraints.join('; ')}.` : '',
    instruction ? `Editor's instruction: ${instruction}` : '',
  ].filter(Boolean).join('\n\n')

  return { system, user }
}

export interface PanelPromptInput {
  guidelines: AIGuidelines
  panelLabel: string
  fields: { name: string; label: string; fieldType: string; config?: Record<string, unknown> }[]
  values: Record<string, unknown>
  instruction?: string
  /** Extension developer's guardrail — appended to the system prompt. */
  panelInstructions?: string
}

/**
 * Builds the system + user prompt for filling an extension panel's fields
 * (e.g. the SEO panel) in one structured call.
 */
export function buildPanelPrompt(input: PanelPromptInput): { system: string; user: string } {
  const { guidelines, panelLabel, fields, values, instruction, panelInstructions } = input

  const guidelinesBlock = renderGuidelines(guidelines)
  const system = [
    `You are a content assistant for a CMS. You fill in the "${panelLabel}" fields for a content object.`,
    'Follow the workspace guidelines below. Output only the requested values - no commentary.',
    panelInstructions ? `${panelLabel} rules: ${panelInstructions}` : '',
    guidelinesBlock,
  ].filter(Boolean).join('\n\n')

  const fieldLines = fields.map(f => {
    const hint = (f.config as any)?.ai?.hint
    return `- ${f.name} (${f.label}, ${f.fieldType})${hint ? `: ${hint}` : ''}`
  }).join('\n')

  const context = renderValuesContext(values)
  const user = [
    context ? `Current object content:\n${context}` : '',
    `Fill these ${panelLabel} fields:\n${fieldLines}`,
    instruction ? `Editor's instruction: ${instruction}` : '',
  ].filter(Boolean).join('\n\n')

  return { system, user }
}
