/**
 * File Name: extension-settings.ts
 * Purpose: Typed manifest `settings` (Extension Kernel K7.1,
 *          tasks/plan-extension-kernel.md; plan-framework-extensibility §29).
 *          An extension declares its operator-editable settings once, as
 *          plain descriptors built with `settings.boolean()`, `.number()`,
 *          `.string()`, `.select()`, `.secret()`, `.connection()`; the
 *          platform desugars that into a codec (validation + defaults), a
 *          store entry, a core API and a generated Admin form. A descriptor
 *          is data - JSON round-trips it - so a manifest stays reviewable and
 *          the Admin can draw the form without the extension's code. Pure.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { compileGrants } from './extension-grants'

export type SettingsFieldKind = 'boolean' | 'number' | 'string' | 'select' | 'secret' | 'connection' | 'resource' | 'date' | 'list'

interface FieldBase {
  kind: SettingsFieldKind
  label?: string
  description?: string
  /** Absent AND no default: a value is required. */
  optional?: boolean
  /**
   * A grant the installation must hold for this setting to take effect (E.15).
   * Without it the field is unavailable: the form shows it disabled with the
   * reason, `get()` answers the default whatever is stored, and enabling it is
   * refused naming the missing grant - configuration never implies authority.
   */
  requires?: string
  /**
   * Served to websites (E.18): core answers the field on the extension's public
   * mount, `GET /api/v1/ext/<id>/settings`, and the SDK reads it with
   * `client.extensionSettings(id)`. Never a secret or a connection.
   */
  public?: boolean
}
export interface BooleanSettingsField extends FieldBase { kind: 'boolean'; default?: boolean }
export interface NumberSettingsField extends FieldBase { kind: 'number'; default?: number; min?: number; max?: number; integer?: boolean }
export interface StringSettingsField extends FieldBase { kind: 'string'; default?: string; minLength?: number; maxLength?: number; pattern?: string }
export interface SelectSettingsField extends FieldBase { kind: 'select'; options: string[]; default?: string }
/** Stored sealed under the deployment's connections key; never read back through the API. */
export interface SecretSettingsField extends FieldBase { kind: 'secret' }
/**
 * The id of a connection of the named PROVIDER (Settings → Connections). The
 * value is a connection id, never a label, so renaming one changes nothing.
 * `capabilities` (provider-relative, e.g. `sheets.append`) tells the picker
 * what this setting will do, so a connection that was never authorized for it
 * says so at configuration time rather than at the first run.
 */
export interface ConnectionSettingsField extends FieldBase {
  kind: 'connection'
  /** A provider (`google`); a connector id still resolves, for older manifests. */
  connector: string
  capabilities?: string[]
}

/**
 * The id of something INSIDE a connection: a spreadsheet, a tab, a channel.
 * `dependsOn` names the key of the `connection` field that chose the
 * connection, and `parent` the key of the resource field this one is listed
 * within (a tab needs a spreadsheet). Both values are ids.
 */
export interface ResourceSettingsField extends FieldBase {
  kind: 'resource'
  /** A provider (`google`). */
  connector: string
  /** The connector's resource type: `spreadsheet`, `tab`, `channel`. */
  resource: string
  /** The key of the `connection` field this resource is read through. */
  dependsOn: string
  /** The key of the resource field that supplies `parent`, when the type needs one. */
  parent?: string
}
/**
 * A calendar day, stored as `YYYY-MM-DD`. A date typed into a text field is a
 * date typed wrong eventually, so the Admin draws a picker.
 */
export interface DateSettingsField extends FieldBase { kind: 'date'; default?: string }

/** A list of strings, optionally limited to `options` (a multi-pick in the Admin). */
export interface ListSettingsField extends FieldBase {
  kind: 'list'
  options?: string[]
  /** Options resolved by the host at render: the workspace's content type names (E.7). Values are validated as strings; the form offers the types. */
  optionsFrom?: 'content-types'
  default?: string[]
}

export type SettingsField = BooleanSettingsField | NumberSettingsField | StringSettingsField | SelectSettingsField | SecretSettingsField | ConnectionSettingsField | ResourceSettingsField | DateSettingsField | ListSettingsField
export type ExtensionSettingsDefinition = Record<string, SettingsField>

