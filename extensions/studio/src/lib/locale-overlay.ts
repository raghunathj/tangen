/**
 * File Name: locale-overlay.ts
 * Purpose: The per-locale overlay draft Studio edits while translating -
 *          addressing a block in it, reading and writing one value, laying
 *          it over the base blocks for the canvas, and deciding which fields
 *          of a page can be in it at all.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The shape is the platform's, not Studio's
 *          (docs/localization.md): a locale's translations are one map per
 *          container field keyed by block `_key`, with a nested container
 *          as a nested map under its slot name. The server validates writes
 *          against that shape and merges reads with it (`localizeRow`), so
 *          Studio keeps ONE reading of it here - the save payload and the
 *          preview come from the same functions and cannot disagree.
 *
 *          A translation lives BESIDE the base draft, never in it. The
 *          block tree is shared by every language; the overlay carries only
 *          the localized sub-values of one. That is what lets a French edit
 *          never reach the English record.
 *
 *          Everything here is pure. The page owns the state and the save.
 */
import type { ComponentDef, FieldDefinition, SubField } from '@tangen/types'
import type { BlockPath } from './ops'
import { isLocalizedField } from './locale-edit'

/** A locale's draft: the title, the page's localized fields, and one map per container. */
export type LocaleOverlay = Record<string, unknown>

/** `{ [_key]: { [sub]: value | nested map } }` - the shape under a container field. */
export type OverlayMap = Record<string, Record<string, unknown>>

// ── Which document an overlay belongs to ─────────────────────────────────────

/**
 * The object a locale overlay is edited FOR, and the row its save writes to.
 *
 * Studio edits three kinds of document on one screen, and two of them are
 * content objects with side rows of their own. The overlay machinery was
 * bound to the PAGE's type and id, so translating an instance was locked -
 * because writing an instance's Tamil into the page's `<type>_i18n` row is
 * far worse than refusing to write it at all.
 *
 * `key` is what makes that impossible rather than merely unlikely: the
 * drafts carry the key of the document they were typed against, and a save
 * whose key does not match the document now open writes nothing. Every other
 * guard in this file is about content; this one is about identity.
 */
export interface LocaleTarget {
  /** Identity of the edited document: `page` or `instance:<id>`. */
  key: string
  type: string
  id: string
}

/** The overlay target for the page. */
export function pageLocaleTarget(type: string | null | undefined, id: string | null | undefined): LocaleTarget {
  return { key: 'page', type: type ?? '', id: id ?? '' }
}

/** The overlay target for an instance - its OWN type and row. */
export function instanceLocaleTarget(type: string, id: string): LocaleTarget {
  return { key: `instance:${id}`, type, id }
}

/**
 * The drafts that belong to the document now open, and nothing else.
 *
 * A mismatch reads as NO drafts rather than as the other document's, so a
 * save can never carry one document's translation to another's row - the
 * exact failure that kept instances untranslatable. Switching back restores
 * what was typed, because the state is kept rather than cleared.
 */
export function overlayDraftsFor(
  state: { doc: string; drafts: Record<string, LocaleOverlay> },
  target: LocaleTarget,
  empty: Record<string, LocaleOverlay>,
): Record<string, LocaleOverlay> {
  return state.doc === target.key ? state.drafts : empty
}

/** Where a saved payload is remembered, so two documents cannot share a slot. */
export function overlaySavedKey(target: LocaleTarget, locale: string): string {
  return `${target.key}|${locale}`
}

/** Whether this target can be written at all: a document with no row cannot. */
export function canSaveLocale(target: LocaleTarget): boolean {
  return target.type !== '' && target.id !== ''
}

type Block = Record<string, unknown>

/**
 * How the overlay addresses a block: the keys of every block on the path,
 * with the slot names between them. `[0, 'children', 1]` becomes
 * `['sec', 'children', 'h']`.
 *
 * Null when any block on the way has no `_key`. Legacy rows gain one on
 * their next base save; until then nothing can address an overlay entry,
 * and minting a key here would write a translation nothing can read back.
 */
export function keyChain(blocks: unknown, path: BlockPath): string[] | null {
  if (!Array.isArray(path) || path.length === 0) return null
  const chain: string[] = []
  let list: unknown = blocks
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]
    if (typeof seg === 'number') {
      if (!Array.isArray(list)) return null
      const block = list[seg] as Block | undefined
      const key = block?._key
      if (typeof key !== 'string' || !key) return null
      chain.push(key)
      list = block
    } else {
      if (!list || typeof list !== 'object') return null
      chain.push(seg)
      list = (list as Block)[seg]
    }
  }
  return chain
}

