/**
 * File Name: extension-config.ts
 * Purpose: One reading of "which extensions does this configuration declare"
 *          (closure plan Phase 6C, Units 1, 2 and 9). `extensions` is the
 *          canonical key; `plugins` and `apps` are the older spellings, read
 *          here as deprecated aliases so every caller - the CLI, the
 *          workspace loader, the extension routes - resolves an ambiguous
 *          config identically.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This answers what a config DECLARES. It says nothing
 *          about what is installed or enabled: that state lives in the
 *          database per workspace and environment (Phase 4), and a code
 *          declaration never overrides an operator's disable or uninstall.
 */
import type { TangenExtension } from './config'

/** The keys that have ever declared extensions, canonical first. */
export const EXTENSION_CONFIG_KEYS = ['extensions', 'plugins', 'apps'] as const
export type ExtensionConfigKey = (typeof EXTENSION_CONFIG_KEYS)[number]

export interface ConfiguredExtensions {
  /** The declared entries, in the order the author wrote them. */
  entries: TangenExtension[]
  /** Which key carried them, or null when the config declares none. */
  key: ExtensionConfigKey | null
  /** True when that key is one of the older spellings. */
  deprecated: boolean
  /** Other keys that also carried a list and were ignored. Absent when none did. */
  ignored?: ExtensionConfigKey[]
}

/** A config shape loose enough for every caller: root config, workspace config, loaded project. */
type ExtensionCarrier = Partial<Record<ExtensionConfigKey, unknown>> | null | undefined

/**
 * The extensions a configuration declares, read through one precedence:
 * `extensions`, then `plugins`, then `apps`. A key only counts when it
 * carries an array, so a stray scalar cannot shadow a real declaration.
 */
export function configuredExtensions(config: ExtensionCarrier): ConfiguredExtensions {
  const present = EXTENSION_CONFIG_KEYS.filter((k) => Array.isArray((config as Record<string, unknown> | null)?.[k]))
  const key = present[0] ?? null
  if (!key) return { entries: [], key: null, deprecated: false }
  const ignored = present.slice(1)
  return {
    entries: (config as Record<string, unknown>)[key] as TangenExtension[],
    key,
    deprecated: key !== 'extensions',
    ...(ignored.length > 0 ? { ignored } : {}),
  }
}

/**
 * The sentence to print when a config uses an older spelling, or null when it
 * does not. One sentence, at config load - not per request.
 */
export function extensionConfigNotice(read: ConfiguredExtensions, where: string): string | null {
  if (!read.deprecated && !read.ignored) return null
  if (read.ignored) {
    return `${where}: extensions are declared under "${read.key}" and also under ${read.ignored.map((k) => `"${k}"`).join(', ')}; only "${read.key}" is used. Keep one, and prefer "extensions".`
  }
  return `${where}: "${read.key}" is the old name for "extensions" and will be removed in v1. Rename the key; the value is unchanged.`
}
