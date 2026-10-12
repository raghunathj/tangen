/**
 * File Name: extension-settings.ts
 * Purpose: Typed manifest settings at runtime (Extension Kernel K7.1,
 *          tasks/plan-extension-kernel.md). One entry in the extension's own
 *          store under SETTINGS_STORE_KEY holds `{ version, values }`;
 *          secrets are sealed there under the deployment's connections key
 *          and opened only for `get()` - the API's `read()` answers
 *          `{ set }` in their place. A stored entry older than the
 *          manifest's `settingsVersion` goes through the server entry's
 *          `migrateSettings` once, is validated, and written back. Every
 *          write validates against the codec first; nothing half-valid is
 *          stored.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { compileSettings, unavailableSettings, unavailableSettingMessage, SETTINGS_STORE_KEY, SETTINGS_LEGACY_KEY, type ExtensionStore, type SettingsCodec, type SettingsFieldDescriptor, type TangenExtensionManifest, type TangenExtensionServer } from '@tangen/types'
import { RequestError } from '../lib/errors'
import { sealSecret, openSecret, type SealedKey } from '../lib/sealed'

export interface ExtensionSettingsService {
  /** The effective values for the extension: defaults, then what is stored, secrets opened. */
  get<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T>
  /** What the API answers: redacted values, the descriptors, the version, and the fields unavailable because a grant they require is not held (E.15). */
  read(): Promise<{ values: Record<string, unknown>; fields: SettingsFieldDescriptor[]; version: number; unavailable: Record<string, { grant: string; message: string }> }>
  /** The fields marked `public` (E.18): defaults under the saved values, unavailable fields excluded, never a secret. What a website reads. */
  readPublic(): Promise<Record<string, unknown>>
  /** Validates a patch, seals its secrets, merges and stores; `null` clears an optional field. Throws a 422 RequestError with fieldErrors. */
  update(patch: Record<string, unknown>): Promise<Record<string, unknown>>
  codec: SettingsCodec
  version: number
}

export interface ExtensionSettingsDeps {
  extensionId: string
  manifest: Pick<TangenExtensionManifest, 'settings' | 'settingsVersion'>
  server?: Pick<TangenExtensionServer, 'migrateSettings'> | null
  store: ExtensionStore
  key: SealedKey
  /** The installation's effective grants; a field with `requires` outside them is unavailable (E.15). Absent = none held. */
  grants?: readonly string[]
  /**
   * Told after a successful write, with the keys whose value actually moved.
   * The caller decides who hears it (the admin route tells the extension's
   * server); the service only knows the diff.
   */
  onChanged?: (changed: string[]) => void
}

interface StoredSettings { version: number; values: Record<string, unknown> }

/** A secret sealed under another key: present, not readable here. */
const UNREADABLE = Symbol('unreadable')

