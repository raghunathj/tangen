/**
 * File Name: field-validator.ts
 * Purpose: Validates individual field values and full field-value maps against schema-driven
 *   validation rules, supporting both draft and publish modes across all Tangen field types.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types (FieldDefinition, FieldValidation, ComponentDef, ConditionalRule).
 */
import { isContentDoc, contentDocText, evalFieldWarning, parseNumrange, formatNumrange } from '@tangen/types'
import { validateContentDoc, type ContentDocResult } from '@tangen/schema'
import { DEFAULT_LINK_SCHEMES, DENIED_LINK_SCHEMES, LINK_LABEL_MAX, externalUrlIssue, pathLinkIssue, isLinkValue } from '@tangen/types'
import type { ContentDocVocabulary,
  FieldDefinition, FieldValidation, ComponentDef, ConditionalRule, ConditionalRuleGroup,
  ConditionalVisibility, ObjectTypeDefinition, FieldType, FieldTypeServerValidate,
} from '@tangen/types'
import { flattenFields, subFieldVisibility } from '@tangen/types'

export type ValidationMode = 'draft' | 'publish'

/**
 * Resolves a custom (extension-contributed) field type name to the built-in
 * primitive it inherits + its authoritative server validator. Returns undefined
 * for built-in types and unknown names. Injected at startup from the extension
 * registry (see app-hooks-registry); tests pass a hermetic resolver directly.
 */
export interface CustomFieldTypeResolver {
  (name: string): { inherits: FieldType; validate?: FieldTypeServerValidate } | undefined
  /**
   * The workspace this resolver was built for, when it was built for one.
   *
   * It is the scope every other extension-aware check in a validation pass
   * needs, and it travels here rather than as a seventh positional parameter
   * threaded through every call site and every recursive descent. Today the
   * richtext vocabulary reads it: an element a workspace's active extensions
   * declared is accepted there, and nowhere else.
   */
  workspaceId?: string
}

let _defaultResolver: CustomFieldTypeResolver = () => undefined

/**
 * How a workspace's richtext vocabulary is looked up.
 *
 * A SETTER rather than an import, because `app-hooks-registry` already
 * imports this module to wire the resolver below - importing it back made the
 * cycle that left `_defaultResolver` uninitialised and took the release suite
 * down with it. The dependency stays one-directional and the registry wires
 * this at its own load, beside `setCustomFieldTypeResolver`.
 */
let _vocabularyFor: ((scope?: { workspaceId: string }) => ContentDocVocabulary) | null = null

/** Wires the workspace-aware richtext vocabulary (called once at load). */
export function setRichtextVocabularyResolver(
  fn: ((scope?: { workspaceId: string }) => ContentDocVocabulary) | null,
): void {
  _vocabularyFor = fn
}

/** Wires the process-wide custom field type resolver (called once at startup). */
export function setCustomFieldTypeResolver(resolver: CustomFieldTypeResolver): void {
  _defaultResolver = resolver
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * How deep sub-field validation recurses. Nesting is bounded by the schema, so
 * this is insurance against a cyclic component graph (a def holding itself as
 * an object ref) rather than a product limit; real schemas nest two or three
 * levels.
 */
const MAX_SUBFIELD_DEPTH = 10

/**
 * A raw sub-field as a field definition, so a row's value goes through the
 * SAME validator a top-level value does. `config` and `required` are the only
 * keys a SubField may omit.
 */
function asFieldDef(sf: { name: string; label: string; fieldType: string; config?: unknown; required?: boolean }): FieldDefinition {
  return { ...sf, config: sf.config ?? {}, required: sf.required ?? false } as unknown as FieldDefinition
}

function isEmpty(value: unknown): boolean {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0)
}

/**
 * A richtext document with nothing in it.
 *
 * `{ type: 'doc', content: [] }` is not `isEmpty` - it is an object - so a
 * `required` richtext field used to be satisfied by the empty document the
 * editor creates before anyone types. A document counts as having content if
 * it has text, or any node that IS content without text (an image, a rule).
 */
function isBlankDocument(value: unknown): boolean {
  if (!isContentDoc(value)) return false
  if (contentDocText(value).trim() !== '') return false
  // An image-only or rule-only document is content, even with no words in it.
  return !hasNonTextNode(value as { content?: unknown })
}

const CONTENT_WITHOUT_TEXT = new Set(['image', 'horizontalRule'])

