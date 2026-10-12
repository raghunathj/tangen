/**
 * File Name: housekeeping.ts
 * Purpose: The class housekeeping report - duplicate groups with a default
 *          keeper, the classes nothing in the environment wears, and the
 *          summaries a confirm dialog shows before a merge or a delete.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `duplicateGroups` and `unusedClasses` have been in the
 *          model since WF-T13b and reachable from nowhere: what they lacked
 *          was a list surface with selection, and one fact the page-local
 *          model cannot know - usage across the whole environment. This joins
 *          the two, so every class a designer is about to merge or delete
 *          reads "3 elements on 2 pages" first. The element count is the
 *          blast radius; the page count is how many pages must publish again
 *          before visitors see the change, because a published page keeps
 *          the class names it was published with.
 *
 *          `unused` is decided by the environment-wide usage, NOT by
 *          `unusedClasses` over the open page: that function answers a
 *          different question and deleting by it would unstyle other pages.
 */
import { duplicateGroups, type StyleClass } from './classes'
import type { ClassUsage } from './class-usage'

export type UsageMap = Record<string, ClassUsage>

export interface DuplicateMember {
  cls: StyleClass
  elements: number
  pages: number
}

export interface DuplicateGroup {
  members: DuplicateMember[]
  /** The id of the class a merge keeps by default. */
  keeper: string
}

export interface HousekeepingReport {
  duplicates: DuplicateGroup[]
  /** Classes worn by nothing, anywhere in the environment. By name. */
  unused: StyleClass[]
  /** Things needing attention: duplicate groups plus unused classes. */
  total: number
}

const usageOf = (usage: UsageMap, name: string): ClassUsage => usage[name] ?? { elements: 0, pages: 0 }

/**
 * The member a merge keeps unless the designer picks another: the most-worn
 * one, because rewriting the fewest references is the smallest change; on a
 * tie the shortest name, then the first alphabetically - `card` over
 * `card-2`, which is the copy.
 */
export function defaultKeeper(group: StyleClass[], usage: UsageMap): string {
  const ranked = [...group].sort((a, b) =>
    usageOf(usage, b.name).elements - usageOf(usage, a.name).elements
    || a.name.length - b.name.length
    || a.name.localeCompare(b.name))
  return ranked[0].id
}

export function housekeepingReport(classes: StyleClass[], usage: UsageMap): HousekeepingReport {
  const duplicates = duplicateGroups(classes).map((group) => ({
    members: group.map((cls) => ({ cls, ...usageOf(usage, cls.name) })),
    keeper: defaultKeeper(group, usage),
  }))
  const unused = classes
    .filter((c) => usageOf(usage, c.name).elements === 0)
    .sort((a, b) => a.name.localeCompare(b.name))
  return { duplicates, unused, total: duplicates.length + unused.length }
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`
const names = (list: StyleClass[]) => list.map((c) => `.${c.name}`).join(', ')

/** What a merge will do, for the confirm dialog. */
export function mergeSummary(group: StyleClass[], keeperId: string, usage: UsageMap): string {
  const keeper = group.find((c) => c.id === keeperId)
  const removed = group.filter((c) => c.id !== keeperId)
  const elements = removed.reduce((n, c) => n + usageOf(usage, c.name).elements, 0)
  const pages = removed.reduce((n, c) => n + usageOf(usage, c.name).pages, 0)
  const head = `${names(removed)} will be replaced by .${keeper?.name ?? '?'} and deleted.`
  if (elements === 0) return `${head} Nothing wears ${removed.length === 1 ? 'it' : 'them'}, so no page changes.`
  return `${head} ${plural(elements, 'element')} on ${plural(pages, 'page')} will wear .${keeper?.name ?? '?'} instead, and ${pages === 1 ? 'that page' : 'those pages'} will need publishing again.`
}

/** What a delete will do, for the confirm dialog. */
export function deleteSummary(list: StyleClass[]): string {
  if (list.length === 1) return `.${list[0].name} will be deleted for the whole workspace. Nothing wears it.`
  return `${plural(list.length, 'class', 'classes')} will be deleted for the whole workspace: ${names(list)}. Nothing wears them.`
}