/** The translation of one prop on one block, or undefined when untranslated. */
export function readOverlayValue(overlay: LocaleOverlay, container: string, chain: string[], prop: string): unknown {
  let node: unknown = overlay?.[container]
  for (const step of chain) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined
    node = (node as Record<string, unknown>)[step]
  }
  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined
  return (node as Record<string, unknown>)[prop]
}

/** A new overlay with one prop on one block translated. Never mutates. */
export function writeOverlayValue(
  overlay: LocaleOverlay, container: string, chain: string[], prop: string, value: unknown,
): LocaleOverlay {
  const set = (node: unknown, steps: string[]): Record<string, unknown> => {
    const base = node && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>) : {}
    if (steps.length === 0) return { ...base, [prop]: value }
    const [head, ...rest] = steps
    return { ...base, [head]: set(base[head], rest) }
  }
  return { ...overlay, [container]: set(overlay?.[container], chain) }
}

/** A page-level field (or the title) in the overlay. */
export function overlayField(overlay: LocaleOverlay, name: string, value: unknown): LocaleOverlay {
  return { ...overlay, [name]: value }
}

/**
 * The base blocks with a locale laid over them, for the canvas. Mirrors the
 * server's `mergeContainerOverlay`: a translated value wins, a blank one
 * falls back to the base, meta keys are never overlaid, a nested container
 * recurses. Fails open - a malformed overlay leaves the base alone.
 */
export function mergeOverlay(blocks: unknown, overlay: unknown): unknown {
  if (!Array.isArray(blocks) || !overlay || typeof overlay !== 'object' || Array.isArray(overlay)) return blocks
  const byKey = overlay as Record<string, unknown>
  return blocks.map((block) => {
    const key = (block as Block)?._key
    const entry = typeof key === 'string' ? byKey[key] : undefined
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return block
    const out: Block = { ...(block as Block) }
    for (const [k, v] of Object.entries(entry as Record<string, unknown>)) {
      if (v === null || v === undefined || v === '') continue
      if (k.startsWith('_')) continue
      if (Array.isArray(out[k]) && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = mergeOverlay(out[k], v)
      } else {
        out[k] = v
      }
    }
    return out
  })
}

/**
 * A locale's draft from its i18n map entry, every slot present so a control
 * always has something to bind to. The same seeding the object editor does.
 */
export function seedOverlay(
  entry: Record<string, unknown> | undefined,
  localizedFields: string[],
  containers: string[],
): LocaleOverlay {
  const e = entry ?? {}
  return {
    title: typeof e.__title === 'string' ? e.__title : '',
    ...Object.fromEntries(localizedFields.map((name) => [name, e[name] ?? null])),
    ...Object.fromEntries(containers.map((name) => [name, e[name] ?? {}])),
  }
}

type FieldLike = FieldDefinition | SubField

const isContainer = (f: FieldLike): boolean => f.fieldType === 'component' || f.fieldType === 'repeater'

/** The page's own fields with a side column: localized, and not a container. */
export function localizedTopFields(fields: readonly FieldLike[] | undefined): string[] {
  return (fields ?? []).filter((f) => !isContainer(f) && isLocalizedField(f as SubField)).map((f) => f.name)
}

/** True when something localized sits anywhere inside this container. */
function containerHasLocalized(field: FieldLike, defs: readonly ComponentDef[], seen: Set<string>): boolean {
  const cfg = (field.config ?? {}) as {
    fields?: FieldLike[]; groupFields?: FieldLike[]; components?: Array<string | ComponentDef>
  }
  // A group is a folder of fields, not a container with rows: the server's
  // `localizedContainerFields` looks straight through it, and so does this.
  const subsOf = (subs: FieldLike[] | undefined): boolean =>
    (subs ?? []).some((sf) => (
      isContainer(sf) || sf.fieldType === 'group'
        ? containerHasLocalized(sf, defs, seen)
        : isLocalizedField(sf as SubField)
    ))
  if (field.fieldType === 'group') return subsOf(cfg.groupFields)
  if (field.fieldType === 'repeater') return subsOf(cfg.fields)
  if (field.fieldType !== 'component') return false
  for (const ref of cfg.components ?? []) {
    const def = typeof ref === 'string' ? defs.find((d) => d.name === ref) : ref
    if (!def) continue
    // A component may hold its own kind; walking it twice would never end.
    if (seen.has(def.name)) continue
    seen.add(def.name)
    if (subsOf(def.fields as FieldLike[] | undefined)) return true
  }
  return false
}

