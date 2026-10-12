/**
 * File Name: extension-registry.ts
 * Purpose: RETIRED compile-time extension registry. Extensions are now
 *   discovered from workspace config `extensions: [{ resolve }]` entries —
 *   the loader imports each extension's tangen.extension.ts manifest and the
 *   admin build resolves panels from the same source at build time.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The lookup functions are kept (returning empty) for one
 *   release cycle so stray imports fail soft; new code should read manifests
 *   from WorkspaceProject.extensions instead.
 */

import type { TangenExtensionManifest } from './extension'

const _REGISTRY: TangenExtensionManifest[] = []

/** @deprecated Extensions resolve from workspace config — see WorkspaceProject.extensions. */
export const BUILT_IN_EXTENSIONS: ReadonlyArray<TangenExtensionManifest> = _REGISTRY

/** @deprecated Extensions resolve from workspace config — see WorkspaceProject.extensions. */
export function getBuiltInExtension(id: string): TangenExtensionManifest | undefined {
  return _REGISTRY.find((e) => e.id === id)
}

/** @deprecated Extensions resolve from workspace config — see WorkspaceProject.extensions. */
export function listBuiltInExtensions(): TangenExtensionManifest[] {
  return [..._REGISTRY]
}
