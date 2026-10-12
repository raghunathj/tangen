/**
 * File Name: extension-ui.ts
 * Purpose: The ONE view of extension UI the Admin's screens read (Extension
 *          Kernel K7.3): the build-time registries from the Vite virtual
 *          module (local extensions, compiled into the Admin) merged with
 *          the runtime registries (installed extensions, loaded from their
 *          bundles), build-time winning per extension. Screens call
 *          `useExtensionUi(workspaceId)` instead of importing the virtual
 *          module, so an installed extension appears without a rebuild.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: imports the Vite virtual module, which bun tests
 *          cannot resolve - the pure merge lives in runtime-extensions.ts.
 */
import { useMemo } from 'react'
import { EXTENSION_PANELS, EXTENSION_PAGES, EXTENSION_COMMANDS, EXTENSION_SLOTS } from 'virtual:tangen/extension-panels'
import { mergeRegistries, useRuntimeRegistries, type RuntimeRegistries } from '@/lib/runtime-extensions'

export const BUILD_TIME_REGISTRIES: RuntimeRegistries = {
  pages: EXTENSION_PAGES as RuntimeRegistries['pages'],
  panels: EXTENSION_PANELS as RuntimeRegistries['panels'],
  slots: EXTENSION_SLOTS as RuntimeRegistries['slots'],
  commands: EXTENSION_COMMANDS as RuntimeRegistries['commands'],
}

export function useExtensionUi(workspaceId: string | undefined): RuntimeRegistries {
  const runtime = useRuntimeRegistries(workspaceId)
  return useMemo(() => mergeRegistries(BUILD_TIME_REGISTRIES, runtime), [runtime])
}
