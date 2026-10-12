/**
 * File Name: schema-gen.ts
 * Purpose: AB-0 — the AI contract for "describe → build a schema". Emits the JSON
 *   schema the model is constrained to (per kind: content type / component / global),
 *   a system prompt teaching Tangen's authoring conventions, and coercion of the
 *   model's raw output into a normalised, valid draft (snake_case names, only
 *   built-in ∪ installed custom field types, sane defaults). The draft is NEVER
 *   written — the admin loads it into the builder for review, then Saves through the
 *   existing gated write API.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { sanitizeFieldConfig } from '@tangen/schema'
import { RESERVED_FIELD_NAMES } from '@tangen/types'

export type BuilderKind = 'type' | 'component' | 'global'

/**
 * The built-in field types the builder can author. Mirrors the `FieldType` union in
 * @tangen/types (kept as a runtime list here because that union has no runtime form).
 */
export const BUILTIN_FIELD_TYPES: string[] = [
  'text', 'slug', 'email', 'url', 'phone', 'textarea', 'richtext', 'number', 'boolean', 'date',
  'time', 'color', 'tags', 'code', 'geopoint', 'currency', 'rating', 'select',
  'multiselect', 'relation', 'object', 'media', 'repeater', 'component', 'json', 'group',
]

const WIDTHS = ['full', 'half', 'third']
const STAGES = ['main', 'sidebar']

/** A normalised field in a generated draft. */
export interface GeneratedField {
  name: string
  label: string
  fieldType: string
  config: Record<string, unknown>
  required: boolean
  /** Content types only. */
  stage?: 'main' | 'sidebar'
  width?: 'full' | 'half' | 'third'
}

/** A normalised generated draft (content type / component / global). */
export interface GeneratedSchema {
  name: string
  label: string
  description?: string
  icon?: string
  fields: GeneratedField[]
}

/** snake_case a human string → a safe machine name (`^[a-z][a-z0-9_]*`). */
export function toSnake(input: unknown): string {
  return String(input ?? '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, '_$1')
}

/**
 * The JSON schema the provider's `generateJSON` is constrained to. `fieldType` is an
 * enum of the built-ins plus the workspace's installed custom types, so the model can
 * only propose valid types. Content types carry per-field `stage` + `width`;
 * components/globals are a flat field list.
 */
export function buildBuilderJsonSchema(kind: BuilderKind, customTypes: string[]): Record<string, unknown> {
  const fieldType = [...BUILTIN_FIELD_TYPES, ...customTypes.filter((t) => !BUILTIN_FIELD_TYPES.includes(t))]
  const fieldProps: Record<string, unknown> = {
    name: { type: 'string', description: 'snake_case machine name' },
    label: { type: 'string' },
    fieldType: { type: 'string', enum: fieldType },
    config: { type: 'object', description: 'Field config (validation, options, relation targetType, …)', additionalProperties: true },
    required: { type: 'boolean' },
  }
  if (kind === 'type') {
    fieldProps.stage = { type: 'string', enum: STAGES, description: 'main = editor body, sidebar = editor sidebar' }
    fieldProps.width = { type: 'string', enum: WIDTHS }
  }
  return {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'snake_case machine name' },
      label: { type: 'string' },
      description: { type: 'string' },
      icon: { type: 'string', description: 'An @tangen/icons name, e.g. IconArticle' },
      fields: {
        type: 'array',
        items: { type: 'object', properties: fieldProps, required: ['name', 'label', 'fieldType'] },
      },
    },
    required: ['name', 'label', 'fields'],
  }
}

const KIND_NOUN: Record<BuilderKind, string> = {
  type: 'content type', component: 'reusable component', global: 'global (workspace settings group)',
}

/** System prompt teaching Tangen's authoring conventions for the given kind. */
export function builderSystemPrompt(kind: BuilderKind, customTypes: string[]): string {
  const custom = customTypes.length ? `\nInstalled custom field types you may also use: ${customTypes.join(', ')}.` : ''
  return [
    `You design exactly ONE Tangen ${KIND_NOUN[kind]} from the developer's brief. Output only the JSON schema you are given.`,
    `If the brief names a broad domain (e.g. "a blog"), build the single primary ${KIND_NOUN[kind]} for it (e.g. a "post") - never multiple types or a data model.`,
    'Names (the `name` of the object and every field) MUST be snake_case (^[a-z][a-z0-9_]*). Labels are human-readable.',
    'Prefer the simplest field type that fits: text, textarea, richtext, number, boolean, date, select, media, relation, repeater, component.',
    'For a relation set config.targetType to the related type name. For select set config.options (label/value). Put help text in config.admin.helpText.',
    "For a URL-safe secondary identifier (SKU, code, category path) use fieldType 'slug' with config.source set to the field it derives from - never a plain text field. It is unique by default.",
    'A date field that should default to the creation moment takes config.default = { "$dynamic": "now" } (text fields support { "$dynamic": "currentUser" } and { "$dynamic": "uuid" }). There is no defaultToNow.',
    kind === 'type'
      ? 'Do NOT add title/slug/status/published_at/created_at/updated_at fields - those system columns already exist on every type. Place primary fields in stage "main"; put metadata (author, dates, flags) in "sidebar". Use width full/half/third for layout.'
      : 'This is a flat field list - no stages, no system fields.',
    'Keep it focused: only the fields the brief implies. Do not invent unrelated fields.' + custom,
  ].join('\n')
}