/** What the API and the Admin form see: the descriptor plus its key, in declaration order. */
export type SettingsFieldDescriptor = SettingsField & { key: string }

export interface SettingsIssue { path: string; message: string }

/** The store entry, under SETTINGS_STORE_KEY in the extension's own store: the version it was written at and the values (secrets sealed). */
export const SETTINGS_STORE_KEY = '__settings'
/**
 * A plain values object an extension's SQL migration writes under this key
 * (its legacy settings, copied in SQL so nothing races the seal); the first
 * read seeds SETTINGS_STORE_KEY from it - validated, secrets sealed - and
 * removes it. Ignored once a settings entry exists.
 */
export const SETTINGS_LEGACY_KEY = '__settings_legacy'

// ── Builders: chainable, but every call returns a PLAIN object ─────────────────

function withProp<T extends SettingsField>(field: T, patch: Partial<T>): T & Builder<T> {
  return chain({ ...field, ...patch })
}
type Builder<T extends SettingsField> = {
  label(label: string): T & Builder<T>
  describe(description: string): T & Builder<T>
  optional(): T & Builder<T>
  requires(grant: string): T & Builder<T>
  public(): T & Builder<T>
} & (T extends { default?: infer D } ? { default(value: D): T & Builder<T> } : Record<never, never>)
  & (T extends NumberSettingsField ? { min(v: number): T & Builder<T>; max(v: number): T & Builder<T>; integer(): T & Builder<T> } : Record<never, never>)
  & (T extends StringSettingsField ? { minLength(v: number): T & Builder<T>; maxLength(v: number): T & Builder<T>; pattern(re: string): T & Builder<T> } : Record<never, never>)
  & (T extends ListSettingsField ? { options(values: string[]): T & Builder<T>; optionsFrom(source: 'content-types'): T & Builder<T> } : Record<never, never>)
  // The connector-shaped builders (`connection`, `resource`) carry their
  // methods on the BASE type rather than behind another conditional: two more
  // conditional intersections pushed `withProp`'s union past what TypeScript
  // will represent (TS2590). The runtime prototype installs each method only
  // for the kind that has it, and validateSettingsDefinition refuses the
  // combinations the types no longer forbid - `dependsOn` on a string field
  // is a manifest error with a message, not a silent success.
  & { capabilities(values: string[]): T & Builder<T>; dependsOn(key: string): T & Builder<T>; parent(key: string): T & Builder<T> }

/** The builder methods live on a prototype: `JSON.stringify` and `Object.keys` see only the descriptor. */
function chain<T extends SettingsField>(field: T): T & Builder<T> {
  const proto: Record<string, unknown> = {
    label(this: T, label: string) { return withProp(this, { label } as unknown as Partial<T>) },
    describe(this: T, description: string) { return withProp(this, { description } as unknown as Partial<T>) },
    optional(this: T) { return withProp(this, { optional: true } as unknown as Partial<T>) },
    requires(this: T, grant: string) { return withProp(this, { requires: grant } as unknown as Partial<T>) },
    public(this: T) { return withProp(this, { public: true } as unknown as Partial<T>) },
  }
  if (field.kind !== 'secret') proto.default = function (this: T, value: unknown) { return withProp(this, { default: value } as unknown as Partial<T>) }
  if (field.kind === 'number') {
    proto.min = function (this: T, min: number) { return withProp(this, { min } as unknown as Partial<T>) }
    proto.max = function (this: T, max: number) { return withProp(this, { max } as unknown as Partial<T>) }
    proto.integer = function (this: T) { return withProp(this, { integer: true } as unknown as Partial<T>) }
  }
  if (field.kind === 'list') {
    proto.options = function (this: T, values: string[]) { return withProp(this, { options: [...values] } as unknown as Partial<T>) }
    proto.optionsFrom = function (this: T, source: 'content-types') { return withProp(this, { optionsFrom: source } as unknown as Partial<T>) }
  }
  if (field.kind === 'connection') {
    proto.capabilities = function (this: T, values: string[]) { return withProp(this, { capabilities: [...values] } as unknown as Partial<T>) }
  }
  if (field.kind === 'resource') {
    proto.dependsOn = function (this: T, key: string) { return withProp(this, { dependsOn: key } as unknown as Partial<T>) }
    proto.parent = function (this: T, key: string) { return withProp(this, { parent: key } as unknown as Partial<T>) }
  }
  if (field.kind === 'string') {
    proto.minLength = function (this: T, minLength: number) { return withProp(this, { minLength } as unknown as Partial<T>) }
    proto.maxLength = function (this: T, maxLength: number) { return withProp(this, { maxLength } as unknown as Partial<T>) }
    proto.pattern = function (this: T, pattern: string) { return withProp(this, { pattern } as unknown as Partial<T>) }
  }
  return Object.assign(Object.create(proto), field) as T & Builder<T>
}

