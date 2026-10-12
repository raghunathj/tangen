/**
 * File Name: object-schema.ts
 * Purpose: Whole-object AI generation support — builds one JSON schema covering
 *          every AI-enabled field of a type (relation/select values constrained
 *          to real candidate ids, a _create escape hatch for missing related
 *          objects) and maps the provider's output into a preview payload.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: pure — relation candidates are injected; the route loads
 *          them via the local client. Generation NEVER writes; the preview is
 *          applied client-side after human review.
 */
import { flattenFields } from '@tangen/types'
import type { FieldDefinition } from '@tangen/types'
import { jsonSchemaForField, coerceFieldValue } from './coerce'
import { isImageEligibleMediaField } from './image-eligibility'

type Json = Record<string, unknown>

/** fieldName → candidate related objects the model may reference. */
export type RelationCandidates = Map<string, { id: string; title: string }[]>

/** Field types that can never participate in object generation. */
const EXCLUDED = new Set(['media', 'object', 'component', 'group', 'json'])

interface TypeDefLike { name: string; label?: string; fields: FieldDefinition[] }

function aiEnabled(field: FieldDefinition): boolean {
  return (field.config as any)?.ai?.enabled !== false
}

function relationFields(typeDef: TypeDefLike): FieldDefinition[] {
  return flattenFields(typeDef.fields).filter(
    fd => fd.fieldType === 'relation' && aiEnabled(fd) && (fd.config as any)?.targetType,
  )
}

/**
 * Media fields that may carry an { imagePrompt } offer in the object schema —
 * exactly the fields POST /admin/ai/image would accept (top level, since the
 * image endpoint resolves fields on typeDef.fields; media inside groups never
 * participates in generation anyway).
 */
export function imageOfferFields(typeDef: TypeDefLike): FieldDefinition[] {
  return typeDef.fields.filter(fd => isImageEligibleMediaField(fd as any))
}

/**
 * Builds the JSON schema for whole-object generation. Every property is
 * optional — the model fills what it can. Relation fields with candidates
 * become id enums (with titles in the description so the model can choose);
 * relations without candidates are omitted (only reachable via _create).
 */
export function buildObjectSchema(
  typeDef: TypeDefLike,
  opts: { candidates: RelationCandidates; includeTitle: boolean },
): Json {
  const properties: Json = {}

  if (opts.includeTitle) {
    properties.__title = { type: 'string', description: 'A concise, specific title for this object.' }
  }

  for (const field of flattenFields(typeDef.fields)) {
    if (!aiEnabled(field) || EXCLUDED.has(field.fieldType)) continue

    if (field.fieldType === 'relation') {
      const cands = opts.candidates.get(field.name) ?? []
      if (cands.length === 0) continue
      const ids = cands.map(c => c.id)
      const legend = cands.slice(0, 60).map(c => `${c.id} = ${c.title}`).join('; ')
      const many = (field.config as any)?.many === true
      const description = `${field.label} - pick from existing objects: ${legend}`
      properties[field.name] = many
        ? { type: 'array', items: { type: 'string', enum: ids }, description }
        : { type: 'string', enum: ids, description }
      continue
    }

    try {
      const single = jsonSchemaForField(field) as any
      const value = { ...single.properties.value }
      const hint = (field.config as any)?.ai?.hint
      if (hint) value.description = value.description ? `${value.description} ${hint}` : hint
      properties[field.name] = value
    } catch {
      // unsupported for fill → skip from generation too
    }
  }

  // Image offers: eligible media fields take an OPTIONAL { imagePrompt } —
  // the model writes a prompt when the brief warrants artwork, the panel
  // generates through the existing image pipeline. Never a field value.
  for (const field of imageOfferFields(typeDef)) {
    properties[field.name] = {
      type: 'object',
      description: `${field.label} - an image field. Offer artwork ONLY when the brief warrants it; omit this property otherwise.`,
      properties: {
        imagePrompt: {
          type: 'string',
          description: `ONE vivid, self-contained image-generation prompt for "${field.label}" matching the brief: subject, composition, style, mood. No references to the brief, the object, or other fields.`,
        },
      },
      required: ['imagePrompt'],
    }
  }

  // Escape hatch: propose new related objects only when no candidate fits.
  const relNames = relationFields(typeDef).map(fd => fd.name)
  if (relNames.length > 0) {
    properties._create = {
      type: 'array',
      description: 'New related objects to create - ONLY when no existing candidate fits.',
      items: {
        type: 'object',
        properties: {
          forField: { type: 'string', enum: relNames },
          title: { type: 'string' },
        },
        required: ['forField', 'title'],
      },
    }
  }

  return { type: 'object', properties }
}

