/**
 * File Name: porter-studio.ts
 * Purpose: WF-S10 - the Studio Porter provider. A workspace's DESIGN SYSTEM
 *   moves between environments: style classes (`class:`), tag defaults
 *   (`tag:`), section presets (`preset:`), workspace theme token values
 *   (`theme:<var>`) and theme fonts (`theme:font:<name>`).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: User decision (2026-08-25): "a Studio specific provider
 *   first rather than a generic dump extension_data provider, because
 *   portability should be explicit and schema-aware, not blind KV copying."
 *   So every row is PARSED into its family and VALIDATED against Studio's own
 *   rules - on export and again on import - and a row that fails is refused
 *   with a named reason rather than copied. The rules are imported, never
 *   restated: `normalizeClassName`, `propertyById`, `normalizeValue`,
 *   `styleValueError`, `themeValueError`, `readThemeFont`, `tagByName` and
 *   the interaction normalisers come from @tangen/studio-schema, and
 *   `declarationValueError`, `rawCssError` and `classTarget` from
 *   @tangen/studio-compiler. A second copy of those rules here would drift
 *   from the panel that writes the rows, and the drift would land on `:root`.
 *
 *   DERIVED ROWS NEVER TRAVEL. The Studio extension store also holds
 *   `delivery:*` (published page and stylesheet artifacts), `styles:live`
 *   (the compiled workspace stylesheet) and `seeded:kit-templates` (the
 *   gallery seed marker). Those are OUTPUTS of the rows above: a publish in
 *   the target regenerates them from the classes, tags and theme that did
 *   travel. Copying them would install a stale stylesheet whose hash no
 *   longer matches anything, and re-seed templates a marketer deleted.
 *   `page:<objectId>` (X-T2 per-page raw CSS) is source, not derived, but it
 *   is keyed by a CONTENT object id: it has to be remapped like a relation
 *   and therefore belongs with the page's own transfer, not here. See
 *   docs/porter.md.
 *
 *   Identity is the store key, upserted per environment - the same shape as
 *   the flows provider. Export order is family order then key order, so a
 *   re-export of an unchanged environment is byte-identical and diffable.
 */
import { eq, and, sql, inArray, asc } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { extensionData, mediaAssets } from '@tangen/db'
import {
  normalizeClassName, propertyById, normalizeValue, styleValueError,
  themeValueError, readThemeFont, tagByName,
  normalizeInteraction, normalizeTier2Interaction,
  parseTokenRef, legacyVarToRef,
  BREAKPOINTS, STATES, type StoredValue,
} from '@tangen/studio-schema'
import { declarationValueError, rawCssError, classTarget } from '@tangen/studio-compiler'
import { collectMediaIds, applyMediaRemap } from './media-migrator'
import type { PorterProvider, PorterProviderResult, PorterImportContext } from './porter-providers'

export const STUDIO_EXTENSION_ID = 'studio'

/** The five families this provider carries, and nothing else. */
export type StudioFamily = 'class' | 'tag' | 'preset' | 'theme' | 'font'

export interface StudioKeyFamily {
  family: StudioFamily
  prefix: string
  label: string
}

/**
 * Declared order is EXPORT order, and `theme:font:` must be tested before
 * `theme:` because one prefix extends the other - a font row read as a token
 * value would be refused for a var name it never claimed to have.
 */
export const STUDIO_KEY_FAMILIES: readonly StudioKeyFamily[] = Object.freeze([
  { family: 'class', prefix: 'class:', label: 'style classes' },
  { family: 'tag', prefix: 'tag:', label: 'tag defaults' },
  { family: 'preset', prefix: 'preset:', label: 'section presets' },
  { family: 'font', prefix: 'theme:font:', label: 'theme fonts' },
  { family: 'theme', prefix: 'theme:', label: 'theme token values' },
] as const)

/** The family a store key belongs to, or null when it is not ours to move. */
export function studioFamilyOf(key: string): StudioFamily | null {
  for (const f of STUDIO_KEY_FAMILIES) {
    if (typeof key === 'string' && key.startsWith(f.prefix) && key.length > f.prefix.length) return f.family
  }
  return null
}

/** One exported row: validated data, or the reason it was refused. */
export interface StudioPorterRow extends Record<string, unknown> {
  key: string
  family: StudioFamily
  data?: Record<string, unknown>
  refused?: string
}

// ── validation, one reader per family ────────────────────────────────────────

type Validated = { data: Record<string, unknown> } | { error: string }

