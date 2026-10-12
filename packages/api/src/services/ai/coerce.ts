/**
 * File Name: coerce.ts
 * Purpose: Field-type-aware bridge between LLM output and Tangen field values —
 *          builds the JSON schema a provider must satisfy for a field, coerces
 *          and validates what comes back, and converts markdown to the
 *          ProseMirror doc shape richtext fields store.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: pure functions. Relation/media/object fields are handled
 *          by object-level generation (candidate enums), not per-field fill.
 */
import type { FieldDefinition } from '@tangen/types'
import { RequestError } from '../../lib/errors'

type Json = Record<string, unknown>

const UNSUPPORTED: ReadonlySet<string> = new Set([
  'relation', 'media', 'object', 'group',
])

function staticOptionValues(field: FieldDefinition): string[] | null {
  const cfg = field.config as any
  if (cfg?.optionsSource === 'dynamic') return null
  const options = cfg?.options
  if (!Array.isArray(options) || options.length === 0) return null
  return options.map((o: any) => String(o.value))
}

/**
 * JSON schema the provider must satisfy when filling this field. Always an
 * object with a single `value` property so every provider's structured-output
 * mode can express it.
 */
export function jsonSchemaForField(field: FieldDefinition): Json {
  const value = valueSchemaFor(field)
  return { type: 'object', properties: { value }, required: ['value'] }
}

/**
 * Widen two colliding VALUE schemas into one both variants can satisfy —
 * structured-output modes flatten every component's sub-fields into a single
 * items object, so two components sharing a prop name must share a schema.
 * First-def-wins would wrongly constrain the second def's values (e.g. a
 * spacing-token `size` forced through a type-token enum); instead: enum
 * unions for strings (enum dropped when only one side has one — per-def
 * coercion still enforces options), item/property unions for arrays and
 * objects with one-sided `required` dropped, `anyOf` only for genuinely
 * different shapes. Mirrored by the Studio extension's top-level page
 * schema builder (extensions/studio/src/lib/generate.ts).
 */
export function mergeValueSchemas(a: Json, b: Json): Json {
  if (JSON.stringify(a) === JSON.stringify(b)) return a
  const desc = a.description ? { description: a.description } : {}
  if (a.type === 'string' && b.type === 'string') {
    const both = Array.isArray(a.enum) && Array.isArray(b.enum)
    return { type: 'string', ...(both ? { enum: [...new Set([...(a.enum as unknown[]), ...(b.enum as unknown[])])] } : {}), ...desc }
  }
  if (a.type === 'array' && b.type === 'array') {
    const ai = a.items, bi = b.items
    if (ai && bi && typeof ai === 'object' && typeof bi === 'object' && !Array.isArray(ai) && !Array.isArray(bi)) {
      return { type: 'array', items: mergeValueSchemas(ai as Json, bi as Json), ...desc }
    }
    return { type: 'array', ...(ai ? { items: ai } : {}), ...desc }
  }
  if (a.type === 'object' && b.type === 'object') {
    const properties: Json = { ...((a.properties as Json | undefined) ?? {}) }
    for (const [k, v] of Object.entries((b.properties as Json | undefined) ?? {})) {
      properties[k] = k in properties ? mergeValueSchemas(properties[k] as Json, v as Json) : v
    }
    const req = (Array.isArray(a.required) && Array.isArray(b.required))
      ? (a.required as string[]).filter((r) => (b.required as string[]).includes(r))
      : []
    return { type: 'object', properties, ...(req.length ? { required: req } : {}), ...desc }
  }
  const variants = [...(Array.isArray(a.anyOf) ? (a.anyOf as Json[]) : [a]), ...(Array.isArray(b.anyOf) ? (b.anyOf as Json[]) : [b])]
  return { anyOf: variants }
}