function hasNonTextNode(node: { type?: unknown; content?: unknown }): boolean {
  if (typeof node.type === 'string' && CONTENT_WITHOUT_TEXT.has(node.type)) return true
  return Array.isArray(node.content) && node.content.some((c) => hasNonTextNode(c as { content?: unknown }))
}

function getEmailDomain(email: string): string {
  return (email.split('@')[1] ?? '').toLowerCase()
}

// Returns custom message if set, otherwise the generated default.
function msg(custom: string | undefined, generated: string): string {
  return custom ?? generated
}

/**
 * Validates a single field value against its schema-defined validation rules.
 * In 'draft' mode, required checks are skipped; 'publish' mode enforces all rules.
 * @param field - The field definition containing type and validation config.
 * @param value - The raw value to validate.
 * @param mode - Validation strictness — 'draft' (lenient) or 'publish' (strict).
 * @returns An error message string, or null when the value is valid.
 */
export function validateFieldValue(
  field: FieldDefinition,
  value: unknown,
  mode: ValidationMode = 'draft',
  resolve: CustomFieldTypeResolver = _defaultResolver,
  entryValues?: Record<string, unknown>,
  depth = 0,
): string | null {
  const vr: FieldValidation = field.config.validation ?? {}
  const m = vr.messages ?? {}
  const label = field.label

  if (isEmpty(value)) {
    if (field.required && mode === 'publish') return msg(m.required, `${label} is required`)
    return null
  }

  // A blank richtext document fails `required` - but it is still SHAPE
  // CHECKED below, so a document that is both empty and malformed is refused
  // for the malformation rather than waved through as "empty".
  if (field.fieldType === 'richtext' && field.required && mode === 'publish' && isBlankDocument(value)) {
    return msg(m.required, `${label} is required`)
  }

  // Custom (extension) field type: validate against the inherited primitive
  // first, then run the extension's authoritative validator. Value is non-empty
  // here (the guard above returned for empty values).
  const custom = resolve(field.fieldType)
  if (custom) {
    const baseErr = validateFieldValue({ ...field, fieldType: custom.inherits }, value, mode, resolve)
    if (baseErr) return baseErr
    return custom.validate?.(value, { field, mode }) ?? null
  }

  switch (field.fieldType) {
    case 'text': {
      const v = String(value)
      if (vr.minLength != null && v.length < vr.minLength) return msg(m.minLength, `${label} must be at least ${vr.minLength} characters`)
      if (vr.maxLength != null && v.length > vr.maxLength) return msg(m.maxLength, `${label} must be at most ${vr.maxLength} characters`)
      if (vr.pattern && !new RegExp(vr.pattern).test(v)) return msg(m.pattern, `${label} has an invalid format`)
      break
    }

    case 'range': {
      const r = parseNumrange(value)
      if (!r) return msg(m.pattern, `${label} must be a { min, max } pair`)
      if (r.min > r.max) return msg(m.pattern, `${label}: min must be ≤ max`)
      if (vr.min != null && r.min < vr.min) return msg(m.min, `${label}: minimum allowed is ${vr.min}`)
      if (vr.max != null && r.max > vr.max) return msg(m.max, `${label}: maximum allowed is ${vr.max}`)
      break
    }

    case 'slug': {
      const v = String(value).trim()
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) {
        return msg(m.pattern, `${label} must be a kebab-case slug (lowercase letters, digits, dashes)`)
      }
      if (vr.minLength != null && v.length < vr.minLength) return msg(m.minLength, `${label} must be at least ${vr.minLength} characters`)
      if (vr.maxLength != null && v.length > vr.maxLength) return msg(m.maxLength, `${label} must be at most ${vr.maxLength} characters`)
      break
    }

    case 'email': {
      const v = String(value).trim()
      if (!EMAIL_RE.test(v)) return msg(m.pattern, `${label} must be a valid email address`)
      const domain = getEmailDomain(v)
      if (vr.allowedDomains?.length && !vr.allowedDomains.some(d => d.toLowerCase() === domain)) {
        return msg(m.allowedDomains, `${label}: @${domain} is not an allowed domain`)
      }
      if (vr.blockedDomains?.length && vr.blockedDomains.some(d => d.toLowerCase() === domain)) {
        return msg(m.blockedDomains, `${label}: @${domain} is not permitted`)
      }
      if (vr.minLength != null && v.length < vr.minLength) return msg(m.minLength, `${label} must be at least ${vr.minLength} characters`)
      if (vr.maxLength != null && v.length > vr.maxLength) return msg(m.maxLength, `${label} must be at most ${vr.maxLength} characters`)
      break
    }

    case 'url': {
      const v = String(value).trim()
      let parsed: URL
      try { parsed = new URL(v) } catch { return msg(m.pattern, `${label} must be a valid URL`) }
      // The same floor the link field has (2026-10-14). A `url` is rendered as
      // an href by every consumer, and this field has no scheme policy of its
      // own, so without this ANY writer could store `javascript:` in one. Not
      // overridable by `messages`, for the reason the link branch gives.
      const urlScheme = parsed.protocol.replace(/:$/, '').toLowerCase()
      if ((DENIED_LINK_SCHEMES as readonly string[]).includes(urlScheme)) {
        return `${label}: the ${urlScheme} scheme cannot be a URL`
      }
      if (vr.httpsOnly && parsed.protocol !== 'https:') return msg(m.httpsOnly, `${label} must use HTTPS`)
      if (vr.allowedDomains?.length) {
        const host = parsed.hostname.toLowerCase()
        const allowed = vr.allowedDomains.some(d => {
          const dn = d.toLowerCase()
          return host === dn || host.endsWith('.' + dn)
        })
        if (!allowed) return msg(m.allowedDomains, `${label}: domain ${parsed.hostname} is not allowed`)
      }
      break
    }

    // The document shape, against the declared vocabulary. There was no case
    // here at all: a richtext value fell through the switch and returned null,
    // so any shape reached its jsonb column and failed later, in a
    // serializer, as an empty string.
    //
    // It VALIDATES and never normalizes - `object-snapshot` fingerprints the
    // whole field value, so reshaping on write would make every stored object
    // read as edited.
    case 'richtext': {
      // Scoped when the caller gave a scope: an element a workspace's ACTIVE
      // extensions declared is part of its vocabulary, and a disabled
      // extension's element is refused like any unknown node.
      const scope = resolve.workspaceId ? { workspaceId: resolve.workspaceId } : undefined
      const res = validateContentDoc(value, _vocabularyFor?.(scope) ?? undefined)
      if (!res.ok) return msg(m.pattern, richtextMessage(label, res))
      break
    }

    case 'link': {
      const v = value as Record<string, unknown>
      if (!isLinkValue(v)) {
        return msg(m.pattern, `${label} must be a link to content (internal), a URL (external), or a path on this site (path)`)
      }
      const cfg = field.config as {
        allowedKinds?: string[]; allowedTargets?: string[]; anchor?: boolean; query?: boolean; withLabel?: boolean; newTab?: boolean
      }
      const kinds = cfg.allowedKinds?.length ? cfg.allowedKinds : null
      if (kinds && !kinds.includes(v.type as string)) {
        return msg(m.pattern, `${label} does not accept ${v.type} links`)
      }
      if (v.newTab != null && typeof v.newTab !== 'boolean') return msg(m.pattern, `${label}: newTab must be true or false`)
      // The link's text (a call to action) travels with the destination when the field offers it.
      if (v.label != null && v.label !== '') {
        if (typeof v.label !== 'string') return msg(m.pattern, `${label}: the link text must be a string`)
        if (cfg.withLabel !== true) return msg(m.pattern, `${label} does not accept a text (set config.withLabel to offer one)`)
        if (v.label.trim().length > LINK_LABEL_MAX) return msg(m.pattern, `${label}: the link text is longer than ${LINK_LABEL_MAX} characters`)
      }
      if (cfg.anchor === false && v.anchor != null && v.anchor !== '') {
        return msg(m.pattern, `${label} does not accept an anchor`)
      }
      if (v.query != null) {
        if (cfg.query === false) return msg(m.pattern, `${label} does not accept query parameters`)
        const q = v.query
        if (!q || typeof q !== 'object' || Array.isArray(q)) {
          return msg(m.pattern, `${label}: query must be an object of name/value pairs`)
        }
        for (const [k, qv] of Object.entries(q as Record<string, unknown>)) {
          if (qv !== null && typeof qv === 'object') {
            return msg(m.pattern, `${label}: query value "${k}" must be a single value, not a structure`)
          }
        }
      }
      if (v.type === 'internal') {
        // Identity is the whole destination: a target with no type or no id is
        // not a link, it is a fragment of one.
        const t = v.target as { type?: unknown; id?: unknown } | undefined
        const tType = typeof t?.type === 'string' ? t.type.trim() : ''
        const tId = typeof t?.id === 'string' ? t.id.trim() : ''
        if (!tType || !tId) return msg(m.pattern, `${label} needs a target content type and id`)
        const allowed = cfg.allowedTargets?.length ? cfg.allowedTargets : null
        if (allowed && !allowed.includes(tType)) {
          return msg(m.pattern, `${label} cannot link to ${tType} (allowed: ${allowed.join(', ')})`)
        }
        break
      }
      if (v.type === 'path') {
        // A path is the application's own routing: stored verbatim, handed back
        // untouched, nothing for Tangen to resolve. The only question is
        // whether it is a path at all.
        const issue = pathLinkIssue(v.path)
        if (issue?.reason === 'absolute') {
          return msg(m.pattern, issue.scheme
            ? `${label} is a path on this site, not a ${issue.scheme} URL; use an external link for that`
            : `${label} must be a path on this site like /about, not one beginning //`)
        }
        if (issue) return msg(m.pattern, `${label} must be a path on this site, like /about`)
        break
      }
      // External: the URL is the destination, so the scheme policy is the
      // security boundary. `httpsOnly` narrows the list rather than competing
      // with it, so the url field's rule means the same thing here.
      const schemes = vr.httpsOnly ? ['https'] : (vr.allowedSchemes?.length ? vr.allowedSchemes : [...DEFAULT_LINK_SCHEMES])
      const issue = externalUrlIssue(v.url, schemes)
      if (issue?.reason === 'relative') {
        // Before the `path` kind existed this said "use an internal link",
        // which was wrong advice whenever the path was not a content object:
        // a hand-built route has nothing to pick. It names both branches now.
        return msg(m.pattern, `${label} must be an absolute URL; use a path link for a route on this site, or an internal link for content in this workspace`)
      }
      // Not overridable by `messages`, and the wording says why rather than
      // which list refused it: listing the scheme in `allowedSchemes` is
      // exactly what someone reading "not allowed" would try next.
      if (issue?.reason === 'unsafe') {
        return `${label}: the ${issue.scheme} scheme cannot be a link destination`
      }
      if (issue?.reason === 'scheme') {
        if (vr.httpsOnly) return msg(m.httpsOnly, `${label} must use HTTPS`)
        return msg(m.allowedSchemes, `${label}: the ${issue.scheme} scheme is not allowed`)
      }
      if (issue) return msg(m.pattern, `${label} must be a valid URL`)
      if (vr.allowedDomains?.length) {
        let host = ''
        try { host = new URL(String(v.url).trim()).hostname.toLowerCase() } catch { host = '' }
        const ok = host !== '' && vr.allowedDomains.some((d) => {
          const dn = d.toLowerCase()
          return host === dn || host.endsWith('.' + dn)
        })
        if (!ok) return msg(m.allowedDomains, `${label}: domain ${host || String(v.url)} is not allowed`)
      }
      break
    }

    case 'phone': {
      const v = String(value).trim()
      if (!/^\+?[\d\s\-().]+$/.test(v)) return msg(m.pattern, `${label} must be a valid phone number`)
      const digits = v.replace(/\D/g, '')
      if (vr.minLength != null && digits.length < vr.minLength) return msg(m.minLength, `${label} must have at least ${vr.minLength} digits`)
      if (vr.maxLength != null && digits.length > vr.maxLength) return msg(m.maxLength, `${label} must have at most ${vr.maxLength} digits`)
      if (vr.e164 && !/^\+\d{7,15}$/.test(v.replace(/\s/g, ''))) {
        return msg(m.e164, `${label} must be in E.164 format (e.g. +14155552671)`)
      }
      break
    }

    case 'textarea': {
      const v = String(value)
      if (vr.minLength != null && v.length < vr.minLength) return msg(m.minLength, `${label} must be at least ${vr.minLength} characters`)
      if (vr.maxLength != null && v.length > vr.maxLength) return msg(m.maxLength, `${label} must be at most ${vr.maxLength} characters`)
      break
    }

    case 'number':
    case 'currency': {
      const v = Number(value)
      if (isNaN(v)) return msg(m.pattern, `${label} must be a number`)
      if (vr.min != null && v < vr.min) return msg(m.min, `${label} must be at least ${vr.min}`)
      if (vr.max != null && v > vr.max) return msg(m.max, `${label} must be at most ${vr.max}`)
      if (vr.integer && !Number.isInteger(v)) return msg(m.integer, `${label} must be a whole number`)
      if (vr.positiveOnly && v <= 0) return msg(m.positiveOnly, `${label} must be greater than zero`)
      if (vr.step != null && vr.step !== 0) {
        const remainder = Math.abs((v / vr.step) % 1)
        if (remainder > 1e-9 && (1 - remainder) > 1e-9) {
          return msg(m.step, `${label} must be a multiple of ${vr.step}`)
        }
      }
      break
    }

    case 'boolean': {
      if (vr.requiredAcknowledgement && value !== true) {
        return msg(m.requiredAcknowledgement, `${label} must be acknowledged`)
      }
      break
    }

    case 'date': {
      const v = String(value).slice(0, 10)
      if (vr.minDate && v < vr.minDate) return msg(m.minDate, `${label} must be on or after ${vr.minDate}`)
      if (vr.maxDate && v > vr.maxDate) return msg(m.maxDate, `${label} must be on or before ${vr.maxDate}`)
      if (vr.pastOnly) {
        const today = new Date().toISOString().slice(0, 10)
        if (v >= today) return msg(m.pastOnly, `${label} must be a past date`)
      }
      if (vr.futureOnly) {
        const today = new Date().toISOString().slice(0, 10)
        if (v <= today) return msg(m.futureOnly, `${label} must be a future date`)
      }
      break
    }

    case 'multiselect':
    case 'tags': {
      if (Array.isArray(value)) {
        const n = value.length
        if (vr.minSelections != null && n < vr.minSelections) {
          return msg(m.minSelections, `${label} requires at least ${vr.minSelections} selection${vr.minSelections !== 1 ? 's' : ''}`)
        }
        if (vr.maxSelections != null && n > vr.maxSelections) {
          return msg(m.maxSelections, `${label} allows at most ${vr.maxSelections} selection${vr.maxSelections !== 1 ? 's' : ''}`)
        }
      }
      break
    }

    case 'color': {
      const v = String(value)
      const hex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
      const rgb = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/
      if (!hex.test(v) && !rgb.test(v)) {
        return msg(m.pattern, `${label} must be a hex color (#RGB, #RRGGBB, #RRGGBBAA) or rgb()/rgba()`)
      }
      break
    }

    case 'time': {
      const v = String(value)
      if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v)) {
        return msg(m.pattern, `${label} must be a time in HH:MM or HH:MM:SS format`)
      }
      break
    }

    case 'geopoint': {
      const p = value as { lat?: unknown; lng?: unknown } | null
      const lat = Number(p && typeof p === 'object' ? p.lat : NaN)
      const lng = Number(p && typeof p === 'object' ? p.lng : NaN)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return msg(m.pattern, `${label} must be a point with numeric lat and lng`)
      }
      if (lat < -90 || lat > 90) return msg(m.min, `${label} latitude must be between -90 and 90`)
      if (lng < -180 || lng > 180) return msg(m.max, `${label} longitude must be between -180 and 180`)
      break
    }

    case 'rating': {
      const v = Number(value)
      const scale = (field.config as { max?: number }).max ?? 5
      if (!Number.isInteger(v)) return msg(m.integer, `${label} must be a whole number`)
      if (v < 0 || v > scale) return msg(m.max, `${label} must be between 0 and ${scale}`)
      break
    }

    case 'code': {
      const v = String(value)
      if (vr.maxLength != null && v.length > vr.maxLength) {
        return msg(m.maxLength, `${label} must be at most ${vr.maxLength} characters`)
      }
      if (vr.minLength != null && v.length < vr.minLength) {
        return msg(m.minLength, `${label} must be at least ${vr.minLength} characters`)
      }
      break
    }

    case 'repeater': {
      if (Array.isArray(value)) {
        const n = value.length
        if (vr.minRows != null && n < vr.minRows) {
          return msg(m.minRows, `${label} requires at least ${vr.minRows} row${vr.minRows !== 1 ? 's' : ''}`)
        }
        if (vr.maxRows != null && n > vr.maxRows) {
          return msg(m.maxRows, `${label} allows at most ${vr.maxRows} row${vr.maxRows !== 1 ? 's' : ''}`)
        }
        // Every row is validated through this same function, in BOTH modes.
        // It used to check required-ness on publish and nothing else, so a
        // value of the wrong TYPE was stored silently - a bare string in a
        // `link` sub-field being the one that cost real data, since the link
        // editor reads a string back as null. Type-correctness has to hold in
        // a draft too, because the draft is what reaches the column;
        // required-ness stays publish-only, which falls out of the empty guard
        // at the top of this function rather than being repeated here.
        const subFields = field.config.fields ?? []
        if (depth < MAX_SUBFIELD_DEPTH) {
          for (let i = 0; i < n; i++) {
            const item = (value as Record<string, unknown>[])[i]
            if (!item || typeof item !== 'object') continue
            for (const sf of subFields) {
              // A sub-field its own rule hides cannot be filled, so requiring
              // it would make publishing impossible - the same reasoning
              // validateFieldValues applies to a top-level field. The rule is
              // read through `subFieldVisibility` because a declaration may
              // carry it at either level (see its doc comment); reading one
              // place here and the other in the editor is what made a hidden
              // sub-field unpublishable.
              const scv = subFieldVisibility(sf)
              if (scv && !evalVisibility(scv, (fn) => item[fn])) continue
              const err = validateFieldValue(asFieldDef(sf), item[sf.name], mode, resolve, item, depth + 1)
              if (err) return `${label} (row ${i + 1}): ${err}`
            }
          }
        }
      }
      break
    }

    case 'component': {
      if (Array.isArray(value)) {
        const n = value.length
        if (vr.minComponents != null && n < vr.minComponents) {
          return msg(m.minComponents, `${label} requires at least ${vr.minComponents} component${vr.minComponents !== 1 ? 's' : ''}`)
        }
        if (vr.maxComponents != null && n > vr.maxComponents) {
          return msg(m.maxComponents, `${label} allows at most ${vr.maxComponents} component${vr.maxComponents !== 1 ? 's' : ''}`)
        }
        if (vr.allowedComponents?.length) {
          for (const block of value as Record<string, unknown>[]) {
            // `_type` first: that is what the admin's block editor writes
            // (component-block-editor.tsx reads `b._type` throughout) and
            // nothing in the platform ever writes `_component`, so reading
            // only the latter made this guard `undefined && ...` on every
            // real block. `_component` stays accepted as a second spelling
            // because publish-cascade reads it too.
            const btype = (block._type ?? block._component) as string | undefined
            if (btype && !vr.allowedComponents.includes(btype)) {
              return msg(m.allowedComponents, `${label}: component type "${btype}" is not allowed here`)
            }
          }
        }
        const componentDefs: ComponentDef[] = field.config.components ?? []
        if (depth < MAX_SUBFIELD_DEPTH) {
          for (let i = 0; i < n; i++) {
            const block = (value as Record<string, unknown>[])[i]
            // Eye-hidden blocks are stripped from published output — never validated.
            if (block._disabled) continue
            const blockType = block._type as string
            const def = componentDefs.find(d => d.name === blockType)
            if (!def) continue
            // Blocks hidden by def-level visibility rules can't be filled in the editor.
            const bcv = (def as { conditionalVisibility?: ConditionalVisibility }).conditionalVisibility
            if (bcv && entryValues && !evalVisibility(bcv, (fn) => entryValues[fn])) continue
            const blockLabel = typeof block._label === 'string' && block._label
              ? `${def.label} (block ${i + 1} - "${block._label}")`
              : `${def.label} (block ${i + 1})`
            for (const sf of def.fields) {
              // Same rule, same reader as a repeater row: a sub-field the
              // block's own values hide is not validated, because the editor
              // does not draw it.
              const scv = subFieldVisibility(sf)
              if (scv && !evalVisibility(scv, (fn) => block[fn])) continue
              const err = validateFieldValue(asFieldDef(sf), block[sf.name], mode, resolve, block, depth + 1)
              if (err) return `${blockLabel}: ${err}`
            }
          }
        }
      }
      break
    }
  }

  return null
}