/** Every leaf string a stored style value holds, across breakpoints and states. */
function styleLeaves(value: StoredValue): string[] {
  if (typeof value === 'string') return [value]
  const out: string[] = []
  const at = value as Record<string, unknown>
  for (const bp of BREAKPOINTS) {
    if (typeof at[bp] === 'string') out.push(at[bp] as string)
  }
  for (const state of STATES) {
    if (state === 'normal') continue
    const nested = at[state]
    if (!nested || typeof nested !== 'object') continue
    for (const bp of BREAKPOINTS) {
      const v = (nested as Record<string, unknown>)[bp]
      if (typeof v === 'string') out.push(v)
    }
  }
  return out
}

/**
 * A `props` bag as both the class rows and the tag rows carry it. Unknown
 * property ids are REFUSED rather than dropped: a silent drop is how a
 * promoted design system loses styling nobody can account for afterwards.
 */
function readProps(raw: unknown): Validated {
  if (raw === undefined || raw === null) return { data: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'props must be an object' }
  const props: Record<string, StoredValue> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const property = propertyById(id)
    if (!property) return { error: `unknown style property "${id}"` }
    if (typeof value !== 'string' && (!value || typeof value !== 'object' || Array.isArray(value))) {
      return { error: `style property "${id}" holds neither a value nor a breakpoint map` }
    }
    const normalized = normalizeValue(value as StoredValue)
    if (normalized === undefined) continue   // an empty shell the emitter would skip anyway
    for (const leaf of styleLeaves(normalized)) {
      // Two gates, both the panel's own: does the value FIT the property, and
      // would the emitter accept the declaration at all.
      const fit = styleValueError(property, leaf)
      if (fit) return { error: `${id}: ${fit}` }
      // A token reference is `{palette.brand}` in the STORE and becomes
      // `var(--tg-bg-brand)` in the stylesheet, so the emitter's rule applies
      // to what it resolves to, not to the braces it is written with.
      if (parseTokenRef(leaf) ?? legacyVarToRef(leaf)) continue
      const safe = declarationValueError(leaf)
      if (safe) return { error: `${id}: ${safe}` }
    }
    props[id] = normalized
  }
  return { data: props }
}

function readClassRow(data: Record<string, unknown>): Validated {
  const name = typeof data.name === 'string' ? data.name : ''
  if (!name || normalizeClassName(name) !== name) {
    return { error: `class name "${name}" is not a usable selector - use letters, numbers and hyphens` }
  }
  const props = readProps(data.props)
  if ('error' in props) return props

  const out: Record<string, unknown> = { ...data, name, props: props.data }

  if (data.custom !== undefined && data.custom !== null) {
    const bad = rawCssError(data.custom)
    if (bad) return { error: `custom CSS: ${bad}` }
  }

  if (data.interaction !== undefined && data.interaction !== null) {
    const raw = data.interaction
    const tier1 = normalizeInteraction(raw)
    const tier2 = tier1 || !raw || typeof raw !== 'object'
      ? null
      : normalizeTier2Interaction({ ...(raw as Record<string, unknown>), className: name })
    if (!tier1 && !tier2) return { error: 'interaction is not one Studio knows' }
    out.interaction = (tier1 ?? tier2) as unknown as Record<string, unknown>
  }

  if (data.target !== undefined && data.target !== null) {
    const target = classTarget(data)
    if (!target) return { error: 'target needs a blockType, a kind, and for a part its name' }
    out.target = target as unknown as Record<string, unknown>
  }

  return { data: out }
}

function readTagRow(key: string, data: Record<string, unknown>): Validated {
  const name = key.slice('tag:'.length)
  // The tag ends up inside a CSS selector, so it is checked against the list
  // Studio actually emits rather than a shape regex.
  if (!tagByName(name)) return { error: `Studio has no default for "${name}"` }
  const props = readProps(data.props)
  if ('error' in props) return props
  return { data: { ...data, props: props.data } }
}

function readPresetRow(data: Record<string, unknown>): Validated {
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (!name) return { error: 'a preset needs a name' }
  if (name.length > 120) return { error: 'a preset name is limited to 120 characters' }
  const block = data.block
  if (!block || typeof block !== 'object' || Array.isArray(block)
      || typeof (block as Record<string, unknown>)._type !== 'string') {
    return { error: 'a preset needs a block with a _type' }
  }
  return { data: { ...data, name } }
}

function readThemeRow(key: string, data: Record<string, unknown>): Validated {
  const varName = key.slice('theme:'.length)
  const bad = themeValueError(varName, data.value)
  if (bad) return { error: bad }
  return { data: { ...data, value: (data.value as string).trim() } }
}