function valueSchemaFor(field: FieldDefinition): Json {
  const options = staticOptionValues(field)
  switch (field.fieldType) {
    case 'text': case 'textarea': case 'email': case 'url': case 'phone':
    case 'color': case 'time': case 'code': case 'date':
      return { type: 'string' }
    case 'select':
      return options ? { type: 'string', enum: options } : { type: 'string' }
    case 'number': case 'currency': case 'rating':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'tags':
      return { type: 'array', items: { type: 'string' } }
    case 'multiselect':
      return { type: 'array', items: options ? { type: 'string', enum: options } : { type: 'string' } }
    case 'richtext':
      return { type: 'string', description: 'The content as markdown (paragraphs, ## headings, - lists).' }
    case 'geopoint':
      return {
        type: 'object',
        properties: { lat: { type: 'number' }, lng: { type: 'number' } },
        required: ['lat', 'lng'],
      }
    case 'json':
      return { type: 'object', description: 'A JSON object appropriate for this field.' }
    case 'component': {
      // Array of typed blocks: _type picks the component; only that
      // component's sub-fields apply (enforced in coercion).
      const comps = ((field.config as any)?.components ?? []) as any[]
      const typeNames = comps.map(c => String(c.name))
      const properties: Json = {
        _type: { type: 'string', enum: typeNames, description: 'The block type.' },
      }
      const legend: string[] = []
      for (const comp of comps) {
        const names: string[] = []
        for (const sub of (comp.fields ?? []) as FieldDefinition[]) {
          if (sub.name === '_type') continue // the discriminator is ours
          try {
            const s = valueSchemaFor(sub)
            properties[sub.name] = sub.name in properties
              ? mergeValueSchemas(properties[sub.name] as Json, s)
              : s
            names.push(sub.name)
          } catch { /* unsupported sub-field type - skip */ }
        }
        legend.push(`${comp.name}: ${names.join(', ')}`)
      }
      return {
        type: 'array',
        items: {
          type: 'object',
          properties,
          required: ['_type'],
          description: `Per block type use ONLY its own fields - ${legend.join('; ')}.`,
        },
        description: `${field.label} - content blocks.`,
      }
    }
    case 'repeater': {
      // Array of objects shaped by the repeater's sub-fields; unsupported
      // sub-field types (media, nested repeaters, …) are simply left out.
      const subFields = ((field.config as any)?.fields ?? []) as FieldDefinition[]
      const properties: Json = {}
      const required: string[] = []
      for (const sub of subFields) {
        try {
          properties[sub.name] = valueSchemaFor(sub)
          if (sub.required) required.push(sub.name)
        } catch { /* unsupported sub-field type - skip */ }
      }
      const maxRows = (field.config as any)?.validation?.maxRows
      return {
        type: 'array',
        items: { type: 'object', properties, ...(required.length ? { required } : {}) },
        ...(typeof maxRows === 'number' ? { maxItems: maxRows } : {}),
        description: `${field.label} - a list of entries.`,
      }
    }
    default: {
      if (UNSUPPORTED.has(field.fieldType)) {
        throw new RequestError('VALIDATION_ERROR', `Field type "${field.fieldType}" is not supported for AI fill`)
      }
      // Extension-contributed field types declare their value shape via ai.valueShape
      const shape = (field.config as any)?.ai?.valueShape
      if (shape === 'string[]') return { type: 'array', items: { type: 'string' } }
      if (shape === 'json') return { type: 'object' }
      return { type: 'string' }
    }
  }
}

/**
 * Coerces and validates a provider's value for the field. Throws
 * VALIDATION_ERROR when the output cannot be made valid.
 */
