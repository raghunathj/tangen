/**
 * File Name: runtime-ui.ts
 * Purpose: The runtime UI manifest (Extension Kernel K7.3,
 *          tasks/plan-extension-kernel.md): what the Admin needs to show an
 *          installed extension's UI WITHOUT a rebuild. Per ACTIVE extension,
 *          the descriptors the Admin mounts (pages, sidebar panels, slots by
 *          effective grants, commands, whether it has typed settings) and
 *          where its built client bundle is, if it has one. The bundle is
 *          an ES module whose imports of the modules the Admin already
 *          ships (SHARED_UI_MODULES) read the Admin's shared runtime global
 *          (SHARED_UI_GLOBAL) - one React, one router, one kit. Pure.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { TangenExtensionManifest } from './extension'
import { allowedSlotContributions, type ExtensionSlotContribution } from './admin-slots'

/** The modules an extension bundle never carries: the Admin exposes them on SHARED_UI_GLOBAL. */
export const SHARED_UI_MODULES = [
  'react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'react-router-dom', '@tangen/ui', '@tangen/icons',
] as const
export type SharedUiModule = (typeof SHARED_UI_MODULES)[number]

/** `globalThis.__tangen_ui__[moduleName]` - what a bundled import of a shared module reads. */
export const SHARED_UI_GLOBAL = '__tangen_ui__'

export interface RuntimeUiPage { path: string; component: string; nav?: unknown; access?: unknown }
export interface RuntimeUiPanel { id: string; label: string; component: string; icon?: unknown; placement?: unknown }
export interface RuntimeUiCommand { label: string; icon?: unknown; to: string }

export interface RuntimeUiExtension {
  id: string
  version: string
  pages: RuntimeUiPage[]
  sidebarPanels: RuntimeUiPanel[]
  /** Items this extension may fill, by its effective grants (K7.2). */
  slots: ExtensionSlotContribution[]
  commands: RuntimeUiCommand[]
  /** Declares typed manifest settings (K7.1). */
  settings: boolean
  /** The built client bundle, null when the extension ships its UI through the Admin build only. */
  bundle: { url: string } | null
}

export interface RuntimeUiManifest { version: 1; extensions: RuntimeUiExtension[] }

export function buildRuntimeUiManifest(input: {
  manifests: ReadonlyArray<TangenExtensionManifest>
  activeIds: ReadonlySet<string>
  /** The extension's effective grants; null for the trusted class. */
  /** The extension's effective grants (E.14: never null; a grantless manifest holds nothing). */
  grantsOf: (extensionId: string) => readonly string[]
  bundleFor: (extensionId: string, manifest: TangenExtensionManifest) => { url: string } | null
}): RuntimeUiManifest {
  const extensions: RuntimeUiExtension[] = []
  for (const m of input.manifests) {
    if (!input.activeIds.has(m.id)) continue
    extensions.push({
      id: m.id,
      version: m.version,
      pages: (m.pages ?? []).map((p) => ({ path: p.path, component: p.component, ...(p.nav !== undefined ? { nav: p.nav } : {}), ...(p.access !== undefined ? { access: p.access } : {}) })),
      sidebarPanels: (m.sidebarPanels ?? []).map((p) => ({
        id: p.id, label: p.label, component: String((p as { component?: unknown }).component ?? ''),
        ...((p as { icon?: unknown }).icon !== undefined ? { icon: (p as { icon?: unknown }).icon } : {}),
        ...((p as { placement?: unknown }).placement !== undefined ? { placement: (p as { placement?: unknown }).placement } : {}),
      })),
      slots: allowedSlotContributions(m, input.grantsOf(m.id)),
      commands: (m.commands ?? []).map((c) => ({ label: c.label, to: c.to, ...(c.icon !== undefined ? { icon: c.icon } : {}) })),
      settings: Boolean(m.settings),
      bundle: input.bundleFor(m.id, m),
    })
  }
  return { version: 1, extensions }
}