// ── Clarify-before-draft (assessment) ─────────────────────────────────────────

const MAX_QUESTIONS = 3

/** The JSON schema for the pre-draft assessment: is the brief buildable, or ask first? */
export function buildAssessSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      ready: { type: 'boolean', description: 'True if the brief is detailed enough to build a good schema now' },
      questions: {
        type: 'array',
        items: { type: 'string' },
        description: `Up to ${MAX_QUESTIONS} short clarifying questions when not ready; empty when ready`,
      },
    },
    required: ['ready'],
  }
}

/** System prompt for the assessment step — ask ONLY when genuinely underspecified. */
export function assessSystemPrompt(kind: BuilderKind): string {
  return [
    `You are about to build exactly ONE Tangen ${KIND_NOUN[kind]} from the developer's brief.`,
    `Scope: a single ${KIND_NOUN[kind]} and its own fields - nothing else. NEVER ask whether to create multiple types/components/globals, related types, or a whole data model; that is out of scope. If the brief names a broad domain (e.g. "a blog"), treat it as the one primary ${KIND_NOUN[kind]} (e.g. a "post") and assess THAT.`,
    'First decide whether the brief gives enough to build something good. If it clearly does, set ready=true and questions=[].',
    `Only when genuinely underspecified, set ready=false and ask up to ${MAX_QUESTIONS} SHORT questions about THIS ${KIND_NOUN[kind]}'s own fields (e.g. "Should posts have categories or tags?", "A hero image?", "Any SEO fields?"). Each question must be answerable by listing fields.`,
    'Do not ask about anything you can reasonably default. Prefer building over asking when in doubt.',
  ].join('\n')
}

/** The normalised assessment result. */
export interface BriefAssessment { ready: boolean; questions: string[] }

/** Coerce the model's raw assessment into a clean result (bool + ≤3 string questions). */
export function coerceAssessment(raw: any): BriefAssessment {
  const questions = Array.isArray(raw?.questions)
    ? raw.questions.filter((q: unknown) => typeof q === 'string' && q.trim()).map((q: string) => q.trim()).slice(0, MAX_QUESTIONS)
    : []
  // Ready unless the model explicitly said not-ready AND gave questions — bias to building.
  const ready = raw?.ready !== false || questions.length === 0
  return { ready, questions }
}

function coerceField(raw: any, kind: BuilderKind, allowed: Set<string>): GeneratedField | null {
  const fieldType = String(raw?.fieldType ?? '')
  if (!allowed.has(fieldType)) return null   // drop unknown/hallucinated types
  const name = toSnake(raw?.name)
  if (!name) return null
  // System columns (title/slug/status/published_at/…) exist on every content TYPE —
  // models re-invent them; keeping one fails CREATE TABLE with a duplicate column.
  // Components/globals store fields in jsonb, so their names are unconstrained.
  if (kind === 'type' && RESERVED_FIELD_NAMES.has(name)) return null
  const field: GeneratedField = {
    name,
    label: String(raw?.label ?? name),
    fieldType,
    // Strip config keys FieldConfig doesn't know (models invent e.g. "features") —
    // they'd fail the push typecheck and show as garbage controls in the builder.
    config: raw?.config && typeof raw.config === 'object' && !Array.isArray(raw.config)
      ? sanitizeFieldConfig(raw.config, fieldType) : {},
    required: raw?.required === true,
  }
  if (kind === 'type') {
    field.stage = raw?.stage === 'sidebar' ? 'sidebar' : 'main'
    field.width = WIDTHS.includes(raw?.width) ? raw.width : 'full'
  }
  return field
}

/**
 * Normalises the model's raw output into a valid draft: snake_case names, only
 * built-in ∪ installed custom field types (unknowns dropped), object config, and
 * sane defaults (required=false, stage=main, width=full for content types).
 */