export const settings = {
  boolean: () => chain<BooleanSettingsField>({ kind: 'boolean' }),
  number: () => chain<NumberSettingsField>({ kind: 'number' }),
  string: () => chain<StringSettingsField>({ kind: 'string' }),
  select: (options: string[]) => chain<SelectSettingsField>({ kind: 'select', options: [...options] }),
  secret: () => chain<SecretSettingsField>({ kind: 'secret' }),
  connection: (connector: string) => chain<ConnectionSettingsField>({ kind: 'connection', connector }),
  /** `settings.resource('google', 'spreadsheet').dependsOn('sheetConnection')` */
  // `dependsOn` is deliberately ABSENT here: an own property would shadow the
  // builder method of the same name (the trap settingsFieldDescriptor exists
  // for), and validation requires it anyway.
  resource: (connector: string, resource: string) => chain<ResourceSettingsField>({ kind: 'resource', connector, resource } as ResourceSettingsField),
  /** A calendar day, `YYYY-MM-DD`. */
  date: () => chain<DateSettingsField>({ kind: 'date' }),
  list: () => chain<ListSettingsField>({ kind: 'list' }),
}

/**
 * A builder object carries its methods on the prototype, so `field.default`
 * on a field with no own default would find the METHOD. Every reader goes
 * through this: own enumerable properties only - the descriptor, nothing else.
 */
export function settingsFieldDescriptor(field: unknown): Record<string, unknown> {
  return field && typeof field === 'object' ? Object.fromEntries(Object.entries(field as Record<string, unknown>)) : {}
}

// ── Definition validation (the manifest validator calls this) ─────────────────

