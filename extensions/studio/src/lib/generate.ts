/**
 * File Name: generate.ts
 * Purpose: Pure "Generate page" model for Studio - build the JSON schema that
 *   constrains a provider's structured output to `{ blocks: [{ _type, ...props
 *   }] }` over the blocks field's component vocabulary, sanitize what comes
 *   back (unknown _types dropped, _keys minted at every depth, block cap), and
 *   the prompts that demand real marketing copy from the brief.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Field-level schema/coercion is NOT forked here - the
 *   platform's own field bridge arrives injected (ctx.ai.fieldSchema /
 *   ctx.ai.coerceField on the server; fakes in tests), so a richtext prop is
 *   coerced by exactly the code the editor's AI fill uses.
 */
import { mintBlockKey } from './presets'
import { isBindableProp, bindableRepeaterProps, type BindingDescriptor } from './binding'
import { STUDIO_WRAPPER_PROP } from './wrapper'

/**
 * Block keys the platform owns rather than any component def. The generation
 * rebuild constructs a fresh block from declared fields, so without this
 * these are silently lost - `_disabled` and `_label` already were, meaning a
 * block hidden or renamed before an AI fill came back visible and unnamed.
 */
const PRESERVED_BLOCK_KEYS = [STUDIO_WRAPPER_PROP, '_disabled', '_label'] as const

/** The most sections one generation may produce (a landing page, not a book). */
export const MAX_GENERATED_BLOCKS = 12

/** The slice of a sub-field the generation bridge needs (SubField-compatible). */
export interface GenField {
  name: string
  label: string
  fieldType: string
  config?: Record<string, unknown>
  required?: boolean
}

/** The slice of a resolved component def the generator reads. */
export interface GenComponentDef {
  name: string
  label?: string
  description?: string
  fields?: GenField[]
}

/** A collection a generated kit.loop may query. */
export interface GenCollection {
  name: string
  label?: string
  /** Bindable field names, for the $bind examples the model writes. */
  fields?: string[]
}

/** One retrieved knowledge fact threaded into the prompt. */
export interface GenFact {
  content: string
  title: string | null
}

/**
 * The platform's field bridge, injected: `fieldSchema` returns the JSON schema
 * for one field's VALUE (null when the field type cannot be generated) and
 * `coerceField` turns raw provider output into a valid stored value (throws
 * when it cannot).
 */
export interface GenFieldBridge {
  fieldSchema: (field: GenField) => Record<string, unknown> | null
  coerceField: (field: GenField, raw: unknown) => unknown
}

type Json = Record<string, unknown>

/**
 * Widen two colliding prop schemas into one both defs can satisfy - the
 * mirror of the platform's mergeValueSchemas (packages/api/src/services/ai/
 * coerce.ts), which applies the same rule to NESTED component fields; this
 * copy covers the page's top level, where the bridge hands back opaque
 * schemas. Enum unions for strings (enum dropped when one side is free -
 * per-def coercion still enforces options), item/property unions for arrays
 * and objects with one-sided `required` dropped, `anyOf` only for genuinely
 * different shapes.
 */
export function mergePropSchemas(a: Json, b: Json): Json {
  if (JSON.stringify(a) === JSON.stringify(b)) return a
  const desc = a.description ? { description: a.description } : {}
  if (a.type === 'string' && b.type === 'string') {
    const both = Array.isArray(a.enum) && Array.isArray(b.enum)
    return { type: 'string', ...(both ? { enum: [...new Set([...(a.enum as unknown[]), ...(b.enum as unknown[])])] } : {}), ...desc }
  }
  if (a.type === 'array' && b.type === 'array') {
    const ai = a.items, bi = b.items
    if (ai && bi && typeof ai === 'object' && typeof bi === 'object' && !Array.isArray(ai) && !Array.isArray(bi)) {
      return { type: 'array', items: mergePropSchemas(ai as Json, bi as Json), ...desc }
    }
    return { type: 'array', ...(ai ? { items: ai } : {}), ...desc }
  }
  if (a.type === 'object' && b.type === 'object') {
    const properties: Json = { ...((a.properties as Json | undefined) ?? {}) }
    for (const [k, v] of Object.entries((b.properties as Json | undefined) ?? {})) {
      properties[k] = k in properties ? mergePropSchemas(properties[k] as Json, v as Json) : v
    }
    const req = (Array.isArray(a.required) && Array.isArray(b.required))
      ? (a.required as string[]).filter((r) => (b.required as string[]).includes(r))
      : []
    return { type: 'object', properties, ...(req.length ? { required: req } : {}), ...desc }
  }
  const variants = [...(Array.isArray(a.anyOf) ? (a.anyOf as Json[]) : [a]), ...(Array.isArray(b.anyOf) ? (b.anyOf as Json[]) : [b])]
  return { anyOf: variants }
}