export interface GeneratePreview {
  title?: string
  fields: Record<string, { value: unknown; display?: string }>
  unresolved: { field: string; suggestion: unknown }[]
  toCreate: { type: string; title: string; forField: string }[]
  /** Image-generation offers for eligible media fields — never field values.
   *  Omitted entirely when there are none (JSON-mode parity). */
  images?: Record<string, { prompt: string }>
}

/**
 * Maps the provider's structured output into the preview payload the admin
 * reviews. Relation ids are validated against candidates (invalid → unresolved
 * warning), scalars run through the field coercion (failures degrade to
 * unresolved), and _create proposals are validated against relation targets.
 */
export function mapGenerateResponse(
  typeDef: TypeDefLike,
  candidates: RelationCandidates,
  raw: Record<string, unknown>,
): GeneratePreview {
  const preview: GeneratePreview = { fields: {}, unresolved: [], toCreate: [] }
  const fieldsByName = new Map(flattenFields(typeDef.fields).map(fd => [fd.name, fd]))
  const offerable = new Set(imageOfferFields(typeDef).map(fd => fd.name))

  if (typeof raw.__title === 'string' && raw.__title.trim()) {
    preview.title = raw.__title.trim()
  }

  for (const [name, value] of Object.entries(raw)) {
    if (name === '__title' || name === '_create') continue
    if (value === null || value === undefined) continue
    const field = fieldsByName.get(name)
    if (!field) continue

    // Image offers split out of the field map — apply code must never see
    // them as values. Non-offerable media output is dropped like before.
    if (field.fieldType === 'media') {
      if (offerable.has(name)) {
        const prompt = String((value as { imagePrompt?: unknown })?.imagePrompt ?? '').trim()
        if (prompt) (preview.images ??= {})[name] = { prompt }
      }
      continue
    }

    if (!aiEnabled(field) || EXCLUDED.has(field.fieldType)) continue

    if (field.fieldType === 'relation') {
      const cands = new Map((candidates.get(name) ?? []).map(c => [c.id, c.title]))
      const many = (field.config as any)?.many === true
      if (many) {
        const arr = Array.isArray(value) ? value.map(String) : [String(value)]
        const valid = arr.filter(id => cands.has(id))
        const invalid = arr.filter(id => !cands.has(id))
        for (const id of invalid) preview.unresolved.push({ field: name, suggestion: id })
        if (valid.length > 0) {
          preview.fields[name] = { value: valid, display: valid.map(id => cands.get(id)).join(', ') }
        }
      } else {
        const id = String(value)
        if (cands.has(id)) {
          preview.fields[name] = { value: id, display: cands.get(id) }
        } else {
          preview.unresolved.push({ field: name, suggestion: id })
        }
      }
      continue
    }

    try {
      preview.fields[name] = { value: coerceFieldValue(field, value) }
    } catch {
      preview.unresolved.push({ field: name, suggestion: value })
    }
  }

  // _create proposals: forField must be a relation field; type = its target
  const relByName = new Map(relationFields(typeDef).map(fd => [fd.name, fd]))
  if (Array.isArray(raw._create)) {
    for (const entry of raw._create as any[]) {
      const rel = relByName.get(String(entry?.forField))
      const title = String(entry?.title ?? '').trim()
      if (!rel || !title) continue
      preview.toCreate.push({
        type: (rel.config as any).targetType as string,
        title,
        forField: rel.name,
      })
    }
  }

  return preview
}
