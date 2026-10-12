/**
 * File Name: field-applicability.ts
 * Purpose: The single source of truth for WHICH config options apply to WHICH field
 *   types — shared by the schema-builder UI (which hides inapplicable controls) and the
 *   per-type authoring config interfaces (which reject them at compile time). Keeping the
 *   matrix here means the visual builder and `field.*` builders can never drift.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { FieldType } from './object-types'

// Exhaustive by construction: the compiler errors here whenever the FieldType union
// gains or loses a member, keeping the runtime set in lockstep.
const BUILT_IN: Record<FieldType, true> = {
  text: true, slug: true, range: true, email: true, url: true, phone: true, textarea: true, richtext: true,
  number: true, boolean: true, date: true, time: true, color: true, tags: true,
  code: true, geopoint: true, currency: true, rating: true, select: true,
  multiselect: true, relation: true, object: true, media: true, repeater: true,
  component: true, json: true, group: true, link: true,
}

/** Every built-in field type — anything else is a custom (extension/site) type. */
export const BUILT_IN_FIELD_TYPES: ReadonlySet<string> = new Set(Object.keys(BUILT_IN))

/**
 * Column names every content table already has (see the CREATE TABLE in cli/apply.ts)
 * plus `locale` (i18n side tables). A field with one of these names would collide at
 * CREATE/ALTER TABLE ("column specified more than once") — reject it everywhere:
 * builder UI, write API, and AI draft coercion.
 */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([
  'id', 'workspace_id', 'title', 'slug', 'status',
  'published_at', 'published_by', 'published_values', 'scheduled_at', 'scheduled_by',
  'created_at', 'updated_at', 'created_by', 'updated_by',
  'created_by_kind', 'updated_by_kind', 'published_by_kind',
  'locale',
])

/** Types that can appear as a list filter — scalar + reference types only. */
export const FILTERABLE_TYPES: ReadonlySet<string> = new Set([
  'text', 'slug', 'email', 'url', 'phone', 'textarea', 'number', 'boolean', 'date',
  'select', 'multiselect', 'relation', 'currency', 'rating',
])

/** Types where `validation.unique` is meaningful — identity-like scalars. */
export const UNIQUE_TYPES: ReadonlySet<string> = new Set([
  'text', 'slug', 'email', 'url', 'phone', 'number',
])

/** Container/rich types that can't render as a list column. */
export const NON_LISTABLE_TYPES: ReadonlySet<string> = new Set([
  // media IS listable — the content list renders a thumbnail column.
  'richtext', 'repeater', 'component', 'object', 'group', 'json', 'geopoint', 'range', 'link',
])

/**
 * Built-in field types that can hold a per-locale value via the side-table
 * "Localized" toggle. Text-like content, slugs (custom slug fields — the system
 * slug column stays single-value), URLs, JSON, email/phone, tags, code (e.g.
 * HTML with translatable copy), and number (in case a value differs per locale).
 *
 * NOT here — and why: media localizes through its own per-locale *asset variant*
 * mechanism (metadata.localeAssets), not this toggle; option enums
 * (select/multiselect) hold stable ids; relations are structural references;
 * boolean/date/time/color/geopoint/currency/range/rating don't translate; and
 * containers (object/repeater/component/group) localize via their SUB-fields
 * (each sub-field is tested with `isLocalizableFieldType`), not the container.
 *
 * The system `title` is always localizable when localization is enabled (handled
 * separately). One source of truth for the builder toggle + runtime i18n.
 */
export const LOCALIZABLE_TYPES: ReadonlySet<string> = new Set([
  'text', 'textarea', 'richtext', 'slug', 'url', 'json', 'email', 'phone', 'tags', 'code', 'number',
  // A link's authored VALUE may differ per locale (an English footer pointing
  // at one page, a French one at another). That is the field being localized,
  // and is a different thing from an internal link asking for a locale of its
  // own target - see LinkValue.locale.
  'link',
])

/**
 * Whether a field type supports a per-locale value (the "Localized" toggle).
 * Custom (extension) field types default to localizable — they usually wrap a
 * text primitive; built-ins follow the curated LOCALIZABLE_TYPES list.
 */
export function isLocalizableFieldType(fieldType: string): boolean {
  return !BUILT_IN_FIELD_TYPES.has(fieldType) || LOCALIZABLE_TYPES.has(fieldType)
}

