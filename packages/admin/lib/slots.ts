/**
 * File Name: slots.ts
 * Purpose: The pure half of Admin slots (Extension Kernel K7.2): which items
 *          a slot shows, in what order. An item mounts only when the server
 *          listed it for an ACTIVE extension (the extensions list carries
 *          each extension's allowed items, filtered by its effective
 *          grants), and only when its access rule passes for the member the
 *          way a page's rule does. Order is priority (higher first), then
 *          extension id, then item id - stable across builds.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ComponentType } from 'react'
import type { AdminAccessRule } from '@tangen/types'
import { checkAdminAccess } from '@/components/require-permission'
import type { MePermissions } from '@/lib/use-can'

export interface SlotContext {
  workspaceId: string
  /** The extension whose item is rendering. */
  extensionId: string
  slot: string
  /** Screen-specific facts (the extension an overview page is about, the object an editor holds). */
  [key: string]: unknown
}

export interface SlotItem {
  extensionId: string
  slot: string
  id: string
  component: ComponentType<{ context: SlotContext }>
  label?: string
  priority?: number
  access?: AdminAccessRule
}

/** Extension id → the items its client module provides, every slot. */
export type SlotRegistry = Record<string, SlotItem[]>

/** `<slot>:<id>` - the key the server's allow-list uses. */
export const slotItemKey = (slot: string, id: string) => `${slot}:${id}`

export function orderSlotItems<T extends SlotItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) =>
    (b.priority ?? 0) - (a.priority ?? 0)
    || a.extensionId.localeCompare(b.extensionId)
    || a.id.localeCompare(b.id))
}

export function selectSlotItems(
  registry: SlotRegistry,
  slot: string,
  opts: { allowed: ReadonlyMap<string, ReadonlySet<string>>; me: MePermissions | null; extensionId?: string },
): SlotItem[] {
  const out: SlotItem[] = []
  for (const [extensionId, items] of Object.entries(registry)) {
    if (opts.extensionId && extensionId !== opts.extensionId) continue
    const allowedHere = opts.allowed.get(extensionId)
    if (!allowedHere) continue
    for (const item of items) {
      if (item.slot !== slot || !allowedHere.has(slotItemKey(item.slot, item.id))) continue
      if (!checkAdminAccess(opts.me, item.access)) continue
      out.push(item)
    }
  }
  return orderSlotItems(out)
}

/** The allow-list the extensions list answers, as the selector wants it. */
export function allowedFromExtensions(entries: ReadonlyArray<{ id: string; slots?: Array<{ slot: string; id: string }> }>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const e of entries) out.set(e.id, new Set((e.slots ?? []).map((s) => slotItemKey(s.slot, s.id))))
  return out
}