export function coerceFieldValue(field: FieldDefinition, raw: unknown): unknown {
  const options = staticOptionValues(field)
  switch (field.fieldType) {
    case 'text': case 'textarea': case 'email': case 'url': case 'phone':
    case 'color': case 'time': case 'code': case 'date':
      return String(raw)

    case 'select': {
      const v = String(raw)
      if (options && !options.includes(v)) {
        throw new RequestError('VALIDATION_ERROR', `AI suggested "${v}" which is not a valid option for "${field.name}"`)
      }
      return v
    }

    case 'number': case 'currency': {
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n)) {
        throw new RequestError('VALIDATION_ERROR', `AI output for "${field.name}" is not a number`)
      }
      return n
    }

    case 'rating': {
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n)) {
        throw new RequestError('VALIDATION_ERROR', `AI output for "${field.name}" is not a number`)
      }
      const max = (field.config as any)?.max ?? 5
      return Math.min(Math.max(Math.round(n), 0), max)
    }

    case 'boolean':
      return Boolean(raw)

    case 'tags': {
      const arr = Array.isArray(raw) ? raw : [raw]
      return arr.map(v => String(v).trim()).filter(Boolean)
    }

    case 'multiselect': {
      const arr = (Array.isArray(raw) ? raw : [raw]).map(v => String(v))
      // drop hallucinated options rather than failing the whole fill
      return options ? arr.filter(v => options.includes(v)) : arr
    }

    case 'richtext':
      return markdownToRichtextDoc(String(raw))

    case 'geopoint': {
      const o = raw as any
      const lat = Number(o?.lat), lng = Number(o?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new RequestError('VALIDATION_ERROR', `AI output for "${field.name}" is not a lat/lng pair`)
      }
      return { lat, lng }
    }

    case 'json':
      return raw && typeof raw === 'object' ? raw : { value: raw }

    case 'component': {
      const comps = ((field.config as any)?.components ?? []) as any[]
      const byName = new Map(comps.map(c => [String(c.name), c]))
      const items = Array.isArray(raw) ? raw : []
      const out: Record<string, unknown>[] = []
      for (const item of items) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const comp = byName.get(String((item as any)._type))
        if (!comp) continue
        const block: Record<string, unknown> = {
          _key: Math.random().toString(36).slice(2, 14),
          _type: comp.name,
        }
        for (const sub of (comp.fields ?? []) as FieldDefinition[]) {
          const v = (item as Record<string, unknown>)[sub.name]
          if (v === null || v === undefined) continue
          try {
            block[sub.name] = coerceFieldValue(sub, v)
          } catch { /* bad sub-value - drop it, keep the block */ }
        }
        out.push(block)
      }
      return out
    }

    case 'repeater': {
      const subFields = ((field.config as any)?.fields ?? []) as FieldDefinition[]
      const items = Array.isArray(raw) ? raw : []
      const out: Record<string, unknown>[] = []
      for (const item of items) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const row: Record<string, unknown> = {}
        for (const sub of subFields) {
          const v = (item as Record<string, unknown>)[sub.name]
          if (v === null || v === undefined) continue
          try {
            row[sub.name] = coerceFieldValue(sub, v)
          } catch { /* bad sub-value - drop it, keep the row */ }
        }
        if (Object.keys(row).length > 0) out.push(row)
      }
      const maxRows = (field.config as any)?.validation?.maxRows
      return typeof maxRows === 'number' ? out.slice(0, maxRows) : out
    }

    default: {
      if (UNSUPPORTED.has(field.fieldType)) {
        throw new RequestError('VALIDATION_ERROR', `Field type "${field.fieldType}" is not supported for AI fill`)
      }
      // Extension-contributed field types: coerce per declared valueShape
      const shape = (field.config as any)?.ai?.valueShape
      if (shape === 'string[]') {
        const arr = Array.isArray(raw) ? raw : [raw]
        return arr.map(v => String(v).trim()).filter(Boolean)
      }
      if (shape === 'json') return raw
      return String(raw)
    }
  }
}

// ─── Markdown → ProseMirror doc ───────────────────────────────────────────────

interface PMNode { type: string; attrs?: Json; content?: PMNode[]; text?: string }

function textNode(text: string): PMNode {
  return { type: 'text', text }
}

/**
 * Converts simple markdown (paragraphs, #/##/### headings, - or * bullet
 * lists) to the ProseMirror doc shape richtext fields store. Inline marks are
 * intentionally not parsed — v1 keeps AI richtext output structural.
 */
export function markdownToRichtextDoc(markdown: string): { type: 'doc'; content: PMNode[] } {
  const blocks = markdown.replace(/\r\n/g, '\n').split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
  const content: PMNode[] = []

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
    const isList = lines.every(l => /^[-*]\s+/.test(l))

    if (isList && lines.length > 0) {
      content.push({
        type: 'bulletList',
        content: lines.map(l => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [textNode(l.replace(/^[-*]\s+/, ''))] }],
        })),
      })
      continue
    }

    for (const line of lines) {
      const heading = line.match(/^(#{1,6})\s+(.*)$/)
      if (heading) {
        content.push({ type: 'heading', attrs: { level: heading[1].length }, content: [textNode(heading[2])] })
      } else if (/^[-*]\s+/.test(line)) {
        content.push({
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [textNode(line.replace(/^[-*]\s+/, ''))] }] }],
        })
      } else {
        content.push({ type: 'paragraph', content: [textNode(line)] })
      }
    }
  }

  if (content.length === 0) content.push({ type: 'paragraph', content: [] })
  return { type: 'doc', content }
}
