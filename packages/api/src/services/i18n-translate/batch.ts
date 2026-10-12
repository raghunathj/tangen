/**
 * File Name: batch.ts
 * Purpose: Field batching for translation — flattens title + localized
 *          text/textarea/richtext values into one ordered text list for a
 *          single engine call, and reassembles translated values per field.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: v1 translates text-shaped fields; other localized types
 *          are reported in `skipped` (translate them by hand or per-field AI).
 */
import { localizedFieldNames } from '../i18n'
import { localizedContainerFields } from '@tangen/schema'
import { extractRichtextTexts, replaceRichtextTexts } from './richtext'

const TEXT_TYPES = new Set(['text', 'textarea'])

export interface TranslatableItem {
  field: string
  kind: 'text' | 'richtext'
  /** Index range [start, end) into the flat texts array. */
  start: number
  end: number
  /** Original richtext doc — translated texts are reinserted into a copy. */
  doc?: unknown
  /** BL-5: sub-field inside a container — assembled into an overlay, not a scalar. */
  container?: { rowKey: string; sub: string }
}

/**
 * Flattens the translatable values: `title` (when present) plus every
 * localized text/textarea/richtext field with a non-empty value. Non-text
 * localized fields land in `skipped`.
 */
export function collectTranslatables(
  typeDef: { fields: { name: string; fieldType: string; config?: Record<string, unknown> }[] },
  values: Record<string, unknown>,
  fields?: string[],
  registry: Array<Record<string, unknown>> = [],
): { items: TranslatableItem[]; texts: string[]; skipped: string[] } {
  const wanted = fields ? new Set(fields) : null
  const localized = new Set(localizedFieldNames(typeDef))
  const containers = localizedContainerFields(typeDef.fields as never, registry as never)
  const byName = new Map(typeDef.fields.map((f) => [f.name, f]))

  const items: TranslatableItem[] = []
  const texts: string[] = []
  const skipped: string[] = []

  function pushText(field: string, value: string) {
    items.push({ field, kind: 'text', start: texts.length, end: texts.length + 1 })
    texts.push(value)
  }

  if ((!wanted || wanted.has('title')) && typeof values.title === 'string' && values.title.trim()) {
    pushText('title', values.title)
  }

  for (const name of localized) {
    if (name === 'title') continue // handled above - never batched twice
    if (wanted && !wanted.has(name)) continue
    const value = values[name]
    if (value === null || value === undefined || value === '') continue
    const fieldType = byName.get(name)?.fieldType ?? 'text'

    if (TEXT_TYPES.has(fieldType) && typeof value === 'string') {
      pushText(name, value)
    } else if (fieldType === 'richtext' && value && typeof value === 'object') {
      const docTexts = extractRichtextTexts(value)
      if (docTexts.length === 0) continue
      items.push({ field: name, kind: 'richtext', start: texts.length, end: texts.length + docTexts.length, doc: value })
      texts.push(...docTexts)
    } else {
      skipped.push(name)
    }
  }

  // BL-5: localized text subs inside blocks/rows — one item per sub, assembled
  // into per-locale overlays. Rows without a _key can't be addressed → skipped.
  for (const name of containers) {
    if (wanted && !wanted.has(name)) continue
    const field = byName.get(name)
    const base = values[name]
    if (!field || !Array.isArray(base)) continue
    const subDefs = new Map<string, string>()   // sub name → fieldType
    const collectDefs = (subs: Array<Record<string, unknown>> | undefined) => {
      for (const sf of subs ?? []) {
        if ((sf.config as Record<string, unknown> | undefined)?.localized === true && sf.fieldType !== 'media') {
          subDefs.set(sf.name as string, sf.fieldType as string)
        }
      }
    }
    if (field.fieldType === 'repeater') collectDefs((field.config as any)?.fields)
    else for (const ref of ((field.config as any)?.components ?? []) as Array<string | Record<string, unknown>>) {
      const def = typeof ref === 'string' ? (registry.find((c) => c.name === ref) as Record<string, unknown> | undefined) : ref
      if (def) collectDefs((def as any).fields)
    }
    for (const row of base as Array<Record<string, unknown>>) {
      const rowKey = row?._key
      if (typeof rowKey !== 'string') continue
      for (const [sub, ft] of subDefs) {
        const v = row[sub]
        if (v === null || v === undefined || v === '') continue
        if (TEXT_TYPES.has(ft) && typeof v === 'string') {
          items.push({ field: name, kind: 'text', start: texts.length, end: texts.length + 1, container: { rowKey, sub } })
          texts.push(v)
        } else if (ft === 'richtext' && typeof v === 'object') {
          const docTexts = extractRichtextTexts(v)
          if (docTexts.length === 0) continue
          items.push({ field: name, kind: 'richtext', start: texts.length, end: texts.length + docTexts.length, doc: v, container: { rowKey, sub } })
          texts.push(...docTexts)
        } else {
          skipped.push(`${name}.${sub}`)
        }
      }
    }
  }

  return { items, texts, skipped }
}

/** Reassembles engine output into `{ field: translatedValue }`. */
export function assembleTranslated(
  items: TranslatableItem[],
  translated: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const item of items) {
    const slice = translated.slice(item.start, item.end)
    const value = item.kind === 'richtext' ? replaceRichtextTexts(item.doc, slice) : slice[0]
    if (item.container) {
      const overlay = (out[item.field] ?? {}) as Record<string, Record<string, unknown>>
      overlay[item.container.rowKey] = { ...(overlay[item.container.rowKey] ?? {}), [item.container.sub]: value }
      out[item.field] = overlay
    } else {
      out[item.field] = value
    }
  }
  return out
}