function evalCv(cv: ConditionalRule, val: unknown): boolean {
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
 * Evaluates a visibility condition — a single {@link ConditionalRule} (back-compat)
 * or a {@link ConditionalRuleGroup} (all/any). `getValue` resolves each referenced
 * field's current value (callers apply their own precedence, e.g. dirty overrides).
 */
export function evalVisibility(cv: ConditionalVisibility, getValue: (field: string) => unknown): boolean {
  const group = (cv as ConditionalRuleGroup).rules
    ? (cv as ConditionalRuleGroup)
    : { match: 'all' as const, rules: [cv as ConditionalRule] }
  const results = group.rules.map((r) => evalCv(r, getValue(r.field)))
  return group.match === 'any' ? results.some(Boolean) : results.every(Boolean)
}

/**
 * Validates all field values in a record, respecting conditional group visibility rules.
 * Fields hidden by a conditional group are excluded from validation entirely.
 * @param fields - The schema field definitions to validate against.
 * @param values - A map of field names to their current values.
 * @param mode - Validation strictness — 'draft' or 'publish'.
 * @returns A map of field names to error messages; empty object when all fields are valid.
 */
export function validateFieldValues(
  fields: FieldDefinition[],
  values: Record<string, unknown>,
  mode: ValidationMode = 'draft',
  resolve: CustomFieldTypeResolver = _defaultResolver,
): Record<string, string> {
  // Sub-fields of a conditionally-hidden group are not submitted — skip their validation.
  const hiddenByGroup = new Set<string>()
  for (const f of fields) {
    if (f.fieldType !== 'group') continue
    const cv = f.config?.admin?.conditionalVisibility as ConditionalVisibility | undefined
    if (cv && !evalVisibility(cv, (n) => values[n])) {
      for (const sf of (f.config.groupFields ?? []) as FieldDefinition[]) hiddenByGroup.add(sf.name)
    }
  }

  // Many-relation pg literals ('{}' / '{id}') become real arrays before any
  // required/empty check — a stored-empty '{}' must fail `required`.
  values = normalizeManyRelationReads([values], fields)[0]

  const errors: Record<string, string> = {}
  for (const field of fields) {
    if (field.fieldType === 'group') continue
    // Soft-disabled fields are hidden from every surface — never validate them
    // (a disabled required field must not block publishing).
    if (field.disabled) continue
    if (hiddenByGroup.has(field.name)) continue
    // A field hidden by its own visibility rule can't be filled in the editor —
    // requiring it would make publishing impossible (e.g. a rule referencing a
    // renamed/deleted field hides the field forever).
    const fcv = field.config?.admin?.conditionalVisibility as ConditionalVisibility | undefined
    if (fcv && !evalVisibility(fcv, (n) => values[n])) continue
    const err = validateFieldValue(field, values[field.name], mode, resolve, values)
    if (err) errors[field.name] = err
  }
  return errors
}

/**
 * The single gate every publish path must clear: a non-empty title and all
 * publish-mode field rules (required, format) against the full record. Returns
 * the first error message, or null when the record may be published. `record`
 * keys are field names (drizzle rows already use field names as columns).
 *
 * Used by the publish route, bulk-update, create-as-published, schedule, and
 * the scheduled auto-publish worker so required fields cannot be bypassed by
 * publishing through a side door.
 */
export function publishValidationError(
  typeDef: { fields: FieldDefinition[] } | undefined | null,
  record: Record<string, unknown>,
  resolve: CustomFieldTypeResolver = _defaultResolver,
): string | null {
  if (!typeDef) return null
  if (!record.title || String(record.title).trim() === '') return 'Title is required'
  const fieldErrors = validateFieldValues(typeDef.fields, record, 'publish', resolve)
  const first = Object.values(fieldErrors)[0]
  return (first as string | undefined) ?? null
}

/**
 * Converts date-type field values from ISO strings (how JSON transport
 * delivers them — admin saves, SDK calls, and AI applies alike) into Date
 * objects, which drizzle timestamp columns require on insert. Date objects
 * and null pass through; unparseable strings become null rather than
 * crashing the write.
 */
export function normalizeDateFieldValues(
  typeDef: Pick<ObjectTypeDefinition, 'fields'>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const dateFields = new Set(
    flattenFields(typeDef.fields).filter(f => f.fieldType === 'date').map(f => f.name),
  )
  if (dateFields.size === 0) return values
  const out: Record<string, unknown> = { ...values }
  for (const name of dateFields) {
    const v = out[name]
    if (typeof v === 'string') {
      const d = new Date(v)
      out[name] = Number.isNaN(d.getTime()) ? null : d
    }
  }
  return out
}

/**
 * B1 — whether a field's value must be unique per type. Slug fields are identifiers, so
 * they are unique BY DEFAULT (opt out with validation.unique: false); every other type
 * stays opt-in. Both the create and update routes use this one predicate.
 */
export function isUniqueField(field: { fieldType: string; config: { validation?: { unique?: boolean } } }): boolean {
  if (field.fieldType === 'slug') return field.config.validation?.unique !== false
  return field.config.validation?.unique === true
}

/**
 * B4 — non-blocking warnings for the fields present in `values`. Never throws, never
 * blocks a write: the route returns these alongside the data for the editor to render
 * amber. Uses the shared evalFieldWarning so admin live-hints and API agree.
 */
export function collectFieldWarnings(
  fields: FieldDefinition[],
  values: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of flattenFields(fields)) {
    if (!(field.name in values)) continue
    const rules = (field.config?.validation as { warnings?: import('@tangen/types').FieldWarningRules } | undefined)?.warnings
    const w = evalFieldWarning(rules, field.label, values[field.name])
    if (w) out[field.name] = w
  }
  return out
}

