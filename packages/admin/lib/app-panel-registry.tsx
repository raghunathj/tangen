/**
 * File Name: app-panel-registry.tsx
 * Purpose: Editor panel registry — resolves extension sidebar panels (built
 *          at vite time into virtual:tangen/extension-panels) into the
 *          components the object editor renders, keyed `extensionId:panelId`
 *          so multi-panel extensions render every panel distinctly (C4).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: ExtensionPanelProps is the props contract documented in
 *          docs/extending-admin.md; the editor page supplies them.
 */
import type { ComponentType } from 'react'
import { EXTENSION_PANELS } from 'virtual:tangen/extension-panels'
import { useMemo } from 'react'
import { useRuntimeRegistries } from '@/lib/runtime-extensions'

export interface ExtensionPanelProps {
  title?: string
  content?: string
  fieldValues?: Record<string, unknown>
  objectUrl?: string
  /** The object's id — empty string on the /new editor (not yet created). */
  objectId?: string
  /** The object's lifecycle status ('draft' | 'published' | 'scheduled' | 'archived'; 'draft' on /new). */
  status?: string
  /** Re-runs the editor's object load (data + audit + i18n + panel data). */
  refresh?: () => void
  panelData?: Record<string, unknown>
  onPanelDataChange?: (data: Record<string, unknown>) => void
  /** The locale the editor is currently working in; the default locale when unset. */
  activeLocale?: string | null
  /** The workspace's configured locales, in order; empty when localization is off. */
  locales?: { code: string; label: string }[]
  /** The default (base) locale, or null when localization is off. */
  defaultLocale?: string | null
  /**
   * Content AI context for panels. `fill` generates plain text steered by the
   * workspace guidelines and the object's current values — pass an instruction
   * describing exactly what to write (e.g. an SEO meta description).
   */
  ai?: {
    available: boolean
    fill: (instruction: string) => Promise<string>
    /** Opens the AI Assistant tagged with this panel's declared fields (when the manifest declares ai.fields). */
    openAssistant?: () => void
  }
}

/** The registry key for one panel: `extensionId:panelId`. */
export function panelRegistryKey(extensionId: string, panelId: string): string {
  return `${extensionId}:${panelId}`
}

/**
 * Flattens { extensionId: { panelId: Component } } into a registry keyed by
 * `extensionId:panelId`. The previous registry keyed by extensionId alone and
 * kept only the FIRST panel — every panel of a multi-panel extension rendered
 * the same component.
 */
export function buildPanelRegistry(
  panelsByExtension: Record<string, Record<string, ComponentType<ExtensionPanelProps> | undefined>>,
): Record<string, ComponentType<ExtensionPanelProps>> {
  const out: Record<string, ComponentType<ExtensionPanelProps>> = {}
  for (const [extensionId, panels] of Object.entries(panelsByExtension)) {
    for (const [panelId, component] of Object.entries(panels ?? {})) {
      if (component) out[panelRegistryKey(extensionId, panelId)] = component
    }
  }
  return out
}

/**
 * Panel components resolved at BUILD time from the workspace configs'
 * extension resolve paths (virtual:tangen/extension-panels), keyed
 * `extensionId:panelId`.
 */
export const PANEL_REGISTRY: Record<string, ComponentType<ExtensionPanelProps>> =
  buildPanelRegistry(EXTENSION_PANELS)

/**
 * The panel registry a screen reads (Extension Kernel K7.3): the build-time
 * PANEL_REGISTRY plus the panels installed extensions loaded at runtime,
 * build-time winning per key.
 */
export function usePanelRegistry(workspaceId: string | undefined): Record<string, ComponentType<ExtensionPanelProps>> {
  const runtime = useRuntimeRegistries(workspaceId)
  return useMemo(() => {
    const out: Record<string, ComponentType<ExtensionPanelProps>> = {}
    for (const [extensionId, panels] of Object.entries(runtime.panels)) {
      for (const [panelId, component] of Object.entries(panels)) out[panelRegistryKey(extensionId, panelId)] = component as ComponentType<ExtensionPanelProps>
    }
    return { ...out, ...PANEL_REGISTRY }
  }, [runtime])
}
