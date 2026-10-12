/**
 * File Name: component-origins.ts
 * Purpose: The Components panel's model - every insertable thing filed
 *          under the ORIGIN it came from, each entry labelled, empty origins
 *          kept with the reason, and one search across all of them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Three origins, and the label is the point. A marketer
 *          looking for a section that is not there needs to know WHY: a
 *          Pre-built block ships with Studio and is always here; a Developer
 *          component was declared in code and needs a deploy to exist in
 *          this environment; a Saved preset was made in Studio and lives in
 *          this environment's store. Without the label that confusion only
 *          surfaces at promote time. Pure, so the filing and the search are
 *          tested apart from React; the panel renders what this returns.
 */
import type { ComponentDef } from '@tangen/types'
import type { StudioPreset } from './presets'

export type ComponentOrigin = 'prebuilt' | 'developer' | 'saved'

/**
 * Developer first: the Elements panel already lists the kit, and the reason
 * the palette was split was a marketer scrolling past kit.divider to reach
 * the section their developer built. Saved next - made here, by people like
 * them. Pre-built last, present so the panel is complete and labelled.
 */
export const ORIGIN_ORDER: ComponentOrigin[] = ['developer', 'saved', 'prebuilt']

export const ORIGIN_META: Record<ComponentOrigin, { label: string; note: string; empty: string }> = {
  prebuilt: {
    label: 'Pre-built',
    note: 'Ships with Studio. Available in every environment.',
    empty: 'The Builder Kit is not enabled on this page, so no pre-built blocks are offered here.',
  },
  developer: {
    label: 'Developer',
    note: 'Declared in code by your developer. Needs a deploy to exist in an environment.',
    empty: 'Nothing declared in code for this page yet. A developer adds components and deploys them.',
  },
  saved: {
    label: 'Saved',
    note: 'Saved from a page in Studio. Lives in this environment only.',
    empty: 'Nothing saved yet. Select a section and choose Save as preset.',
  },
}

/** A suggested section - Studio-built over the site's own components. */
export interface SuggestionLike {
  id: string
  label: string
  onPick: () => void
}

export interface ComponentEntry {
  /** Unique within the panel: a def's name, `preset:<id>` or `suggestion:<id>`. */
  id: string
  origin: ComponentOrigin
  label: string
  description?: string
  /** The group the entry was declared with (a def's `group`, or "Suggested sections"). */
  group?: string
  /** Set on a component entry - inserted and dragged exactly as an Element is. */
  def?: ComponentDef
  /** Set on a Saved entry - inserted by cloning the stored block. */
  preset?: StudioPreset
  /** Set on a suggested section. */
  suggestion?: SuggestionLike
}

export interface ComponentSection {
  origin: ComponentOrigin
  label: string
  note: string
  entries: ComponentEntry[]
  /** Why the origin has nothing in it; null when it has entries. */
  empty: string | null
}

const KIT_PREFIX = 'kit.'

interface Input {
  /** What may be inserted HERE - the slot's vocabulary, as the Elements panel gets it. */
  defs: ComponentDef[] | undefined
  presets: StudioPreset[] | undefined
  suggestions: SuggestionLike[] | undefined
}

/**
 * Files everything insertable under its origin. Kit blocks are Pre-built by
 * their `kit.` prefix (a site component named "kitchen_sink" stays a
 * Developer one); every other def is the site's; presets are Saved;
 * suggestions are Developer entries, because they are built from the site's
 * components and need the same deploy to exist.
 */
export function componentSections({ defs, presets, suggestions }: Input): ComponentSection[] {
  const entries: Record<ComponentOrigin, ComponentEntry[]> = { prebuilt: [], developer: [], saved: [] }

  for (const def of defs ?? []) {
    if (!def || typeof def !== 'object' || typeof def.name !== 'string' || def.name === '') continue
    const origin: ComponentOrigin = def.name.startsWith(KIT_PREFIX) ? 'prebuilt' : 'developer'
    entries[origin].push({
      id: def.name,
      origin,
      label: def.label || def.name,
      description: def.description,
      group: def.group,
      def,
    })
  }

  for (const s of suggestions ?? []) {
    if (!s || typeof s.id !== 'string' || s.id === '') continue
    entries.developer.push({
      id: `suggestion:${s.id}`,
      origin: 'developer',
      label: s.label,
      group: 'Suggested sections',
      suggestion: s,
    })
  }

  for (const p of presets ?? []) {
    if (!p || typeof p.id !== 'string' || p.id === '') continue
    entries.saved.push({
      id: `preset:${p.id}`,
      origin: 'saved',
      label: p.name || 'Untitled preset',
      preset: p,
    })
  }

  return ORIGIN_ORDER.map((origin) => ({
    origin,
    label: ORIGIN_META[origin].label,
    note: ORIGIN_META[origin].note,
    entries: entries[origin],
    empty: entries[origin].length === 0 ? ORIGIN_META[origin].empty : null,
  }))
}

/** The searchable text of an entry: label, bare name, description, group. */
function haystack(e: ComponentEntry): string[] {
  const name = e.def?.name ?? ''
  return [
    e.label,
    name.startsWith(KIT_PREFIX) ? name.slice(KIT_PREFIX.length) : name,
    e.description ?? '',
    e.group ?? '',
  ].map((s) => s.toLowerCase())
}

/**
 * One search across every origin. A blank query returns the input itself
 * (empties and all); otherwise an origin survives only with a hit, and an
 * origin's own name keeps everything in it - "saved" is how you reach
 * everything saved without knowing any of its names.
 */
export function searchComponentSections(sections: ComponentSection[], query: string): ComponentSection[] {
  const needle = (query ?? '').trim().toLowerCase()
  if (needle === '') return sections
  const out: ComponentSection[] = []
  for (const s of sections) {
    const originMatches = s.label.toLowerCase().includes(needle)
    const entries = originMatches
      ? s.entries
      : s.entries.filter((e) => haystack(e).some((h) => h.includes(needle)))
    if (entries.length === 0) continue
    out.push({ ...s, entries, empty: null })
  }
  return out
}