function readFontRow(key: string, data: Record<string, unknown>): Validated {
  const name = key.slice('theme:font:'.length)
  try {
    return { data: { ...data, font: readThemeFont(name, data.font) as unknown as Record<string, unknown> } }
  } catch (err: any) {
    return { error: String(err?.message ?? err) }
  }
}

/**
 * One store row, validated against the family its KEY declares. The key is
 * the authority, never a `family` field a bundle could have been edited to
 * claim - the whole point of a schema-aware provider is that the receiving
 * instance decides what a row is.
 */
export function validateStudioRow(key: string, data: unknown): StudioPorterRow {
  const family = studioFamilyOf(key)
  if (!family) {
    return {
      key,
      family: 'class',
      refused: `"${key}" is not a Studio design-system key (expected one of ${STUDIO_KEY_FAMILIES.map((f) => f.prefix).join(', ')})`,
    }
  }
  const row = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null
  if (!row) return { key, family, refused: 'the stored row is not an object' }

  const result = family === 'class' ? readClassRow(row)
    : family === 'tag' ? readTagRow(key, row)
    : family === 'preset' ? readPresetRow(row)
    : family === 'font' ? readFontRow(key, row)
    : readThemeRow(key, row)

  return 'error' in result
    ? { key, family, refused: result.error }
    : { key, family, data: result.data }
}

// ── the provider ─────────────────────────────────────────────────────────────

/** Rows of THIS extension whose key is one of the five families. */
function studioScope(workspaceId: string) {
  const likes = STUDIO_KEY_FAMILIES.map((f) => sql`${extensionData.objectId} LIKE ${f.prefix + '%'}`)
  return and(
    eq(extensionData.extensionId, STUDIO_EXTENSION_ID),
    eq(extensionData.workspaceId, workspaceId),
    sql`(${sql.join(likes, sql` OR `)})`,
  )
}

const familyRank = new Map(STUDIO_KEY_FAMILIES.map((f, i) => [f.family, i]))

/** Every media asset id referenced anywhere in these rows. */
export function studioMediaIds(rows: Record<string, unknown>[]): string[] {
  const found = new Set<string>()
  for (const row of rows) {
    for (const id of collectMediaIds((row as StudioPorterRow).data)) found.add(id)
  }
  return [...found].sort()
}