/**
 * The primitive shape of a type's `default` value — types absent here have no simple
 * default (media/relation/repeater/component/select/…).
 */
export const DEFAULT_VALUE_KIND: Readonly<Record<string, 'string' | 'number' | 'boolean' | 'date' | 'color'>> = {
  text: 'string', email: 'string', url: 'string', phone: 'string', textarea: 'string',
  color: 'color',
  number: 'number', currency: 'number', rating: 'number',
  boolean: 'boolean',
  date: 'date',
}

// ── Dynamic defaults (B2) ─────────────────────────────────────────────────────

/** Declarative dynamic default kinds — resolvable by server AND admin, no functions. */
export type DynamicDefaultKind = 'now' | 'currentUser' | 'uuid'

/** The stored shape of a dynamic default: `config.default = { $dynamic: 'now' }`. */
export interface DynamicDefault { $dynamic: DynamicDefaultKind }

/** Which dynamic defaults each field type supports (static defaults follow DEFAULT_VALUE_KIND). */
export const DYNAMIC_DEFAULT_OPTIONS: Readonly<Record<string, readonly DynamicDefaultKind[]>> = {
  date: ['now'],
  text: ['currentUser', 'uuid'],
}

/** Narrow an arbitrary stored default to the dynamic shape. */
export function isDynamicDefault(v: unknown): v is DynamicDefault {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    && typeof (v as Record<string, unknown>).$dynamic === 'string'
    && ['now', 'currentUser', 'uuid'].includes((v as DynamicDefault).$dynamic)
}

/**
 * Resolve a dynamic default to a concrete value. `ctx.actorId` feeds currentUser
 * (null when unknown — the field stays empty rather than storing a lie).
 */
export function resolveDynamicDefault(
  kind: DynamicDefaultKind,
  ctx: { actorId?: string | null; now?: () => Date; uuid?: () => string } = {},
): unknown {
  switch (kind) {
    case 'now': return (ctx.now?.() ?? new Date()).toISOString()
    case 'currentUser': return ctx.actorId ?? null
    case 'uuid': return ctx.uuid?.() ?? crypto.randomUUID()
  }
}

// ── Validation warnings (B4) ──────────────────────────────────────────────────

/** Non-blocking guidance rules — same vocabulary as validation, amber not red. */
export interface FieldWarningRules {
  minLength?: number
  maxLength?: number
  pattern?: string
  /** Override the generated message. */
  message?: string
}

/**
 * Evaluate a field's warning rules against a value. Returns the warning message or
 * null. Pure + shared: the admin shows it live, the API returns it alongside writes.
 */
export function evalFieldWarning(
  rules: FieldWarningRules | undefined,
  label: string,
  value: unknown,
): string | null {
  if (!rules || value == null || value === '') return null
  const v = String(value)
  if (rules.maxLength != null && v.length > rules.maxLength) {
    return rules.message ?? `${label} is longer than the recommended ${rules.maxLength} characters`
  }
  if (rules.minLength != null && v.length < rules.minLength) {
    return rules.message ?? `${label} is shorter than the recommended ${rules.minLength} characters`
  }
  if (rules.pattern) {
    try {
      if (!new RegExp(rules.pattern).test(v)) return rules.message ?? `${label} doesn't match the recommended format`
    } catch { /* bad pattern in config - never block on a warning rule */ }
  }
  return null
}

// ── Range fields (numrange-backed) ────────────────────────────────────────────

export interface RangeValue { min: number; max: number }

/** Parse a Postgres numrange literal ("[1,10]", "(0.5,2)") to { min, max } — null when unparseable/empty. */
export function parseNumrange(v: unknown): RangeValue | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as { min?: unknown; max?: unknown }
    if (typeof o.min === 'number' && typeof o.max === 'number') return { min: o.min, max: o.max }
    return null
  }
  if (typeof v !== 'string') return null
  const m = /^[\[(]\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*[\])]$/.exec(v.trim())
  if (!m) return null
  return { min: Number(m[1]), max: Number(m[2]) }
}

/** Format { min, max } as an inclusive numrange literal for storage. */
export function formatNumrange(r: RangeValue): string {
  return `[${r.min},${r.max}]`
}