/** Range writes: { min, max } (or a literal) → the inclusive numrange literal PG stores. */
export function normalizeRangeFieldValues(
  fields: FieldDefinition[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const rangeFields = flattenFields(fields).filter((f) => f.fieldType === 'range' && f.name in values)
  if (rangeFields.length === 0) return values
  const out = { ...values }
  for (const f of rangeFields) {
    const r = parseNumrange(out[f.name])
    if (r) out[f.name] = formatNumrange(r)
  }
  return out
}

/** Range reads: the stored numrange literal → { min, max } for API consumers. */
export function normalizeRangeReads(
  rows: Record<string, unknown>[],
  fields: FieldDefinition[],
): Record<string, unknown>[] {
  const rangeFields = flattenFields(fields).filter((f) => f.fieldType === 'range')
  if (rangeFields.length === 0) return rows
  return rows.map((row) => {
    const next = { ...row }
    for (const f of rangeFields) {
      if (typeof next[f.name] === 'string') next[f.name] = parseNumrange(next[f.name])
    }
    return next
  })
}

/**
 * A many:true relation lives in a TEXT column, so the driver stores JS arrays as
 * Postgres array literals ('{id1,id2}') and reads them back as raw strings. Parse
 * them into real string arrays at every read boundary — the admin picker, API
 * consumers, and required-validation all expect arrays ('{}' must count as EMPTY,
 * not as a non-empty string that satisfies `required`).
 */
export function parsePgTextArray(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v.startsWith('{') || !v.endsWith('}')) return null
  const inner = v.slice(1, -1)
  return inner ? inner.split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean) : []
}