/**
 * JSON schema constraining the provider to `{ blocks: [...] }` where every
 * block's `_type` is one of the allowed component names. Mirrors the
 * platform's component-field schema shape: sub-field properties are merged
 * into one items object (structured-output modes cannot express per-variant
 * shapes) with a legend telling the model which fields belong to which type;
 * name collisions across defs widen via mergePropSchemas instead of letting
 * the first def win. Fields the bridge cannot express (media, relations)
 * are simply left out.
 */
export function buildBlocksJsonSchema(
  defs: GenComponentDef[],
  maxBlocks: number,
  bridge: GenFieldBridge,
): Record<string, unknown> {
  const names = defs.map((d) => d.name)
  const properties: Record<string, unknown> = {
    _type: { type: 'string', enum: names, description: 'The section type.' },
  }
  const legend: string[] = []
  for (const def of defs) {
    const used: string[] = []
    for (const sub of def.fields ?? []) {
      if (sub.name === '_type') continue // the discriminator is ours
      const s = bridge.fieldSchema(sub)
      if (!s) continue
      properties[sub.name] = sub.name in properties
        ? mergePropSchemas(properties[sub.name] as Json, s)
        : s
      used.push(sub.name)
    }
    legend.push(`${def.name}: ${used.join(', ') || '(no props)'}`)
  }
  return {
    type: 'object',
    properties: {
      blocks: {
        type: 'array',
        minItems: 1,
        maxItems: maxBlocks,
        items: {
          type: 'object',
          properties,
          required: ['_type'],
          description: `Per section type use ONLY its own fields - ${legend.join('; ')}.`,
        },
        description: 'The page sections, in top-to-bottom render order.',
      },
    },
    required: ['blocks'],
  }
}

/**
 * Mint `_key`s throughout a coerced prop value: every plain object sitting in
 * an array (repeater rows, nested blocks) gets one when missing. Objects not
 * in arrays (geopoint, json blobs) are left untouched.
 */
export function ensureRowKeys(value: unknown, mintKey: () => string = mintBlockKey): unknown {
  if (!Array.isArray(value)) return value
  return value.map((v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = { ...(v as Record<string, unknown>) }
      if (typeof o._key !== 'string' || !o._key) o._key = mintKey()
      for (const [k, val] of Object.entries(o)) {
        if (k !== '_key') o[k] = ensureRowKeys(val, mintKey)
      }
      return o
    }
    return ensureRowKeys(v, mintKey)
  })
}


// ── Generated data bindings (D-T6) ────────────────────────────────────────────
//
// The model may bind a loop template prop to a record field
// (`{ "$bind": "item.title" }`). Those descriptors are OBJECTS sitting on
// props the platform coerces as TEXT, so passing them through the bridge
// unchanged would stringify them into "[object Object]" - worse than losing
// them. Rather than teach core's AI coercion a Studio concept, the binding is
// swapped for an opaque STRING sentinel before coercion (strings survive text
// coercion intact, at any nesting depth) and swapped back after. A final pass
// drops bindings the model put on props that may not bind.

/** Sentinel body: control characters, so no real generated copy collides. */
const BIND_SENTINEL = (i: number) => `\u0000tgbind:${i}\u0000`
const BIND_SENTINEL_RE = /^\u0000tgbind:(\d+)\u0000$/

const isBindingValue = (v: unknown): v is BindingDescriptor =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as BindingDescriptor).$bind === 'string'

/** Replaces every binding with a sentinel string, collecting the originals. */
function stashBindings(value: unknown, found: BindingDescriptor[]): unknown {
  if (isBindingValue(value)) {
    found.push(value)
    return BIND_SENTINEL(found.length - 1)
  }
  if (Array.isArray(value)) return value.map((v) => stashBindings(v, found))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = stashBindings(v, found)
    return out
  }
  return value
}