/**
 * Whether a stored value and a submitted one are the same answer. A settings
 * value is a scalar or a small JSON structure (a mapping, a list of ids), so
 * a stable stringify is the honest comparison and a re-save of the same form
 * reports no change.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  return stable(a) === stable(b)
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

export function createExtensionSettings(deps: ExtensionSettingsDeps): ExtensionSettingsService {
  const codec = compileSettings(deps.manifest.settings ?? {})
  const version = deps.manifest.settingsVersion ?? 1
  const secrets = new Set(codec.secretKeys())
  // E.15: a field that requires a grant the installation does not hold. Its stored value is never what get() answers.
  const unavailable: Record<string, { grant: string; message: string }> = {}
  for (const u of unavailableSettings(deps.manifest.settings, deps.grants ?? [])) unavailable[u.key] = { grant: u.grant, message: unavailableSettingMessage(deps.extensionId, u.grant) }
  const withoutUnavailable = (values: Record<string, unknown>) => {
    const out = { ...values }
    for (const k of Object.keys(unavailable)) delete out[k]
    return out
  }

  /** The stored entry, migrated forward when older than the manifest; secrets still sealed. */
  const load = async (): Promise<StoredSettings> => {
    let raw = await deps.store.get(SETTINGS_STORE_KEY)
    if (!raw) {
      // E: a migration copied the legacy settings under SETTINGS_LEGACY_KEY; the first read seeds from it, once.
      const legacy = await deps.store.get(SETTINGS_LEGACY_KEY)
      if (legacy && typeof legacy === 'object') {
        const known = Object.fromEntries(Object.entries(legacy).filter(([k]) => k in (deps.manifest.settings ?? {})))
        const checked = codec.validate(known, { partial: true })
        const seeded: StoredSettings = { version, values: sealAll(checked.value) }
        await deps.store.put(SETTINGS_STORE_KEY, seeded as never)
        await deps.store.remove(SETTINGS_LEGACY_KEY)
        raw = seeded as never
      }
    }
    if (!raw) return { version, values: {} }
    let stored: StoredSettings = { version: Number(raw.version ?? 1), values: { ...((raw.values as Record<string, unknown>) ?? {}) } }
    if (stored.version < version && typeof deps.server?.migrateSettings === 'function') {
      // Open secrets for the migration so it sees real values, seal them again after.
      const opened = openAll(stored.values)
      const migrated = await deps.server.migrateSettings(opened as Record<string, unknown>, stored.version)
      const checked = codec.validate(migrated ?? {}, { partial: true })
      if (!checked.ok) throw new RequestError('SETTINGS_MIGRATION_INVALID', `migrateSettings for '${deps.extensionId}' produced invalid settings: ${checked.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`, 500)
      stored = { version, values: sealAll(checked.value) }
      await deps.store.put(SETTINGS_STORE_KEY, stored as never)
    }
    return stored
  }
  const openAll = (values: Record<string, unknown>): Record<string, unknown | typeof UNREADABLE> => {
    const out: Record<string, unknown> = { ...values }
    for (const k of secrets) {
      if (typeof out[k] !== 'string') continue
      try { out[k] = openSecret<{ v: string }>(deps.key, out[k] as string).v } catch { out[k] = UNREADABLE }
    }
    return out
  }
  const sealAll = (values: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...values }
    for (const k of secrets) if (typeof out[k] === 'string') out[k] = sealSecret(deps.key, { v: out[k] })
    return out
  }
  const effective = (values: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...codec.defaults() }
    for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined) out[k] = v
    return out
  }

  return {
    codec, version,
    async get() {
      const stored = await load()
      const opened = withoutUnavailable(openAll(stored.values))
      for (const k of secrets) if (opened[k] === UNREADABLE) delete opened[k]
      return effective(opened) as never
    },
    async read() {
      const stored = await load()
      const opened = withoutUnavailable(openAll(stored.values))
      const values = codec.redact(effective(Object.fromEntries(Object.entries(opened).filter(([, v]) => v !== UNREADABLE))))
      for (const k of secrets) if (opened[k] === UNREADABLE) values[k] = { set: false, unreadable: true }
      return { values, fields: codec.fields(), version: stored.version, unavailable: { ...unavailable } }
    },
    async readPublic() {
      const stored = await load()
      const opened = withoutUnavailable(openAll(stored.values))
      for (const k of secrets) delete opened[k]
      const all = effective(opened)
      const keys = new Set(codec.publicKeys())
      // An unavailable field is not served at all: a website must not see a default that reads as a decision.
      return Object.fromEntries(Object.entries(all).filter(([k]) => keys.has(k) && !secrets.has(k) && !(k in unavailable)))
    },
    async update(patch) {
      for (const [k, v] of Object.entries(patch)) {
        const u = unavailable[k]
        if (u && v !== null && v !== undefined && v !== codec.defaults()[k]) throw new RequestError('SETTING_NEEDS_GRANT', `Setting '${k}' cannot be enabled: ${u.message}`, 422, { [k]: u.message })
      }
      const checked = codec.validate(patch, { partial: true })
      if (!checked.ok) {
        const fieldErrors = Object.fromEntries(checked.errors.map((e) => [e.path || '_', e.message]))
        throw new RequestError('VALIDATION_ERROR', `Settings do not match the definition: ${checked.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`, 422, fieldErrors)
      }
      const stored = await load()
      const before = openAll(stored.values)
      const next: Record<string, unknown> = { ...stored.values }
      const changed: string[] = []
      for (const [k, v] of Object.entries(checked.value)) {
        if (v === null) delete next[k]
        else next[k] = secrets.has(k) ? sealSecret(deps.key, { v }) : v
        // A SECRET counts as changed whenever one is submitted: a re-seal of
        // the same value is a different ciphertext, and comparing would mean
        // opening both to look at them.
        if (secrets.has(k)) { changed.push(k); continue }
        const was = before[k]
        if (v === null ? was !== undefined : !sameValue(was, v)) changed.push(k)
      }
      await deps.store.put(SETTINGS_STORE_KEY, { version, values: next } as never)
      if (changed.length > 0) deps.onChanged?.(changed)
      return effective(Object.fromEntries(Object.entries(openAll(next)).filter(([, v]) => v !== UNREADABLE)))
    },
  }
}
