/**
 * File Name: editor.ts
 * Purpose: Core logic for the object editor — conditional rule evaluation, request body building,
 *          field validation, data normalization, and display formatting helpers.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on @tangen/types (FieldDefinition, FieldType, ComponentDef, ConditionalRule, flattenFields).
 */
import type { FieldDefinition, FieldTypeRef, ComponentDef, ConditionalRule, ConditionalRuleGroup, ConditionalVisibility } from '@tangen/types'
import { flattenFields, isLocalizableFieldType } from '@tangen/types'

/**
 * Evaluates a single ConditionalRule against a field value, returning whether the condition is met.
 * @param cv - The conditional rule containing operator and expected value
 * @param val - The current field value to test
 * @returns true when the rule passes; defaults to true for unknown operators
 */
export function evalConditionalRule(cv: ConditionalRule, val: unknown): boolean {
  switch (cv.operator) {
    case 'eq':       return val == cv.value
    case 'neq':      return val != cv.value
    case 'empty':    return val == null || val === '' || (Array.isArray(val) && val.length === 0)
    case 'notEmpty': return val != null && val !== '' && !(Array.isArray(val) && val.length === 0)
    case 'gt':       return Number(val) > Number(cv.value)
    case 'lt':       return Number(val) < Number(cv.value)
    case 'contains': return String(val).includes(String(cv.value))
    default:         return true
  }
}

/**
 * Evaluates a visibility condition — a single {@link ConditionalRule} or a
 * {@link ConditionalRuleGroup} (all/any). `getValue` resolves each referenced field's
 * current value so callers apply their own precedence (e.g. dirty overrides base row).
 */
export function evalVisibility(cv: ConditionalVisibility, getValue: (field: string) => unknown): boolean {
  const group = (cv as ConditionalRuleGroup).rules
    ? (cv as ConditionalRuleGroup)
    : { match: 'all' as const, rules: [cv as ConditionalRule] }
  const results = group.rules.map((r) => evalConditionalRule(r, getValue(r.field)))
  return group.match === 'any' ? results.some(Boolean) : results.every(Boolean)
}

export interface SaveBody {
  type?: string
  title: string
  [key: string]: unknown
}

function normalizeForSave(
  fieldValues: Record<string, unknown>,
  fields: FieldDefinition[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fieldValues }
  for (const f of flattenFields(fields)) {
    if (!(f.name in out)) continue
    if (f.fieldType === 'media') {
      const v = out[f.name]
      // GET response expands media to a full object — extract just the ID for PATCH/POST
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[f.name] = (v as Record<string, unknown>).id ?? null
      } else if (v === '') {
        out[f.name] = null   // empty media ref → null, never ''
      }
    } else if (f.fieldType === 'component' || f.fieldType === 'repeater' || f.fieldType === 'json') {
      // These map to JSONB columns. An empty editor yields '' (or undefined),
      // which is INVALID JSON and makes the UPDATE/INSERT fail at the DB. Coerce
      // an empty value to null so an empty block editor / repeater saves cleanly.
      const v = out[f.name]
      if (v === '' || v === undefined) out[f.name] = null
    }
  }
  return out
}

/**
 * Constructs the POST request body for creating a new content object.
 * @param typeName - Content type name (e.g. "article")
 * @param title - Object title
 * @param fieldValues - Map of field name to raw editor value
 * @param fields - Field definitions used to normalize media references before sending
 * @returns A SaveBody ready to POST to the objects API
 */
export function buildCreateBody(
  typeName: string,
  title: string,
  fieldValues: Record<string, unknown>,
  fields: FieldDefinition[] = [],
): SaveBody {
  return { type: typeName, title, ...normalizeForSave(fieldValues, fields) }
}

/**
 * Constructs the PATCH request body for updating an existing content object.
 * @param title - Updated object title
 * @param fieldValues - Map of field name to raw editor value
 * @param fields - Field definitions used to normalize media references before sending
 * @returns A SaveBody ready to PATCH the objects API
 */
export function buildUpdateBody(
  title: string,
  fieldValues: Record<string, unknown>,
  fields: FieldDefinition[] = [],
): SaveBody {
  return { title, ...normalizeForSave(fieldValues, fields) }
}