/** Puts the descriptors back wherever a sentinel survived coercion. */
function unstashBindings(value: unknown, found: BindingDescriptor[]): unknown {
  if (typeof value === 'string') {
    const m = BIND_SENTINEL_RE.exec(value)
    return m ? (found[Number(m[1])] ?? undefined) : value
  }
  if (Array.isArray(value)) return value.map((v) => unstashBindings(v, found))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = unstashBindings(v, found)
    return out
  }
  return value
}

/**
 * Drops bindings the model placed on props that may not bind - style and
 * layout stay page design, never record data (the same whitelist the props
 * rail enforces). Walks blocks by their own `_type`, so each level is judged
 * against its own rules.
 */
function dropDisallowedBindings(value: unknown, type: string | null, prop: string | null): unknown {
  if (isBindingValue(value)) {
    const allowed = type && prop ? isBindableProp(type, prop) : false
    return allowed ? value : undefined
  }
  if (Array.isArray(value)) {
    const rows = value.map((v) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const row = v as Record<string, unknown>
        // A block carries its own _type; a repeater row inherits the parent's.
        const childType = typeof row._type === 'string' ? row._type : type
        const rowProps = typeof row._type === 'string' ? null : (type && prop ? bindableRepeaterProps(type, prop) : null)
        const out: Record<string, unknown> = {}
        for (const [k, inner] of Object.entries(row)) {
          const cleaned = rowProps
            ? (isBindingValue(inner) && !rowProps.includes(k) ? undefined : inner)
            : dropDisallowedBindings(inner, childType, k)
          if (cleaned !== undefined) out[k] = cleaned
        }
        return out
      }
      return dropDisallowedBindings(v, type, prop)
    })
    return rows
  }
  return value
}

export interface SanitizeOptions {
  maxBlocks: number
  mintKey?: () => string
}

/**
 * Validate + repair a provider's generation. Accepts `{ blocks: [...] }` or a
 * bare array; drops non-object entries and unknown `_type`s; keeps only the
 * matched component's OWN fields, coercing each prop through the bridge (a bad
 * value drops the prop, never the block); mints a fresh `_key` per block and
 * per nested row; caps the result at `maxBlocks`.
 */
export function sanitizeGeneratedBlocks(
  raw: unknown,
  defs: GenComponentDef[],
  opts: SanitizeOptions,
  bridge: GenFieldBridge,
): Array<Record<string, unknown>> {
  const mintKey = opts.mintKey ?? mintBlockKey
  const byName = new Map(defs.map((d) => [d.name, d]))
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { blocks?: unknown }).blocks)
      ? ((raw as { blocks: unknown[] }).blocks)
      : []
  const out: Array<Record<string, unknown>> = []
  for (const item of list) {
    if (out.length >= opts.maxBlocks) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const def = byName.get(String((item as Record<string, unknown>)._type))
    if (!def) continue
    const block: Record<string, unknown> = { _key: mintKey(), _type: def.name }
    // Platform-owned keys are not component fields, so the rebuild below
    // would drop them. `_key` is deliberately re-minted (never trust the
    // model's), but the rest belong to the block and must survive: the
    // Studio wrapper, and the hidden/renamed state a block already carried
    // before an AI fill touched it.
    for (const key of PRESERVED_BLOCK_KEYS) {
      const v = (item as Record<string, unknown>)[key]
      if (v === undefined || v === null) continue
      if (key === STUDIO_WRAPPER_PROP && (typeof v !== 'object' || Array.isArray(v))) continue
      block[key] = v
    }
    for (const sub of def.fields ?? []) {
      const v = (item as Record<string, unknown>)[sub.name]
      if (v === null || v === undefined) continue
      try {
        // Bindings ride through coercion as sentinel strings (see above),
        // then any the whitelist rejects are dropped.
        const found: BindingDescriptor[] = []
        const stashed = stashBindings(v, found)
        const coerced = ensureRowKeys(bridge.coerceField(sub, stashed), mintKey)
        const restored = found.length > 0 ? unstashBindings(coerced, found) : coerced
        const cleaned = found.length > 0
          ? dropDisallowedBindings(restored, def.name, sub.name)
          : restored
        if (cleaned !== undefined) block[sub.name] = cleaned
      } catch { /* bad prop value - drop the prop, keep the section */ }
    }
    out.push(block)
  }
  return out
}

const FACT_CHARS = 500
const MAX_FACTS = 6

/** Bindable field names listed per collection in the prompt. */
const MAX_COLLECTION_FIELDS = 12

