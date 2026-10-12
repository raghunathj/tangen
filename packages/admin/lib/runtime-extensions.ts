/**
 * File Name: runtime-extensions.ts
 * Purpose: The Admin's runtime extension registry (Extension Kernel K7.3).
 *          The runtime UI manifest names what each ACTIVE extension mounts
 *          and where its bundle is; the bundle is imported at runtime
 *          against the shared runtime global, and the manifest's component
 *          names are looked up on it. The result has the SAME shape as the
 *          build-time virtual module's registries, and the two merge with
 *          the build-time entry winning per extension - a local extension
 *          keeps its bundled UI, an installed package needs no rebuild.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: pure functions here (tested); the store below fetches
 *          once per workspace and notifies subscribers; consumers read the
 *          merged registries through useRuntimeRegistries().
 */
import { useSyncExternalStore, type ComponentType } from 'react'
import type { AdminNavEntry, AdminAccessRule, RuntimeUiExtension, RuntimeUiManifest } from '@tangen/types'
import { SHARED_UI_GLOBAL, SHARED_UI_MODULES } from '@tangen/types'
import { adminFetch } from '@/lib/api'
import type { SlotItem } from '@/lib/slots'

export interface RuntimePage { path: string; component: ComponentType<any>; nav?: AdminNavEntry; access?: AdminAccessRule }
export interface RuntimeRegistries {
  pages: Record<string, RuntimePage[]>
  panels: Record<string, Record<string, ComponentType<any>>>
  slots: Record<string, SlotItem[]>
  commands: Record<string, Array<{ label: string; icon?: string; to: string }>>
}

export const EMPTY_REGISTRIES: RuntimeRegistries = { pages: {}, panels: {}, slots: {}, commands: {} }

type LoadedModule = Record<string, unknown> | null

const componentOf = (mod: LoadedModule, name: string): ComponentType<any> | null => {
  const c = mod?.[name]
  return typeof c === 'function' || (c && typeof c === 'object') ? (c as ComponentType<any>) : null
}

/** One extension's runtime entry and its loaded module (null without a bundle) onto the registries. */
export function registriesFromRuntime(entry: RuntimeUiExtension, mod: LoadedModule): RuntimeRegistries {
  const out: RuntimeRegistries = { pages: {}, panels: {}, slots: {}, commands: {} }
  if (entry.commands.length) out.commands[entry.id] = entry.commands.map((c) => ({ label: c.label, to: c.to, ...(typeof c.icon === 'string' ? { icon: c.icon } : {}) }))
  if (!mod) return out
  const pages: RuntimePage[] = []
  for (const p of entry.pages) {
    const component = componentOf(mod, p.component)
    if (!component) continue
    pages.push({ path: p.path, component, ...(p.nav !== undefined ? { nav: p.nav as AdminNavEntry } : {}), ...(p.access !== undefined ? { access: p.access as AdminAccessRule } : {}) })
  }
  if (pages.length) out.pages[entry.id] = pages
  const panels: Record<string, ComponentType<any>> = {}
  for (const p of entry.sidebarPanels) { const component = componentOf(mod, p.component); if (component) panels[p.id] = component }
  if (Object.keys(panels).length) out.panels[entry.id] = panels
  const slots: SlotItem[] = []
  for (const s of entry.slots) {
    const component = componentOf(mod, s.component)
    if (!component) continue
    slots.push({ extensionId: entry.id, slot: s.slot, id: s.id, component, ...(s.label !== undefined ? { label: s.label } : {}), ...(s.priority !== undefined ? { priority: s.priority } : {}), ...(s.access !== undefined ? { access: s.access } : {}) })
  }
  if (slots.length) out.slots[entry.id] = slots
  return out
}

/** Build-time wins per extension id, in every registry; runtime fills the rest. */
export function mergeRegistries(buildTime: RuntimeRegistries, runtime: RuntimeRegistries): RuntimeRegistries {
  const buildIds = new Set([...Object.keys(buildTime.pages), ...Object.keys(buildTime.panels), ...Object.keys(buildTime.slots), ...Object.keys(buildTime.commands)])
  const pick = <T,>(bt: Record<string, T>, rt: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = { ...bt }
    for (const [id, v] of Object.entries(rt)) if (!buildIds.has(id)) out[id] = v
    return out
  }
  return { pages: pick(buildTime.pages, runtime.pages), panels: pick(buildTime.panels, runtime.panels), slots: pick(buildTime.slots, runtime.slots), commands: pick(buildTime.commands, runtime.commands) }
}

/** Publishes the shared modules where a bundle's rewritten imports read them. */
export function exposeSharedRuntime(modules: Record<(typeof SHARED_UI_MODULES)[number], unknown>, target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): void {
  const table: Record<string, unknown> = {}
  for (const name of SHARED_UI_MODULES) table[name] = modules[name]
  target[SHARED_UI_GLOBAL] = table
}

// ── The store: one load per workspace, subscribers re-render on arrival ───────

let state: { workspaceId: string | null; registries: RuntimeRegistries; loaded: boolean } = { workspaceId: null, registries: EMPTY_REGISTRIES, loaded: false }
const listeners = new Set<() => void>()
const notify = () => { for (const l of listeners) l() }
let inflight: Promise<void> | null = null

async function loadBundle(url: string): Promise<LoadedModule> {
  try {
    return await import(/* @vite-ignore */ url) as Record<string, unknown>
  } catch (e) {
    if (typeof console !== 'undefined') console.warn(`[tangen] extension bundle ${url} failed to load`, e)
    return null
  }
}

export async function loadRuntimeExtensions(workspaceId: string, opts: { fetchManifest?: () => Promise<RuntimeUiManifest>; importBundle?: (url: string) => Promise<LoadedModule> } = {}): Promise<RuntimeRegistries> {
  const fetchManifest = opts.fetchManifest ?? (() => adminFetch<RuntimeUiManifest>('/admin/ui-manifest'))
  const importBundle = opts.importBundle ?? loadBundle
  const manifest = await fetchManifest().catch(() => ({ version: 1 as const, extensions: [] }))
  const merged: RuntimeRegistries = { pages: {}, panels: {}, slots: {}, commands: {} }
  for (const entry of manifest.extensions) {
    const mod = entry.bundle ? await importBundle(entry.bundle.url) : null
    const r = registriesFromRuntime(entry, mod)
    Object.assign(merged.pages, r.pages); Object.assign(merged.panels, r.panels); Object.assign(merged.slots, r.slots); Object.assign(merged.commands, r.commands)
  }
  state = { workspaceId, registries: merged, loaded: true }
  notify()
  return merged
}

function ensureLoaded(workspaceId: string): void {
  if (state.workspaceId === workspaceId && (state.loaded || inflight)) return
  state = { workspaceId, registries: EMPTY_REGISTRIES, loaded: false }
  inflight = loadRuntimeExtensions(workspaceId).then(() => { inflight = null }, () => { inflight = null })
}

/** Forget what was loaded (an install or uninstall in this session; tests). */
export function resetRuntimeExtensions(): void {
  state = { workspaceId: null, registries: EMPTY_REGISTRIES, loaded: false }
  inflight = null
  notify()
}

/** The runtime registries for a workspace; empty until the manifest and bundles arrive. */
export function useRuntimeRegistries(workspaceId: string | undefined): RuntimeRegistries {
  const snapshot = useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => (state.workspaceId === workspaceId ? state.registries : EMPTY_REGISTRIES),
    () => EMPTY_REGISTRIES,
  )
  if (workspaceId && typeof window !== 'undefined') ensureLoaded(workspaceId)
  return snapshot
}