export function coerceBuilderModel(raw: any, kind: BuilderKind, customTypes: string[]): GeneratedSchema {
  const allowed = new Set([...BUILTIN_FIELD_TYPES, ...customTypes])
  const name = toSnake(raw?.name) || 'untitled'
  const seen = new Set<string>()
  const fields: GeneratedField[] = []
  for (const raw2 of Array.isArray(raw?.fields) ? raw.fields : []) {
    const f = coerceField(raw2, kind, allowed)
    if (!f || seen.has(f.name)) continue   // drop invalid + de-dupe by name
    seen.add(f.name)
    fields.push(f)
  }
  return {
    name,
    label: String(raw?.label ?? name),
    ...(raw?.description ? { description: String(raw.description) } : {}),
    ...(raw?.icon ? { icon: String(raw.icon) } : {}),
    fields,
  }
}

// ── Multi-schema set generation ("build my whole blog") ───────────────────────

/** Max schemas in one set — bounds cost + blast radius. */
export const MAX_SET_SCHEMAS = 5

/** A generated schema plus which builder kind it is. */
export interface GeneratedSchemaItem extends GeneratedSchema { kind: BuilderKind }

/**
 * The JSON schema for generating a SET of related schemas from one brief — an array of
 * `{ kind, name, label, description?, icon?, fields[] }`. Content types carry per-field
 * stage+width; relations reference sibling types by `config.targetType`.
 */
export function buildSchemaSetJsonSchema(customTypes: string[]): Record<string, unknown> {
  const fieldType = [...BUILTIN_FIELD_TYPES, ...customTypes.filter((t) => !BUILTIN_FIELD_TYPES.includes(t))]
  return {
    type: 'object',
    properties: {
      schemas: {
        type: 'array',
        maxItems: MAX_SET_SCHEMAS,
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['type', 'component', 'global'] },
            name: { type: 'string', description: 'snake_case machine name' },
            label: { type: 'string' },
            description: { type: 'string' },
            icon: { type: 'string' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  label: { type: 'string' },
                  fieldType: { type: 'string', enum: fieldType },
                  config: { type: 'object', additionalProperties: true },
                  required: { type: 'boolean' },
                  stage: { type: 'string', enum: ['main', 'sidebar'] },
                  width: { type: 'string', enum: ['full', 'half', 'third'] },
                },
                required: ['name', 'label', 'fieldType'],
              },
            },
          },
          required: ['kind', 'name', 'label', 'fields'],
        },
      },
    },
    required: ['schemas'],
  }
}

/** System prompt for set generation — related content types, one primary + supporting. */
export function schemaSetSystemPrompt(customTypes: string[]): string {
  const custom = customTypes.length ? `\nInstalled custom field types you may also use: ${customTypes.join(', ')}.` : ''
  return [
    'You design a SET of related Tangen schemas (a small data model) from the developer\'s brief.',
    `Output at most ${MAX_SET_SCHEMAS} schemas - the primary content type plus the few supporting types/globals it needs (e.g. a blog = post + author + category + site settings). Do NOT over-model; only what the brief implies.`,
    'Each schema: kind is "type" (content type), "component" (reusable block), or "global" (settings group). Names (schema + field) MUST be snake_case.',
    'Wire relations: when one type references another in the set, add a relation field with config.targetType set to that type\'s name. Put primary fields in stage "main", metadata in "sidebar" (content types only).',
    'Do NOT add title/slug/status/createdAt/updatedAt - those system fields already exist on every content type.' + custom,
  ].join('\n')
}

/**
 * Normalise the model's raw set output into valid GeneratedSchemaItems — per-item coerce
 * (snake_case, drop unknown field types), drop nameless items, de-dupe by name, cap the set.
 */
export function coerceSchemaSet(raw: any, customTypes: string[]): GeneratedSchemaItem[] {
  const items = Array.isArray(raw?.schemas) ? raw.schemas : []
  const out: GeneratedSchemaItem[] = []
  const seen = new Set<string>()
  for (const it of items) {
    if (!toSnake(it?.name)) continue   // drop truly nameless items
    const kind: BuilderKind = it?.kind === 'component' ? 'component' : it?.kind === 'global' ? 'global' : 'type'
    const model = coerceBuilderModel(it, kind, customTypes)
    if (seen.has(model.name)) continue   // de-dupe by name
    seen.add(model.name)
    out.push({ kind, ...model })
    if (out.length >= MAX_SET_SCHEMAS) break
  }
  return out
}