/**
 * Returns true when the object is already published, so the UI should show a re-publish
 * confirmation warning before overwriting live content.
 * @param currentStatus - The object's current status string (e.g. "published", "draft")
 */
export function needsPublishConfirm(currentStatus: string): boolean {
  return currentStatus === 'published'
}

/**
 * Formats an ISO date string for the editor sidebar (e.g. "Jan 5, 2025").
 * @param iso - ISO 8601 date string
 * @returns Locale-formatted date string
 */
export function formatSidebarDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Formats an ISO datetime string as a combined date-and-time label for the scheduled publish UI
 * (e.g. "Jan 5, 2025 at 2:30 PM").
 * @param iso - ISO 8601 datetime string
 * @returns Locale-formatted date-time string
 */
export function formatScheduledDateTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${date} at ${time}`
}

/**
 * Coarse "time ago" label for audit bylines (e.g. "5 min ago", "3 days ago").
 * @param dateStr - ISO 8601 datetime string
 * @param now - injectable clock (ms since epoch) for deterministic testing
 */
export function relativeTime(dateStr: string, now: number = Date.now()): string {
  const diff = Math.floor((now - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} days ago`
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))} mo ago`
  return `${Math.floor(diff / (86400 * 365))} yr ago`
}

/** Full date-and-time label for byline tooltips (locale-formatted). */
export function fullDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// System columns that must never appear as content fields, even if they leaked
// into an old snapshot before the server-side SYSTEM_COLS list was complete.
export const SYSTEM_FIELD_KEYS = new Set([
  'id', 'workspaceId', 'workspace_id',
  'status', 'title', 'slug', 'type',
  'publishedAt', 'published_at', 'publishedValues', 'published_values',
  'scheduledAt', 'scheduled_at',
  'createdAt', 'created_at', 'updatedAt', 'updated_at',
  'createdBy', 'created_by', 'updatedBy', 'updated_by', 'publishedBy', 'published_by',
  '_has_draft_app_data', '_hasDraftAppData',
])

export interface VersionDiffRow {
  key: string
  label: string
  vVal: unknown
  dVal: unknown
  status: 'changed' | 'added' | 'removed'
}

/**
 * Pure field-level diff between a previewed version's values and the current
 * draft values. Schema fields first (labelled), then orphan keys present in
 * either side (system columns excluded). Only differing rows are returned.
 */
export function computeVersionDiff(
  fields: FieldDefinition[],
  versionValues: Record<string, unknown>,
  draftValues: Record<string, unknown>,
): VersionDiffRow[] {
  const flat = flattenFields(fields)
  const schemaKeys = flat.map((f) => f.name)
  const byName = new Map(flat.map((f) => [f.name, f]))
  const extraKeys = [...new Set([...Object.keys(versionValues), ...Object.keys(draftValues)])]
    .filter((k) => !schemaKeys.includes(k) && !SYSTEM_FIELD_KEYS.has(k))

  const rows: VersionDiffRow[] = []
  for (const key of [...schemaKeys, ...extraKeys]) {
    const vVal = versionValues[key]
    const dVal = draftValues[key]
    if (JSON.stringify(vVal) === JSON.stringify(dVal)) continue // unchanged
    const vEmpty = vVal == null || vVal === ''
    const dEmpty = dVal == null || dVal === ''
    rows.push({
      key,
      label: byName.get(key)?.label ?? key,
      vVal,
      dVal,
      status: vEmpty ? 'added' : dEmpty ? 'removed' : 'changed',
    })
  }
  return rows
}

/**
 * Pure merge of a version snapshot's values over the CURRENT schema (R3).
 * Every current field appears in `merged` (as undefined when the snapshot
 * predates it); snapshot keys override that base. Keys present in the snapshot
 * but absent from the schema (and not system columns) are returned as `orphans`
 * so the editor can flag "removed fields" — null/undefined orphan values are
 * dropped (nothing to show).
 */
export function mergeVersionSnapshot(
  fields: FieldDefinition[] | null,
  snapValues: Record<string, unknown> | undefined,
): { merged: Record<string, unknown>; orphans: Array<{ name: string; value: unknown }> } {
  const snapBase: Record<string, unknown> = {}
  const currentFieldNames = new Set<string>()
  if (fields) {
    for (const f of flattenFields(fields)) {
      snapBase[f.name] = undefined
      currentFieldNames.add(f.name)
    }
  }
  const merged = { ...snapBase, ...(snapValues ?? {}) }
  const orphans = Object.entries(snapValues ?? {})
    .filter(([k, v]) => !currentFieldNames.has(k) && !SYSTEM_FIELD_KEYS.has(k) && v != null)
    .map(([name, value]) => ({ name, value }))
  return { merged, orphans }
}

/**
 * Returns the correct HTML input type for a date field based on whether it includes a time component.
 * @param field - Field definition to inspect
 * @returns "datetime-local" when includeTime is set; "date" otherwise
 */
export function getDateInputType(field: FieldDefinition): 'date' | 'datetime-local' {
  return field.config.includeTime ? 'datetime-local' : 'date'
}

/**
 * Coerces a raw string value from an HTML input to the appropriate JS type for the given field type.
 * @param fieldType - The type of the field (e.g. "number", "select", "text")
 * @param raw - Raw string value from the input element
 * @returns The typed value (number, null, or string)
 */
export function coerceFieldValue(fieldType: FieldTypeRef, raw: string): unknown {
  if (fieldType === 'number') return raw === '' ? null : Number(raw)
  if (fieldType === 'select' || fieldType === 'date') return raw === '' ? null : raw
  return raw
}

/**
 * Converts arbitrary text to a URL-safe slug — lowercased, special characters stripped,
 * spaces and underscores replaced with hyphens, and leading/trailing hyphens trimmed.
 * Output is capped at 96 characters.
 * @param text - Input string to slugify
 * @returns A URL-safe slug string
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validates the title and all field values against their definitions, respecting conditional
 * group visibility so hidden sub-fields are skipped. Also validates required sub-fields inside
 * component blocks and repeater items.
 * @param title - The object title value
 * @param fieldValues - Map of field name to current value
 * @param fields - Top-level field definitions for the content type
 * @returns A map of field names to error messages; empty when all values are valid
 */
export function validateFields(
  title: string,
  fieldValues: Record<string, unknown>,
  fields: FieldDefinition[],
): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!title.trim()) errors.__title = 'Title is required'

  // Collect sub-field names whose parent group is currently hidden — skip validation for these.
  const hiddenByGroup = new Set<string>()
  for (const g of fields) {
    if (g.fieldType !== 'group') continue
    const cv = g.config?.admin?.conditionalVisibility
    if (cv && !evalVisibility(cv, (n) => fieldValues[n])) {
      for (const sf of g.config.groupFields ?? []) hiddenByGroup.add(sf.name)
    }
  }

  for (const f of flattenFields(fields)) {
    if (hiddenByGroup.has(f.name)) continue
    // Hidden-by-condition fields are skipped — mirrors the server rule; the user
    // cannot fill a field the editor doesn't render.
    const fcv = f.config?.admin?.conditionalVisibility
    if (fcv && !evalVisibility(fcv, (n) => fieldValues[n])) continue
    const v = fieldValues[f.name]
    const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0)

    if (f.required && empty) {
      errors[f.name] = `${f.label} is required`
      continue
    }
    if (empty) continue

    switch (f.fieldType) {
      case 'email':
        if (typeof v === 'string' && !EMAIL_RE.test(v.trim())) {
          errors[f.name] = 'Please enter a valid email address'
        }
        break
      case 'url':
        if (typeof v === 'string') {
          try { new URL(v.trim()) } catch { errors[f.name] = 'Please enter a valid URL'; break }
          if (f.config.validation?.httpsOnly && !v.trim().startsWith('https://')) {
            errors[f.name] = 'URL must use HTTPS'
          }
        }
        break
      case 'phone':
        if (typeof v === 'string' && !/^\+?[\d\s\-().]+$/.test(v.trim())) {
          errors[f.name] = 'Please enter a valid phone number'
        }
        break
      case 'number': {
        const vr = f.config.validation ?? {}
        const n = Number(v)
        if (isNaN(n)) { errors[f.name] = `${f.label} must be a number`; break }
        if (vr.min != null && n < vr.min) { errors[f.name] = `${f.label} must be at least ${vr.min}`; break }
        if (vr.max != null && n > vr.max) { errors[f.name] = `${f.label} must be at most ${vr.max}`; break }
        if (vr.integer && !Number.isInteger(n)) { errors[f.name] = `${f.label} must be a whole number`; break }
        if (vr.positiveOnly && n <= 0) { errors[f.name] = `${f.label} must be greater than zero`; break }
        break
      }
      case 'text':
      case 'textarea': {
        const vr = f.config.validation ?? {}
        if (typeof v === 'string') {
          if (vr.minLength != null && v.length < vr.minLength) {
            errors[f.name] = `${f.label} must be at least ${vr.minLength} characters`
          } else if (vr.maxLength != null && v.length > vr.maxLength) {
            errors[f.name] = `${f.label} must be at most ${vr.maxLength} characters`
          } else if (vr.pattern && !new RegExp(vr.pattern).test(v)) {
            errors[f.name] = `${f.label} has an invalid format`
          }
        }
        break
      }
      case 'component': {
        const blocks = Array.isArray(v) ? (v as Record<string, unknown>[]) : []
        const componentDefs: ComponentDef[] = f.config.components ?? []
        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i]
          const def = componentDefs.find(d => d.name === (block._type as string))
          if (!def) continue
          for (const sf of def.fields) {
            if (!sf.required) continue
            const sv = block[sf.name]
            if (sv == null || sv === '' || (Array.isArray(sv) && sv.length === 0)) {
              errors[f.name] = `${def.label} (block ${i + 1}): ${sf.label} is required`
              break
            }
          }
          if (errors[f.name]) break
        }
        break
      }
      case 'repeater': {
        const items = Array.isArray(v) ? (v as Record<string, unknown>[]) : []
        const subFields = f.config.fields ?? []
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          for (const sf of subFields) {
            if (!sf.required) continue
            const sv = item[sf.name]
            if (sv == null || sv === '' || (Array.isArray(sv) && sv.length === 0)) {
              errors[f.name] = `${f.label} (item ${i + 1}): ${sf.label} is required`
              break
            }
          }
          if (errors[f.name]) break
        }
        break
      }
    }
  }

  return errors
}

// Drizzle `.update().returning()` and `.select()` return camelCase column names,
// while raw SQL `RETURNING *` returns snake_case. Normalize to snake_case so the
// editor's ObjectData interface is always consistent regardless of which route responded.
/**
 * Normalizes object data to always use snake_case timestamp keys, merging camelCase variants
 * returned by Drizzle ORM queries with snake_case from raw SQL RETURNING * clauses.
 * @param data - Raw object row from any API response
 * @returns A normalized object with consistent snake_case timestamp keys
 */
/**
 * BL-4 — localized sub-field names of a container field (component/repeater),
 * top container level. Reusable string refs resolve via the registry; media
 * never counts (asset-level localization).
 */
export function containerLocalizedSubNames(
  field: { fieldType?: string; config?: Record<string, unknown> },
  registry: Array<{ name?: string; fields?: Array<Record<string, unknown>> }> = [],
): string[] {
  const out: string[] = []
  const collect = (subs: Array<Record<string, unknown>> | undefined) => {
    for (const sf of subs ?? []) {
      const cfg = (sf.config ?? {}) as Record<string, unknown>
      if (cfg.localized === true && isLocalizableFieldType(sf.fieldType as string) && !out.includes(sf.name as string)) {
        out.push(sf.name as string)
      }
    }
  }
  const cfg = (field.config ?? {}) as Record<string, unknown>
  if (field.fieldType === 'repeater') collect(cfg.fields as never)
  else if (field.fieldType === 'component') {
    for (const ref of (cfg.components ?? []) as Array<string | Record<string, unknown>>) {
      const def = typeof ref === 'string' ? registry.find((c) => c.name === ref) : ref
      if (def) collect((def as { fields?: Array<Record<string, unknown>> }).fields)
    }
  }
  return out
}

/**
 * Whether a container field (component/repeater) holds a translation overlay:
 * true when something localized sits ANYWHERE inside it, looking through
 * nested slots, repeater rows and groups. This is the server's rule
 * (`localizedContainerFields` in @tangen/schema) - a `kit.section` has no
 * localized sub-field of its own, yet the heading three slots down does, so
 * the section's container field carries the overlay column and needs the
 * per-locale inputs. Reusable string refs resolve via the registry; a
 * component that holds its own kind is walked once. Media never counts.
 */
export function containerIsLocalized(
  field: { fieldType?: string; config?: Record<string, unknown> },
  registry: Array<{ name?: string; fields?: Array<Record<string, unknown>> }> = [],
): boolean {
  type Sub = Record<string, unknown>
  const subsLocalized = (subs: Sub[] | undefined, seen: Set<string>): boolean => {
    for (const sf of subs ?? []) {
      const cfg = (sf.config ?? {}) as Record<string, unknown>
      const ft = sf.fieldType as string
      if (ft === 'component') { if (refsLocalized(cfg.components as Array<string | Sub> | undefined, seen)) return true }
      else if (ft === 'repeater') { if (subsLocalized(cfg.fields as Sub[] | undefined, seen)) return true }
      else if (ft === 'group') { if (subsLocalized(cfg.groupFields as Sub[] | undefined, seen)) return true }
      else if (cfg.localized === true && isLocalizableFieldType(ft)) return true
    }
    return false
  }
  const refsLocalized = (refs: Array<string | Sub> | undefined, seen: Set<string>): boolean => {
    for (const ref of refs ?? []) {
      const def = typeof ref === 'string' ? registry.find((c) => c.name === ref) : ref
      if (!def) continue
      const name = (def as { name?: string }).name
      if (typeof name === 'string') {
        if (seen.has(name)) continue
        seen.add(name)
      }
      if (subsLocalized((def as { fields?: Sub[] }).fields, seen)) return true
    }
    return false
  }
  const cfg = (field.config ?? {}) as Record<string, unknown>
  if (field.fieldType === 'component') return refsLocalized(cfg.components as Array<string | Sub> | undefined, new Set())
  if (field.fieldType === 'repeater') return subsLocalized(cfg.fields as Sub[] | undefined, new Set())
  return false
}

const isOverlayMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** A richtext value is a document, not a nested overlay map. */
const isRichDoc = (v: Record<string, unknown>): boolean => typeof v.type === 'string'

const isBlankLeaf = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '')

/**
 * One container overlay with its blank leaves and the empty maps they leave
 * behind removed, at EVERY depth (a nested slot's map, a nested repeater's
 * rows). Undefined when nothing survives. Mirrors Studio's
 * `pruneOverlayForSave`, so both editors send the server the same thing.
 */
function pruneOverlayMap(value: unknown): Record<string, unknown> | undefined {
  if (!isOverlayMap(value)) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (isBlankLeaf(v)) continue
    if (isOverlayMap(v) && !isRichDoc(v)) {
      const inner = pruneOverlayMap(v)
      if (inner && Object.keys(inner).length > 0) out[k] = inner
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * Pure PATCH payload for one locale's inline translation draft (R5).
 * Title is sent only when non-blank; localized fields coerce '' → null (clear);
 * BL-4 container overlays drop blank sub-values at every depth, drop the rows
 * and nested maps left empty, and send null when nothing remains (clears the
 * overlay server-side).
 */
export function buildLocaleSavePayload(
  draft: Record<string, unknown>,
  localizedFields: Array<{ name: string }>,
  localizedContainers: string[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (typeof draft.title === 'string' && draft.title.trim()) payload.title = draft.title
  for (const f of localizedFields) {
    const v = draft[f.name]
    payload[f.name] = v === '' ? null : v ?? null
  }
  // BL-4: container overlays - drop blank sub-values at every depth; an empty
  // overlay clears. A row entry that is not a map is dropped, as before.
  for (const name of localizedContainers) {
    const raw = draft[name]
    if (!isOverlayMap(raw)) continue
    const cleaned: Record<string, unknown> = {}
    for (const [k, entry] of Object.entries(raw)) {
      if (!isOverlayMap(entry)) continue
      const subs = pruneOverlayMap(entry)
      if (subs && Object.keys(subs).length > 0) cleaned[k] = subs
    }
    payload[name] = Object.keys(cleaned).length > 0 ? cleaned : null
  }
  return payload
}

/** Threading for per-locale inputs inside block cards / repeater rows. */
export interface BlockLocaleCtx {
  locales: Array<{ code: string; label: string; railClass: string; badgeClass: string }>
  /** The locale's overlay draft for THIS container field: { [_key]: { [sub]: value } }. */
  getOverlay: (code: string) => Record<string, Record<string, unknown>>
  setSub: (code: string, rowKey: string, sub: string, value: unknown) => void
  /**
   * Writes one value at a nested path under this container
   * (`[rowKey, sub, rowKey, sub, ...]`), so a scoped ctx deep inside a
   * section can land a translation without re-reading the draft. Optional:
   * `nestedLocaleCtx` falls back to a read-merge-write through `setSub`.
   */
  setPath?: (code: string, path: string[], value: unknown) => void
}

/**
 * A new overlay map with one value written at a nested path; every map on
 * the way is copied, never mutated, and anything that is not a map there is
 * treated as empty. `setOverlayPath(o, ['sec', 'children', 'h', 'text'], v)`
 * is the nested-block address docs/localization.md describes.
 */
export function setOverlayPath(map: unknown, path: string[], value: unknown): Record<string, unknown> {
  const base = isOverlayMap(map) ? map : {}
  if (path.length === 0) return base
  const [head, ...rest] = path
  if (rest.length === 0) return { ...base, [head]: value }
  return { ...base, [head]: setOverlayPath(base[head], rest, value) }
}

/**
 * The ctx a NESTED container editor receives: the parent's locales, reading
 * and writing the map under `overlay[rowKey][sub]`. Composes at any depth
 * (a section's children, a container inside it, a row column, a button row
 * inside that), so a kit heading four boxes deep edits per locale exactly
 * like a top-level block, and the draft lands in the same nested shape the
 * server validates and Studio's canvas reads.
 */
export function nestedLocaleCtx(ctx: BlockLocaleCtx, rowKey: string, sub: string): BlockLocaleCtx {
  const read = (code: string): Record<string, Record<string, unknown>> => {
    const slot = ctx.getOverlay(code)?.[rowKey]?.[sub]
    return isOverlayMap(slot) ? (slot as Record<string, Record<string, unknown>>) : {}
  }
  const setPath = ctx.setPath
    ? (code: string, path: string[], value: unknown) => ctx.setPath!(code, [rowKey, sub, ...path], value)
    : undefined
  return {
    locales: ctx.locales,
    getOverlay: read,
    setSub: (code, k, s, value) => {
      if (setPath) { setPath(code, [k, s], value); return }
      ctx.setSub(code, rowKey, sub, setOverlayPath(read(code), [k, s], value))
    },
    setPath,
  }
}

export function normalizeObjectData(data: Record<string, unknown>): Record<string, unknown> {
  return {
    ...data,
    scheduled_at:     data.scheduled_at     ?? data.scheduledAt     ?? null,
    published_at:     data.published_at     ?? data.publishedAt     ?? null,
    updated_at:       data.updated_at       ?? data.updatedAt       ?? null,
    created_at:       data.created_at       ?? data.createdAt       ?? null,
    published_values: data.published_values ?? data.publishedValues ?? null,
    created_by:       data.created_by       ?? data.createdBy       ?? null,
    updated_by:       data.updated_by       ?? data.updatedBy       ?? null,
    published_by:     data.published_by     ?? data.publishedBy     ?? null,
  }
}

/**
 * Extracts only the field values relevant to the given field definitions from a raw object row.
 * @param row - Full object data row as returned by the API
 * @param fields - Field definitions whose names determine which keys to keep
 * @returns A filtered object containing only the keys matching defined field names
 */
export function extractFieldValues(
  row: Record<string, unknown>,
  fields: FieldDefinition[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const f of flattenFields(fields)) {
    if (f.name in row) result[f.name] = row[f.name]
  }
  return result
}