/**
 * The container fields that hold a translation overlay: those with a
 * localized sub-field anywhere inside, looking through nested slots. The
 * same rule the server's `localizedContainerFields` applies to a write.
 */
export function localizedContainerNames(
  fields: readonly FieldLike[] | undefined,
  defs: readonly ComponentDef[],
): string[] {
  return (fields ?? [])
    .filter((f) => isContainer(f) && containerHasLocalized(f, defs, new Set()))
    .map((f) => f.name)
}

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '')

/** A richtext value is a document, not a nested overlay map. */
function isRichDoc(v: object): boolean { return typeof (v as { type?: unknown }).type === 'string' }

/** An empty richtext document counts as no source text. */
function isBlankValue(v: unknown): boolean {
  if (isBlank(v)) return true
  if (v && typeof v === 'object' && !Array.isArray(v) && isRichDoc(v as object)) {
    const content = (v as { content?: unknown }).content
    return !Array.isArray(content) || content.length === 0
  }
  return false
}

/** Two translation values the same, for strings and for richtext documents. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'object' && typeof b === 'object' && a && b) {
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }
  return false
}

/**
 * What a translation control holds: the translation when there is one, and
 * otherwise the SOURCE text, ready to be edited over.
 *
 * A translator works by rewriting a sentence, not by retyping it from an
 * empty box next to a grey placeholder, so the default language is put in
 * the control itself. It is a copy: the base blocks are shared by every
 * language and a draft must never reach them.
 */
export function translationDraft(translated: unknown, source: unknown): unknown {
  if (!isBlankValue(translated)) return translated
  if (isBlankValue(source)) return null
  return typeof source === 'object' && source !== null ? structuredClone(source) : source
}

/**
 * What that control stores. Text still identical to the source is stored as
 * blank, which the save prunes, so the value keeps FALLING BACK instead of
 * becoming a frozen copy: the server only reaches the default language for
 * a translation that is not there, so a stored copy would silently stop
 * following the original the day someone edits it.
 */
export function translationWrite(next: unknown, source: unknown): unknown {
  if (isBlankValue(next)) return ''
  if (!isBlankValue(source) && sameValue(next, source)) return ''
  return next
}

/** Whether the control is showing the source rather than a translation. */
export function isInheritedTranslation(translated: unknown, source: unknown): boolean {
  return isBlankValue(translated) && !isBlankValue(source)
}

/**
 * What the canvas shows for a locale: the base with the overlay laid over
 * it - translated wins, blank falls back - the same rule as the server's
 * locale read, so the preview matches what the site will serve.
 */
export function previewValues(input: {
  title: string
  values: Record<string, unknown>
  overlay: LocaleOverlay
  localizedFields: string[]
  containers: string[]
}): { title: string; values: Record<string, unknown> } {
  const values = { ...input.values }
  for (const name of input.localizedFields) {
    const v = input.overlay[name]
    if (!isBlank(v)) values[name] = v
  }
  for (const name of input.containers) {
    values[name] = mergeOverlay(values[name], input.overlay[name])
  }
  const t = input.overlay.title
  return { title: typeof t === 'string' && !isBlank(t) ? t : input.title, values }
}

/**
 * One container map with its blank leaves and the empty maps they leave
 * behind removed, at any depth. Undefined when nothing survives.
 */
function pruneMap(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isBlank(v)) continue
    if (v && typeof v === 'object' && !Array.isArray(v) && !isRichDoc(v)) {
      const inner = pruneMap(v)
      if (inner && Object.keys(inner).length > 0) out[k] = inner
    } else {
      out[k] = v
    }
  }
  return out
}


/**
 * The overlay as the locale route should receive it. A cleared translation
 * sits in the draft as '' so the control can show empty, and an undo can
 * leave a nested map holding nothing but blanks; the object editor's payload
 * builder drops blanks ONE level down, which was the whole depth it knew.
 * Studio's blocks nest, so the containers are pruned here at every depth
 * first - the server never stores a map of empty strings, and the dirty
 * check never sees a difference that is not one. Page-level fields are left
 * as they are: the payload builder already turns their '' into null.
 */
export function pruneOverlayForSave(overlay: LocaleOverlay, containers: readonly string[]): LocaleOverlay {
  const out: LocaleOverlay = { ...overlay }
  for (const name of containers) {
    const raw = overlay?.[name]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    out[name] = pruneMap(raw) ?? {}
  }
  return out
}