const KINDS = new Set<SettingsFieldKind>(['boolean', 'number', 'string', 'select', 'secret', 'connection', 'resource', 'date', 'list'])
const KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function validateSettingsDefinition(def: unknown): SettingsIssue[] {
  const issues: SettingsIssue[] = []
  if (!def || typeof def !== 'object' || Array.isArray(def)) return [{ path: '', message: 'must be an object of settings fields' }]
  for (const [key, raw] of Object.entries(def as Record<string, unknown>)) {
    if (!KEY.test(key)) { issues.push({ path: key, message: 'keys are identifiers' }); continue }
    if (!raw || typeof raw !== 'object') { issues.push({ path: key, message: 'must be a settings field (settings.boolean(), .number(), ...)' }); continue }
    const f = settingsFieldDescriptor(raw) as Partial<SettingsField> & Record<string, unknown>
    if (typeof f.kind !== 'string' || !KINDS.has(f.kind as SettingsFieldKind)) { issues.push({ path: `${key}.kind`, message: `must be one of ${[...KINDS].join(', ')}` }); continue }
    if (f.kind === 'secret' && (f as { default?: unknown }).default !== undefined) issues.push({ path: `${key}.default`, message: 'a secret has no default: it would be a credential in code' })
    if (f.kind === 'select' && (!Array.isArray(f.options) || f.options.length === 0 || f.options.some((o) => typeof o !== 'string'))) issues.push({ path: `${key}.options`, message: 'must be a non-empty list of strings' })
    if (f.kind === 'connection' && (typeof f.connector !== 'string' || !f.connector)) issues.push({ path: `${key}.connector`, message: 'must name a provider' })
    if (f.kind === 'connection' && f.capabilities !== undefined && (!Array.isArray(f.capabilities) || f.capabilities.some((c) => typeof c !== 'string' || !c))) issues.push({ path: `${key}.capabilities`, message: 'must be a list of capability names' })
    if (f.kind === 'resource') {
      if (typeof f.connector !== 'string' || !f.connector) issues.push({ path: `${key}.connector`, message: 'must name a provider' })
      if (typeof f.resource !== 'string' || !f.resource) issues.push({ path: `${key}.resource`, message: "must name the connector's resource type" })
      // A resource has no meaning without the connection it lives in, so the
      // field it reads that from is required and must BE a connection field.
      const dependsOn = f.dependsOn
      if (typeof dependsOn !== 'string' || !dependsOn) issues.push({ path: `${key}.dependsOn`, message: 'must name the connection field this resource is read through' })
      else {
        const target = settingsFieldDescriptor((def as Record<string, unknown>)[dependsOn]) as Partial<SettingsField>
        if (target.kind !== 'connection') issues.push({ path: `${key}.dependsOn`, message: `'${dependsOn}' must be a settings.connection() field` })
      }
      const parent = (f as { parent?: unknown }).parent
      if (parent !== undefined) {
        const target = settingsFieldDescriptor((def as Record<string, unknown>)[String(parent)]) as Partial<SettingsField>
        if (target.kind !== 'resource') issues.push({ path: `${key}.parent`, message: `'${String(parent)}' must be another settings.resource() field` })
      }
    }
    if (f.kind === 'list' && f.options !== undefined && (!Array.isArray(f.options) || f.options.some((o) => typeof o !== 'string'))) issues.push({ path: `${key}.options`, message: 'must be a list of strings' })
    const pub = (f as { public?: unknown }).public
    if (pub !== undefined && pub !== true) issues.push({ path: `${key}.public`, message: 'must be true when present' })
    if (pub === true && (f.kind === 'secret' || f.kind === 'connection')) issues.push({ path: `${key}.public`, message: 'a secret or a connection can never be public' })
    const requires = (f as { requires?: unknown }).requires
    if (requires !== undefined && (typeof requires !== 'string' || compileGrants([requires]).unknown.length > 0)) issues.push({ path: `${key}.requires`, message: 'must be a grant this kernel knows (the one the setting takes effect under)' })
    if (f.kind === 'list' && (f as { optionsFrom?: unknown }).optionsFrom !== undefined && (f as { optionsFrom?: unknown }).optionsFrom !== 'content-types') issues.push({ path: `${key}.optionsFrom`, message: "must be 'content-types'" })
    const dflt = (f as { default?: unknown }).default
    if (dflt !== undefined && f.kind !== 'secret') {
      const err = checkValue(f as SettingsField, dflt)
      if (err) issues.push({ path: `${key}.default`, message: err })
    }
  }
  return issues
}

// ── Values ────────────────────────────────────────────────────────────────────

function checkValue(field: SettingsField, value: unknown): string | null {
  switch (field.kind) {
    case 'boolean': return typeof value === 'boolean' ? null : 'must be true or false'
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number'
      if (field.integer && !Number.isInteger(value)) return 'must be a whole number'
      if (field.min !== undefined && value < field.min) return `must be at least ${field.min}`
      if (field.max !== undefined && value > field.max) return `must be at most ${field.max}`
      return null
    }
    case 'string': {
      if (typeof value !== 'string') return 'must be text'
      if (field.minLength !== undefined && value.length < field.minLength) return `must be at least ${field.minLength} characters`
      if (field.maxLength !== undefined && value.length > field.maxLength) return `must be at most ${field.maxLength} characters`
      if (field.pattern !== undefined && !new RegExp(field.pattern).test(value)) return `must match ${field.pattern}`
      return null
    }
    case 'select': return typeof value === 'string' && field.options.includes(value) ? null : `must be one of ${field.options.join(', ')}`
    case 'secret': return typeof value === 'string' && value.length > 0 ? null : 'must be text'
    case 'connection': return typeof value === 'string' && value.length > 0 ? null : 'must be a connection id'
    case 'resource': return typeof value === 'string' && value.length > 0 ? null : 'must be a resource id'
    case 'date': return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? null : 'must be a date as YYYY-MM-DD'
    case 'list': {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return 'must be a list of strings'
      if (field.options) { const bad = value.find((v) => !field.options!.includes(v as string)); if (bad !== undefined) return `'${String(bad)}' is not one of ${field.options.join(', ')}` }
      return null
    }
  }
}