export function studioPorterProvider(): PorterProvider {
  return {
    key: 'studio',
    label: 'Studio design system',
    extensionId: 'studio',

    async count(db, workspaceId) {
      const rows = await db.select({ id: extensionData.id }).from(extensionData)
        .where(studioScope(workspaceId))
      return rows.length
    },

    async exportRows(db, workspaceId) {
      const rows = await db.select({ objectId: extensionData.objectId, data: extensionData.data })
        .from(extensionData)
        .where(studioScope(workspaceId))
        .orderBy(asc(extensionData.objectId)) as { objectId: string; data: unknown }[]

      const out = rows.map((r) => validateStudioRow(r.objectId, r.data))
      // Family order, then key order. Stable input (the SQL sort) plus a
      // stable comparator means a re-export of an unchanged environment is
      // byte-identical, so a bundle diff shows only real changes.
      return out.sort((a, b) => {
        const fa = familyRank.get(a.family)! - familyRank.get(b.family)!
        return fa !== 0 ? fa : a.key.localeCompare(b.key)
      })
    },

    mediaIds: studioMediaIds,

    async importRows(db, workspaceId, rows, ctx) {
      let created = 0
      let updated = 0
      const counts: Record<string, number> = {}
      const refused: { key: string; reason: string }[] = []
      const warnings: { key: string; reason: string }[] = []

      const remap = mediaRemapOf(ctx)
      const accepted: StudioPorterRow[] = []

      for (const incoming of rows) {
        const key = String((incoming as StudioPorterRow).key ?? '')
        if (!key) {
          refused.push({ key: '(missing)', reason: 'the row carries no store key' })
          continue
        }
        // A row the SOURCE already refused travels as a named refusal rather
        // than as data, so the operator sees it in the run instead of finding
        // the class missing weeks later.
        const exportRefusal = (incoming as StudioPorterRow).refused
        if (typeof exportRefusal === 'string' && exportRefusal) {
          refused.push({ key, reason: `refused at export: ${exportRefusal}` })
          continue
        }
        // Media references are remapped BEFORE validation, so a value is
        // checked in the form it will actually be stored in.
        const data = remap ? applyMediaRemap((incoming as StudioPorterRow).data, remap) : (incoming as StudioPorterRow).data
        const row = validateStudioRow(key, data)
        if (row.refused) {
          refused.push({ key, reason: row.refused })
          continue
        }
        accepted.push(row)
      }

      for (const w of await referenceWarnings(db, workspaceId, accepted)) warnings.push(w)

      for (const row of accepted) {
        const [existing] = await db.select({ id: extensionData.id }).from(extensionData)
          .where(and(
            eq(extensionData.extensionId, STUDIO_EXTENSION_ID),
            eq(extensionData.workspaceId, workspaceId),
            eq(extensionData.objectId, row.key),
          ))
          .limit(1)

        if (existing) {
          await db.update(extensionData).set({ data: row.data, updatedAt: new Date() })
            .where(eq(extensionData.id, existing.id))
          updated += 1
        } else {
          await db.insert(extensionData).values({
            id: `extd_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
            extensionId: STUDIO_EXTENSION_ID,
            workspaceId,
            objectId: row.key,
            data: row.data,
          })
          created += 1
        }
        counts[row.family] = (counts[row.family] ?? 0) + 1
      }

      const result: PorterProviderResult = { created, updated, counts }
      if (refused.length > 0) result.refused = refused
      if (warnings.length > 0) result.warnings = warnings
      return result
    },
  }
}

/** The bundle's media remap, as media-migrator wants it. */
function mediaRemapOf(ctx: PorterImportContext | undefined): Map<string, string> | null {
  const entries = Object.entries(ctx?.idRemap ?? {}).filter(([from, to]) => from !== to && from.startsWith('med_'))
  return entries.length > 0 ? new Map(entries) : null
}

/**
 * What these rows reference that the TARGET does not have.
 *
 * A warning, never a drop: the row is written either way, because the missing
 * component or asset may land in the next deploy, and a design system that
 * silently loses a preset is worse than one that arrives with a note. What
 * the operator must never get is silence.
 */
async function referenceWarnings(
  db: any,
  workspaceId: string,
  rows: StudioPorterRow[],
): Promise<{ key: string; reason: string }[]> {
  const out: { key: string; reason: string }[] = []
  if (rows.length === 0) return out

  // ── components the target cannot render ─────────────────────────────────
  const wantsBlockTypes = rows.some((r) => r.family === 'preset' || r.family === 'class')
  if (wantsBlockTypes) {
    const { loadAvailableBlockTypes } = await import('./porter-import')
    const available = new Set(await loadAvailableBlockTypes(db))
    for (const row of rows) {
      if (row.family === 'preset') {
        const missing = [...blockTypesIn(row.data?.block)].filter((t) => !available.has(t)).sort()
        for (const t of missing) {
          out.push({ key: row.key, reason: `preset "${String(row.data?.name ?? row.key)}" uses "${t}", which this deployment cannot render` })
        }
      } else if (row.family === 'class') {
        const blockType = (row.data?.target as { blockType?: string } | undefined)?.blockType
        if (blockType && !available.has(blockType)) {
          out.push({ key: row.key, reason: `class "${String(row.data?.name ?? row.key)}" is aimed at "${blockType}", which this deployment cannot render` })
        }
      }
    }
  }

  // ── media the target does not hold ──────────────────────────────────────
  const byAsset = new Map<string, string[]>()
  for (const row of rows) {
    for (const id of collectMediaIds(row.data)) {
      byAsset.set(id, [...(byAsset.get(id) ?? []), row.key])
    }
  }
  if (byAsset.size > 0) {
    const present = await db.select({ id: mediaAssets.id }).from(mediaAssets)
      .where(and(
        eq(mediaAssets.workspaceId, workspaceId),
        inArray(mediaAssets.id, [...byAsset.keys()]),
      )) as { id: string }[]
    const have = new Set(present.map((r) => r.id))
    for (const [assetId, keys] of [...byAsset.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (have.has(assetId)) continue
      for (const key of keys) {
        out.push({ key, reason: `references media ${assetId}, which is not in this deployment - include media in the transfer, or upload it` })
      }
    }
  }

  return out
}

/** Every `_type` a preset's block tree names, however deeply nested. */
function blockTypesIn(block: unknown): Set<string> {
  const found = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const v of value) walk(v); return }
    if (!value || typeof value !== 'object') return
    const t = (value as Record<string, unknown>)._type
    if (typeof t === 'string' && t) found.add(t)
    for (const v of Object.values(value as Record<string, unknown>)) walk(v)
  }
  walk(block)
  return found
}