/** System prompt: real copy from the brief, sensible order, allowed types only. */
export function buildGenerateSystemPrompt(opts: {
  typeLabel: string
  single?: boolean
  vocabulary: GenComponentDef[]
  /** Collections a kit.loop may query, with a few bindable field names. */
  collections?: GenCollection[]
}): string {
  const vocab = opts.vocabulary
    .map((d) => `- ${d.name}${d.label && d.label !== d.name ? ` (${d.label})` : ''}${d.description ? `: ${d.description}` : ''}`)
    .join('\n')
  const hasKit = opts.vocabulary.some((d) => d.name.startsWith('kit.'))
  const hasSite = opts.vocabulary.some((d) => !d.name.startsWith('kit.'))
  const lines = [
    `You compose landing pages for the "${opts.typeLabel}" content type from a FIXED section vocabulary.`,
    `Allowed section types (the _type of every block MUST be one of these):`,
    vocab,
    ``,
    `Rules:`,
    `- Write REAL, specific marketing copy grounded in the brief. Never lorem ipsum, never placeholder text like "Your headline here".`,
    opts.single
      ? `- Produce exactly ONE section: the single type that best serves the brief.`
      : `- Order sections the way a landing page reads: when a hero-like section exists it comes FIRST; a call-to-action section belongs near the END.`,
    `- Fill the fields that make the page work; when the brief gives no ground for a factual value (a price, a date, a name), leave that field out rather than inventing it.`,
    `- Keep copy concise and benefit-led; headlines short, body text scannable.`,
  ]
  if (hasKit) {
    lines.push(
      `Builder Kit (the kit.* types):`,
      `- Compose pages as kit.section bands: each top-level kit block SHOULD be a kit.section whose children hold the widgets (kit.heading, kit.text, kit.buttons, ...). Never emit a bare widget at the top level when kit.section is available, and never nest a kit.section inside anything.`,
      `- For side-by-side content (text beside an image, columned features) put a kit.row inside the section's children and fill col1/col2/col3 to match its layout.`,
      `- Style props are design-token slots (background, padding, size, width, gap): pick from the allowed values only; vary section backgrounds (default/muted/brand) so the page has rhythm.`,
    )
    if (hasSite) {
      lines.push(`- Prefer the site's own section types where one fits the content; reach for kit.* to build what the site vocabulary does not cover.`)
    }
    // A listing brief ("latest three blog posts") must reach for a real
    // query, not three hand-written fake cards that rot the day content
    // changes. Only teach this when a loop AND something to query exist.
    const collections = opts.collections ?? []
    const hasLoop = opts.vocabulary.some((d) => d.name === 'kit.loop')
    if (hasLoop && collections.length > 0) {
      lines.push(
        `Dynamic listings (kit.loop):`,
        `- When the brief asks for a LISTING of existing content ("latest posts", "our products", "recent case studies"), emit a kit.loop instead of hand-writing fake cards. A loop stays correct as content changes; invented cards do not.`,
        `- Set "source" to one of these collections, "limit" to how many the brief implies, and build "itemTemplate" from widgets that show one record.`,
        `- Available collections (source -> bindable fields):`,
        ...collections.map((c) => {
          const label = c.label && c.label !== c.name ? ` (${c.label})` : ''
          const fields = (c.fields ?? []).slice(0, MAX_COLLECTION_FIELDS)
          return `  - ${c.name}${label}${fields.length > 0 ? `: ${fields.join(', ')}` : ''}`
        }),
        `- Inside itemTemplate, bind a prop to the record with {"$bind": "item.<field>"} - for example a kit.heading whose text is {"$bind": "item.title"}. Add "fallback" for fields that may be empty. Props you do NOT bind stay the same on every row, so bind anything that should differ per record.`,
        `- Never bind style or layout props (background, padding, size, align) - those are page design, not record data.`,
      )
    }
  }
  return lines.filter(Boolean).join('\n')
}

/** User prompt: the brief plus any retrieved workspace facts. */
export function buildGenerateUserPrompt(opts: { brief: string; facts?: GenFact[] }): string {
  const parts = [`Brief: ${opts.brief}`]
  const facts = (opts.facts ?? []).slice(0, MAX_FACTS)
  if (facts.length > 0) {
    const rendered = facts
      .map((f) => `- ${f.title ? `${f.title}: ` : ''}${String(f.content).slice(0, FACT_CHARS)}`)
      .join('\n')
    parts.push(`Workspace facts (from the knowledge index) - use them so the copy is accurate:\n${rendered}`)
  }
  return parts.join('\n\n')
}