export interface SettingsCodec {
  /** The values a fresh install starts from: every field with a default. */
  defaults(): Record<string, unknown>
  /**
   * Checks a full value set (or a patch with `partial`): unknown keys, wrong
   * types, ranges, options; `null` on a partial patch clears an optional field.
   * `value` holds only the accepted keys.
   */
  validate(input: unknown, opts?: { partial?: boolean }): { ok: boolean; errors: SettingsIssue[]; value: Record<string, unknown> }
  /** Descriptors in declaration order, for the API and the generated form. */
  fields(): SettingsFieldDescriptor[]
  secretKeys(): string[]
  /** The keys marked `public` (E.18), in definition order. */
  publicKeys(): string[]
  /** A copy with every secret replaced by `{ set: boolean }` - what leaves the server. */
  redact(values: Record<string, unknown>): Record<string, unknown>
}

export function compileSettings(def: ExtensionSettingsDefinition): SettingsCodec {
  const entries = Object.entries(def).map(([k, f]) => [k, settingsFieldDescriptor(f) as unknown as SettingsField] as const)
  const secrets = entries.filter(([, f]) => f.kind === 'secret').map(([k]) => k)
  return {
    defaults() {
      const out: Record<string, unknown> = {}
      for (const [k, f] of entries) { const d = (f as { default?: unknown }).default; if (f.kind !== 'secret' && d !== undefined) out[k] = d }
      return out
    },
    validate(input, opts) {
      const errors: SettingsIssue[] = []
      const value: Record<string, unknown> = {}
      if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: [{ path: '', message: 'must be an object' }], value }
      const given = input as Record<string, unknown>
      for (const k of Object.keys(given)) if (!(k in def)) errors.push({ path: k, message: `not a setting this extension declares (${entries.map(([n]) => n).join(', ') || 'none'})` })
      for (const [k, f] of entries) {
        const v = given[k]
        if (v === undefined) {
          if (opts?.partial) continue
          const hasDefault = f.kind !== 'secret' && (f as { default?: unknown }).default !== undefined
          if (!hasDefault && !f.optional) errors.push({ path: k, message: 'is required' })
          continue
        }
        if (v === null) {
          if (f.optional || (f.kind !== 'secret' && (f as { default?: unknown }).default !== undefined)) { value[k] = null; continue }
          errors.push({ path: k, message: 'is required' }); continue
        }
        const err = checkValue(f, v)
        if (err) errors.push({ path: k, message: err }); else value[k] = v
      }
      return { ok: errors.length === 0, errors, value }
    },
    fields: () => entries.map(([key, f]) => ({ ...f, key })),
    secretKeys: () => [...secrets],
    publicKeys: () => entries.filter(([, f]) => (f as { public?: boolean }).public === true).map(([key]) => key),
    redact(values) {
      const out: Record<string, unknown> = { ...values }
      for (const k of secrets) out[k] = { set: values[k] !== undefined && values[k] !== null }
      return out
    },
  }
}

/**
 * The settings a definition gates behind a grant the installation does not
 * hold (E.15): `{ key, grant }` per field with `requires` outside
 * `effectiveGrants`. One rule for the runtime service, the Admin, the CLI
 * status and Doctor.
 */
export function unavailableSettings(definition: ExtensionSettingsDefinition | undefined, effectiveGrants: readonly string[]): Array<{ key: string; grant: string }> {
  if (!definition) return []
  const held = new Set(effectiveGrants)
  const out: Array<{ key: string; grant: string }> = []
  for (const [key, field] of Object.entries(definition)) {
    const grant = settingsFieldDescriptor(field).requires
    if (typeof grant === 'string' && grant && !held.has(grant)) out.push({ key, grant })
  }
  return out
}

/** The one-line reason the runtime, the Admin and the CLI give for an unavailable setting, with the approval command. */
export function unavailableSettingMessage(extensionId: string, grant: string): string {
  return `missing ${grant} grant: this installation was not granted it - approve it with tangen extension upgrade ${extensionId} --approve-optional ${grant}`
}
