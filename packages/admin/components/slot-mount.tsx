/**
 * File Name: slot-mount.tsx
 * Purpose: `<Slot name="admin.settings.sections@1" />` (Extension Kernel
 *          K7.2): the mounted slot. Items come from the build's registry
 *          (the Vite virtual module), pass the server's allow-list (the
 *          extensions list names what each ACTIVE extension may fill, by
 *          its effective grants) and the member's permissions, and render
 *          through SlotItems. Core contributes one item of its own per
 *          extension with typed settings: the generated settings form, on
 *          the settings-sections slot, at the lowest priority.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useExtensionUi } from '@/lib/extension-ui'
import { adminFetch } from '@/lib/api'
import { useCan } from '@/lib/use-can'
import { allowedFromExtensions, selectSlotItems, orderSlotItems, type SlotItem, type SlotContext } from '@/lib/slots'
import { SlotItems } from '@/components/slot'
import { checkAdminAccess } from '@/components/require-permission'
import { ExtensionSettingsForm } from '@/components/extensions/extension-settings-form'

interface ExtensionListEntry { id: string; name: string; slots?: Array<{ slot: string; id: string }>; settings?: boolean }

let cache: { workspaceId: string; promise: Promise<ExtensionListEntry[]> } | null = null
function fetchExtensions(workspaceId: string): Promise<ExtensionListEntry[]> {
  if (cache?.workspaceId === workspaceId) return cache.promise
  const promise = adminFetch<{ data?: ExtensionListEntry[] }>('/extensions').then((r) => r.data ?? []).catch(() => { cache = null; return [] })
  cache = { workspaceId, promise }
  return promise
}

/** The generated settings form as a slot item, one per extension that declares settings. */
function settingsItems(entries: ExtensionListEntry[]): SlotItem[] {
  return entries.filter((e) => e.settings).map((e) => ({
    extensionId: e.id, slot: 'admin.settings.sections@1', id: '__settings', priority: -100,
    access: { capability: 'manage:settings' },
    component: ({ context }: { context: SlotContext }) => <ExtensionSettingsForm extensionId={context.extensionId} title={`${e.name} settings`} />,
  }))
}

export function Slot({ name, extensionId, context }: {
  name: string
  /** For an extension-scoped screen: only that extension's items. */
  extensionId?: string
  context?: Record<string, unknown>
}) {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params.workspaceId!
  const { me } = useCan()
  const ui = useExtensionUi(workspaceId)
  const [entries, setEntries] = useState<ExtensionListEntry[] | null>(null)
  useEffect(() => {
    let alive = true
    fetchExtensions(workspaceId).then((e) => { if (alive) setEntries(e) })
    return () => { alive = false }
  }, [workspaceId])

  const items = useMemo(() => {
    if (!entries) return []
    const allowed = allowedFromExtensions(entries)
    const fromExtensions = selectSlotItems(ui.slots, name, { allowed, me: me ?? null, extensionId })
    const core = name === 'admin.settings.sections@1'
      ? settingsItems(entries).filter((i) => (!extensionId || i.extensionId === extensionId) && checkAdminAccess(me ?? null, { capability: 'manage:settings' }))
      : []
    return orderSlotItems([...fromExtensions, ...core])
  }, [entries, name, me, extensionId, ui])

  if (items.length === 0) return null
  return <SlotItems slot={name} items={items} context={{ workspaceId, ...(context ?? {}) }} />
}
