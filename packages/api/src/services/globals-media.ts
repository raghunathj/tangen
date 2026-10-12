/**
 * File Name: globals-media.ts
 * Purpose: Media in a global reads and writes exactly like media in an
 *   object. A global is a schemaless jsonb blob, but its DEFINITION declares
 *   fields the way a type does, so the same schema-driven walk that expands a
 *   kit.image inside a page's sections expands one inside a header global's
 *   blocks: a read hands the renderer an asset object with its url, a write
 *   folds an echoed asset object back to its id before it lands in the blob.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: media-loader (expandMediaDeep / collapseMediaDeep),
 *   @tangen/types (GlobalDefinition, ComponentDef). The blob's `__i18n`
 *   sections mirror the top-level keys (i18n.ts localizeGlobalData), so they
 *   walk with the same field list; expanding them beside the defaults keeps
 *   one asset query per read. Every consumer resolves the definition and the
 *   registry from the workspace project the way the object routes do, so the
 *   REST route, the local client (GraphQL, custom routes, extensions, Studio)
 *   and a future caller cannot drift apart on what a global's media looks like.
 */
import type { ComponentDef, GlobalDefinition } from '@tangen/types'
import { expandMediaDeep, collapseMediaDeep } from './media-loader'

/** The loose project shape the routes and the local client carry (workspace-loader output). */
export type ProjectLike = { workspaceId: string; [k: string]: unknown }

type I18nSections = Record<string, Record<string, unknown>>

/** The workspace's global definitions: the config's array first, then the loader's copy. */
export function globalDefinitionsOf(project: ProjectLike | undefined | null): GlobalDefinition[] {
  const config = project?.config as { globals?: unknown } | undefined
  const raw = config?.globals ?? project?.globals
  return Array.isArray(raw) ? (raw as GlobalDefinition[]) : []
}

/** One global's definition by name; undefined when the workspace does not declare it. */
export function globalDefinitionOf(project: ProjectLike | undefined | null, name: string): GlobalDefinition | undefined {
  return globalDefinitionsOf(project).find((g) => g?.name === name)
}

/** The workspace's reusable components, for blocks a global declares by registry name. */
export function componentRegistryOf(project: ProjectLike | undefined | null): ComponentDef[] {
  const raw = project?.components
  return Array.isArray(raw) ? (raw as ComponentDef[]) : []
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** The definition as the media walker reads it: a field list, never undefined. */
function typeLikeOf(def: GlobalDefinition): { fields: GlobalDefinition['fields'] } {
  return { fields: Array.isArray(def.fields) ? def.fields : [] }
}

/** Splits the blob into its defaults and the per-locale sections that mirror them. */
function splitI18n(data: Record<string, unknown>): { rest: Record<string, unknown>; sections: I18nSections | null } {
  const { __i18n, ...rest } = data
  if (!isRecord(__i18n)) return { rest, sections: null }
  const sections: I18nSections = {}
  for (const [locale, section] of Object.entries(__i18n)) {
    if (isRecord(section)) sections[locale] = section
  }
  return { rest, sections }
}

/**
 * Expands every media id the global's definition declares - top-level
 * fields, blocks, repeater rows, groups and the containers nested inside
 * blocks - into the asset shape object reads produce, in one asset query.
 * The `__i18n` sections expand beside the defaults so a `locale=all` read
 * and the local client (which hands the whole blob over) see one shape.
 *
 * Returns the SAME object when there is nothing to do: no definition, no
 * media declared, or an empty blob. Idempotent on an already expanded blob.
 */
export async function expandGlobalMedia(
  data: Record<string, unknown>,
  def: GlobalDefinition | undefined | null,
  registry: ComponentDef[] | null | undefined,
  db: any,
  workspaceId: string,
  locale?: string | null,
): Promise<Record<string, unknown>> {
  if (!def || !isRecord(data)) return data
  const typeLike = typeLikeOf(def)
  const { rest, sections } = splitI18n(data)
  const locales = sections ? Object.keys(sections) : []
  const rows = [rest, ...locales.map((l) => sections![l])]
  const expanded = await expandMediaDeep(rows, typeLike, registry, db, workspaceId, locale)
  if (expanded === rows || expanded.every((row, i) => row === rows[i])) return data
  const [top, ...localized] = expanded
  if (!sections) return top
  const __i18n: I18nSections = { ...(data.__i18n as I18nSections) }
  locales.forEach((l, i) => { __i18n[l] = localized[i] })
  return { ...top, __i18n }
}

/**
 * Write-side inverse: folds an expanded asset object back to its id at every
 * media position the definition declares, `__i18n` sections included, so a
 * client echoing a read (Studio saving a surface, a custom route copying a
 * global) stores ids in the blob and never a snapshot of the asset. Returns
 * the same object when nothing needed folding.
 */
export function collapseGlobalMedia(
  data: Record<string, unknown>,
  def: GlobalDefinition | undefined | null,
  registry: ComponentDef[] | null | undefined,
): Record<string, unknown> {
  if (!def || !isRecord(data)) return data
  const typeLike = typeLikeOf(def)
  const { rest, sections } = splitI18n(data)
  const top = collapseMediaDeep(rest, typeLike, registry)
  let changed = top !== rest
  let __i18n: I18nSections | null = null
  if (sections) {
    __i18n = { ...(data.__i18n as I18nSections) }
    for (const [l, section] of Object.entries(sections)) {
      const folded = collapseMediaDeep(section, typeLike, registry)
      if (folded !== section) { __i18n[l] = folded; changed = true }
    }
  }
  if (!changed) return data
  return __i18n ? { ...top, __i18n } : top
}