/** Normalizes many:true relation values from pg array literals to string arrays. */
export function normalizeManyRelationReads(
  rows: Record<string, unknown>[],
  fields: FieldDefinition[],
): Record<string, unknown>[] {
  const manyRelations = flattenFields(fields).filter(
    (f) => f.fieldType === 'relation' && (f.config as { many?: boolean })?.many === true,
  )
  if (manyRelations.length === 0) return rows
  return rows.map((row) => {
    const next = { ...row }
    for (const f of manyRelations) {
      if (typeof next[f.name] === 'string') next[f.name] = parsePgTextArray(next[f.name])
    }
    return next
  })
}

/**
 * Resolve string component refs (reusable registry names) into full defs on the
 * component fields, so block sub-field validation reaches REUSABLE blocks too —
 * string refs used to be silently skipped. Unknown names drop (never throw).
 */
export function resolveComponentFieldRefs(
  fields: FieldDefinition[],
  projects: Array<{ workspaceId?: string; components?: unknown[] }> | undefined,
  workspaceId: string,
): FieldDefinition[] {
  const registry = (projects?.find((p) => p.workspaceId === workspaceId)?.components ?? []) as Array<{ name?: string }>
  if (!fields.some((f) => f.fieldType === 'component')) return fields
  return fields.map((f) => {
    if (f.fieldType !== 'component') return f
    const refs = ((f.config as { components?: unknown[] })?.components ?? []) as Array<string | Record<string, unknown>>
    const resolved = refs
      .map((r) => (typeof r === 'string' ? registry.find((c) => c.name === r) : r))
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    return { ...f, config: { ...f.config, components: resolved } } as unknown as FieldDefinition
  })
}

/**
 * Why a document was refused, in words an editor can act on. Every case names
 * the node, mark or attribute that caused it - a validator that says only
 * "invalid" sends someone hunting through a document by hand.
 */
function richtextMessage(label: string, res: Exclude<ContentDocResult, { ok: true }>): string {
  switch (res.reason) {
    case 'not-a-document':      return `${label} is not a rich text document`
    case 'unknown-node':        return `${label} contains "${res.node}", which is not a rich text element here`
    case 'unknown-mark':        return `${label} contains the formatting "${res.mark}", which is not available here`
    case 'content-not-allowed': return `${label} has "${res.child}" inside "${res.node}", which cannot hold it`
    case 'unknown-attr':        return `${label} sets "${res.attr}" on "${res.node}", which does not have it`
    case 'bad-attr':            return `${label} has an invalid "${res.attr}" on "${res.node}"`
    case 'missing-attr':        return `${label} is missing "${res.attr}" on "${res.node}"`
    case 'bad-text':            return `${label} has a text node with no text`
    case 'too-deep':            return `${label} is nested too deeply`
  }
}
