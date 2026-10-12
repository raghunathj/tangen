/**
 * File Name: extension-channels.ts
 * Purpose: The registry of realtime channels extensions declare in their
 *          manifests (`realtime.channels`), with the boot-time validation
 *          that makes a bad declaration an error naming the extension.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R4 of tasks/plan-realtime.md (section 4.8) and the
 *          architecture's sections 25-29: a declared channel is what makes
 *          `ext:<extensionId>:<name>` discoverable, permission-aware and
 *          governable. This module knows nothing of the hub or the
 *          authorizer on purpose: authorize.ts reads the registry to decide
 *          a subscribe, extension-publisher.ts reads it to refuse an
 *          undeclared publish, and neither import cycles back here.
 *
 *          Validation is strict (unknown keys refused) because the manifest
 *          is browser-safe JSON an extension author writes once: a typo
 *          like `capabilty` would otherwise open the channel to every
 *          member silently. The name grammar is the topic grammar's inner
 *          segment minus the colon, so `ext:<id>:<name>` always parses as
 *          exactly three parts. The registry is process-level like the
 *          extension registry it mirrors (hooks/app-hooks-registry.ts) and
 *          is reset the same way on a dev reload.
 */
import type { ExtensionRealtimeChannel, WorkspaceProject } from '@tangen/types'

/** A declaration as registered: defaults applied, nothing optional left. */
export interface RegisteredExtensionChannel {
  name: string
  capability: string | null
}

const NAME_RE = /^[a-z][a-z0-9_-]*$/
const NAME_MAX = 64
const CHANNEL_KEYS = new Set(['name', 'capability'])
const REALTIME_KEYS = new Set(['channels'])

const _channels = new Map<string, Map<string, RegisteredExtensionChannel>>()

const fail = (extensionId: string, what: string): never => {
  throw new Error(`extension "${extensionId}": realtime ${what}`)
}

/**
 * Validates a manifest's `realtime` block and returns the normalised
 * channels. Throws an Error naming the extension for anything outside the
 * documented shape.
 * @param extensionId - For the error message.
 * @param realtime - The manifest's `realtime` value, possibly undefined.
 */
export function validateExtensionRealtime(extensionId: string, realtime: unknown): RegisteredExtensionChannel[] {
  if (realtime === undefined || realtime === null) return []
  if (typeof realtime !== 'object' || Array.isArray(realtime)) fail(extensionId, 'must be an object with a `channels` array')
  for (const key of Object.keys(realtime as object)) {
    if (!REALTIME_KEYS.has(key)) fail(extensionId, `has an unknown key "${key}" (only \`channels\` is allowed)`)
  }
  const channels = (realtime as { channels?: unknown }).channels
  if (!Array.isArray(channels)) fail(extensionId, 'channels must be an array of { name, capability? }')
  const out: RegisteredExtensionChannel[] = []
  const seen = new Set<string>()
  for (const entry of channels as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(extensionId, 'channels must hold objects of { name, capability? }')
    const channel = entry as Record<string, unknown>
    for (const key of Object.keys(channel)) {
      if (!CHANNEL_KEYS.has(key)) fail(extensionId, `channel has an unknown key "${key}" (allowed: name, capability)`)
    }
    const name = channel.name
    if (typeof name !== 'string' || name.length === 0 || name.length > NAME_MAX || !NAME_RE.test(name)) {
      fail(extensionId, `channel name ${JSON.stringify(name)} is not [a-z][a-z0-9_-]* of at most ${NAME_MAX} characters`)
    }
    if (seen.has(name as string)) fail(extensionId, `declares channel "${name}" twice`)
    seen.add(name as string)
    let capability: string | null = null
    if (channel.capability !== undefined) {
      if (typeof channel.capability !== 'string' || channel.capability.trim() === '') {
        fail(extensionId, `channel "${name}" capability must be a non-empty capability id`)
      }
      capability = channel.capability as string
    }
    out.push({ name: name as string, capability })
  }
  return out
}

/** Replaces the channels registered for one extension. */
export function registerExtensionChannels(extensionId: string, channels: RegisteredExtensionChannel[]): void {
  _channels.set(extensionId, new Map(channels.map((c) => [c.name, c])))
}

/** The declaration behind `ext:<extensionId>:<name>`, or null when none. */
export function getExtensionChannel(extensionId: string, name: string): RegisteredExtensionChannel | null {
  return _channels.get(extensionId)?.get(name) ?? null
}

/** Every registered channel, tagged with its extension (diagnostics, docs). */
export function listExtensionChannels(): Array<RegisteredExtensionChannel & { extensionId: string }> {
  const out: Array<RegisteredExtensionChannel & { extensionId: string }> = []
  for (const [extensionId, channels] of _channels) {
    for (const c of channels.values()) out.push({ extensionId, ...c })
  }
  return out
}

/** Forgets every registration (dev reload, tests). */
export function resetExtensionChannels(): void {
  _channels.clear()
}

/**
 * Registers the channels of every loaded extension manifest. Called at boot
 * after the extension servers load; throws for the first manifest whose
 * `realtime` block is malformed, so a bad declaration is a boot error.
 * @param projects - The loaded workspace projects (their resolved extensions).
 */
export function registerExtensionRealtimeChannels(projects: WorkspaceProject[]): void {
  const seen = new Set<string>()
  for (const project of projects) {
    for (const ext of project.extensions ?? []) {
      if (seen.has(ext.id)) continue
      seen.add(ext.id)
      const manifest = ext.manifest as { realtime?: { channels: ExtensionRealtimeChannel[] } } | undefined
      const channels = validateExtensionRealtime(ext.id, manifest?.realtime)
      if (channels.length > 0) registerExtensionChannels(ext.id, channels)
    }
  }
}
