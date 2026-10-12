/**
 * File Name: extension-manifest.ts
 * Purpose: The manifest v1 contract as code (closure plan Phase 4, Unit 3):
 *          a semver parser and range matcher small enough to own, and
 *          `validateExtensionManifest`, the one validation every loader
 *          runs (the API's workspace loader, the CLI's install and push,
 *          the scaffold). Browser-safe and framework-neutral: no Elysia, no
 *          database, no filesystem.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Errors make a manifest invalid (the loader skips it
 *          loudly, the CLI refuses); warnings are deprecations that still
 *          load. The identity rules match what the platform already enforces
 *          elsewhere (realtime channel names, capability ids); duplicates
 *          are found within one manifest here and across extensions by the
 *          loaders that see them all.
 */
import { validateSettingsDefinition } from './extension-settings'
import { validateSlotContributions, ADMIN_CONTRIBUTE_GRANT } from './admin-slots'
import { grantNames } from './extension-review'
import type { TangenExtensionManifest, ExtensionDependency } from './extension'
import { compileGrants, isPrivilegedGrant, FACILITY_FAMILIES } from './extension-grants'
import { parseServiceRef, isProvidedServiceRef, isRequiredServiceRef } from './extension-services'
import { tierOf } from './extension-review'
import { connectorBrandIconIssue } from './connections'

// ── semver ────────────────────────────────────────────────────────────────────

export interface Semver { major: number; minor: number; patch: number; prerelease: string[] }

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseSemver(input: string): Semver | null {
  const m = SEMVER.exec(String(input ?? '').trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ? m[4].split('.') : [] }
}

export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i], y = b.prerelease[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y)
    if (nx && ny && Number(x) !== Number(y)) return Number(x) - Number(y)
    if (nx !== ny) return nx ? -1 : 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

type Comparator = { op: '>=' | '>' | '<=' | '<' | '=' ; v: Semver }

/** A partial version like `1` or `1.2` in a range means the lowest version of that prefix. */
function partial(text: string): { v: Semver; parts: number } | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(text)
  if (!m) return null
  const parts = m[3] !== undefined ? 3 : m[2] !== undefined ? 2 : 1
  return { v: { major: Number(m[1]), minor: Number(m[2] ?? 0), patch: Number(m[3] ?? 0), prerelease: m[4] ? m[4].split('.') : [] }, parts }
}

function parseRange(range: string): Comparator[][] | null {
  const alternatives = range.split('||').map((s) => s.trim())
  const out: Comparator[][] = []
  for (const alt of alternatives) {
    if (alt === '' || alt === '*' || alt === 'x') { out.push([]); continue }
    const comps: Comparator[] = []
    for (const token of alt.split(/\s+/)) {
      const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(token)
      if (!m) return null
      const p = partial(m[2]!)
      if (!p) return null
      const op = m[1] ?? ''
      const { v, parts } = p
      const next = (major: number, minor: number, patch: number): Semver => ({ major, minor, patch, prerelease: [] })
      if (op === '^') {
        comps.push({ op: '>=', v })
        if (v.major > 0 || parts === 1) comps.push({ op: '<', v: next(v.major + 1, 0, 0) })
        else if (v.minor > 0 || parts === 2) comps.push({ op: '<', v: next(0, v.minor + 1, 0) })
        else comps.push({ op: '<', v: next(0, 0, v.patch + 1) })
      } else if (op === '~') {
        comps.push({ op: '>=', v })
        comps.push({ op: '<', v: parts === 1 ? next(v.major + 1, 0, 0) : next(v.major, v.minor + 1, 0) })
      } else if (op === '' || op === '=') {
        if (parts === 3) comps.push({ op: '=', v })
        else { comps.push({ op: '>=', v }); comps.push({ op: '<', v: parts === 1 ? next(v.major + 1, 0, 0) : next(v.major, v.minor + 1, 0) }) }
      } else {
        comps.push({ op: op as Comparator['op'], v })
      }
    }
    out.push(comps)
  }
  return out
}

/** True when the range is one this contract understands. */
export function isValidVersionRange(range: string): boolean {
  return parseRange(String(range ?? '').trim()) !== null
}

/** Does `version` satisfy `range`? An unparsable version or range never satisfies. */
export function satisfiesVersion(version: string, range: string): boolean {
  const v = parseSemver(version)
  const alts = parseRange(String(range ?? '').trim())
  if (!v || !alts) return false
  return alts.some((comps) => comps.every((c) => {
    const d = compareSemver(v, c.v)
    switch (c.op) {
      case '>=': return d >= 0
      case '>': return d > 0
      case '<=': return d <= 0
      case '<': return d < 0
      default: return d === 0
    }
  }))
}

// ── the manifest contract ─────────────────────────────────────────────────────

export interface ManifestIssue {
  /** Dotted path into the manifest, e.g. 'fieldTypes[1].name'. */
  path: string
  message: string
}

export interface ManifestValidation {
  ok: boolean
  errors: ManifestIssue[]
  /** Deprecated but still honoured declarations. */
  warnings: ManifestIssue[]
}

export const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const CAPABILITY_ID = /^[a-z][a-z0-9-]*$/
const CHANNEL_NAME = /^[a-z][a-z0-9_-]{0,63}$/
const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/
const RELATIVE_MODULE = /^\.\.?\//
const CONFIG_TYPES = new Set(['string', 'number', 'boolean', 'string[]', 'json'])

export function dependencyId(d: ExtensionDependency): string {
  return typeof d === 'string' ? d : d.id
}
export function dependencyRange(d: ExtensionDependency): string | undefined {
  return typeof d === 'string' ? undefined : d.version
}

/**
 * Validates one manifest against the v1 contract. Pure: reports every
 * problem it finds, throws nothing.
 */
/** `<provider>.<authKind>`: the normalized connector id grammar (plan-connectors 2.2). */
export const CONNECTOR_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/

export function validateExtensionManifest(input: unknown): ManifestValidation {
  const errors: ManifestIssue[] = []
  const warnings: ManifestIssue[] = []
  const err = (path: string, message: string) => errors.push({ path, message })
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ path: '', message: 'the manifest must be an object (the default export of tangen.extension.ts)' }], warnings }
  }
  const m = input as Partial<TangenExtensionManifest> & Record<string, unknown>

  // Identity
  if (typeof m.id !== 'string' || !EXTENSION_ID_PATTERN.test(m.id)) err('id', `must match ${EXTENSION_ID_PATTERN} (lowercase; third parties namespace theirs, e.g. 'acme.seo')`)
  if (typeof m.name !== 'string' || m.name.trim() === '') err('name', 'must be a non-empty string')
  if (typeof m.version !== 'string' || !parseSemver(m.version)) err('version', `must be a semver version (major.minor.patch), got ${JSON.stringify(m.version)}`)
  if (m.description !== undefined && typeof m.description !== 'string') err('description', 'must be a string')
  // Provenance, for the Extensions screen. A homepage is RENDERED as a link,
  // so only http(s) is accepted: a javascript: or data: URL in a manifest
  // must never reach an operator's browser as an href.
  for (const key of ['author', 'license'] as const) {
    if (m[key] !== undefined && (typeof m[key] !== 'string' || (m[key] as string).trim() === '')) err(key, 'must be a non-empty string')
  }
  if (m.homepage !== undefined) {
    if (typeof m.homepage !== 'string' || !/^https?:\/\/[^\s]+$/i.test(m.homepage)) err('homepage', 'must be an http(s) URL')
  }

  // Modules
  for (const key of ['server', 'migrations'] as const) {
    const v = m[key]
    if (v !== undefined && (typeof v !== 'string' || !RELATIVE_MODULE.test(v))) err(key, `must be a module path relative to the extension dir, like './src/${key}.ts'`)
  }
  if (m.contentTypes !== undefined && !Array.isArray(m.contentTypes) && !(typeof m.contentTypes === 'string' && RELATIVE_MODULE.test(m.contentTypes))) {
    err('contentTypes', "must be an array of type definitions or a relative module path like './src/content-types.ts'")
  }

  // Dependencies
  const seenDeps = new Map<string, string>()
  const checkDeps = (list: unknown, path: string) => {
    if (list === undefined) return
    if (!Array.isArray(list)) { err(path, 'must be an array'); return }
    list.forEach((d, i) => {
      const at = `${path}[${i}]`
      const id = typeof d === 'string' ? d : d && typeof d === 'object' ? (d as { id?: unknown }).id : undefined
      if (typeof id !== 'string' || !EXTENSION_ID_PATTERN.test(id)) { err(at, 'must be an extension id or { id, version? }'); return }
      if (id === m.id) err(at, 'an extension cannot depend on itself')
      const prev = seenDeps.get(id)
      if (prev) err(at, `'${id}' is already declared in ${prev}`)
      else seenDeps.set(id, path)
      const range = typeof d === 'object' && d ? (d as { version?: unknown }).version : undefined
      if (range !== undefined && (typeof range !== 'string' || !isValidVersionRange(range))) err(`${at}.version`, `'${String(range)}' is not a version range this contract understands (1.2.3, ^1.2, ~1.2.3, >=1.2.0 <2.0.0, *)`)
    })
  }
  // Typed services (Extension Kernel K3): provides names the extension's own
  // namespace with a bare major; requires / optional name a range.
  const checkServiceList = (list: unknown, path: string, kind: 'provides' | 'consumes') => {
    if (list === undefined) return
    if (!Array.isArray(list)) { err(path, 'must be an array of service refs like seo.service@1'); return }
    const seen = new Set<string>()
    list.forEach((ref, i) => {
      const at = `${path}[${i}]`
      if (typeof ref !== 'string') { err(at, 'must be a service ref string'); return }
      if (seen.has(ref)) { err(at, `'${ref}' is declared twice`); return }
      seen.add(ref)
      const parsed = parseServiceRef(ref)
      if (kind === 'provides') {
        if (!parsed || !isProvidedServiceRef(ref)) err(at, `'${ref}' must be <your id>.<name>@<major>, e.g. ${typeof m.id === 'string' ? m.id : 'acme.reviews'}.service@1`)
        else if (parsed.namespace !== m.id) err(at, `'${ref}' is not in this extension's namespace: a provided service is <${String(m.id)}>.<name>@<major>`)
      } else if (!parsed || !isRequiredServiceRef(ref)) {
        err(at, `'${ref}' must be <namespace>.<name>@<range>, e.g. seo.service@^1`)
      }
    })
  }
  if (m.provides !== undefined) {
    if (!m.provides || typeof m.provides !== 'object' || Array.isArray(m.provides)) err('provides', 'must be an object: { services?: string[] }')
    else checkServiceList((m.provides as { services?: unknown }).services, 'provides.services', 'provides')
  }
  if (m.requires && typeof m.requires === 'object' && !Array.isArray(m.requires)) checkServiceList((m.requires as { services?: unknown }).services, 'requires.services', 'consumes')
  if (m.optional && typeof m.optional === 'object' && !Array.isArray(m.optional)) checkServiceList((m.optional as { services?: unknown }).services, 'optional.services', 'consumes')

  // Grants (Extension Kernel K1): known to the compiler, no duplicates; a
  // privileged grant is legal but warned, since no marketplace install can approve it.
  if (m.grants !== undefined) {
    const g = m.grants as { required?: unknown; optional?: unknown } | null
    if (!g || typeof g !== 'object' || Array.isArray(g)) err('grants', 'must be an object: { required: string[], optional?: string[] }')
    else {
      const checkList = (list: unknown, path: string, required: boolean) => {
        if (list === undefined) { if (required) err(path, 'must be an array of grants (empty when the extension needs none)'); return }
        if (!Array.isArray(list)) { err(path, 'must be an array of grants'); return }
        const seen = new Set<string>()
        list.forEach((item, i) => {
          const at = `${path}[${i}]`
          // K5: an item is a grant string, or { grant, reason?, enables? } with the publisher's reason.
          const grant = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as { grant?: unknown }).grant : undefined
          if (typeof grant !== 'string' || !grant.trim()) { err(at, 'must be a grant string like content:read, or { grant, reason? }'); return }
          if (typeof item === 'object') {
            const reason = (item as { reason?: unknown }).reason
            if (reason !== undefined && (typeof reason !== 'string' || !reason.trim())) err(`${at}.reason`, 'must be a non-empty string')
            const enables = (item as { enables?: unknown }).enables
            if (enables !== undefined && (typeof enables !== 'string' || !enables.trim())) err(`${at}.enables`, 'must be a non-empty string')
          }
          if (seen.has(grant)) { err(at, `'${grant}' is declared twice`); return }
          seen.add(grant)
          const c = compileGrants([grant])
          if (c.unknown.length) err(at, `'${grant}' is not a grant this kernel knows (families: content, media, globals, search, webhooks, tables, schema, locales, capability, ${FACILITY_FAMILIES.join(', ')})`)
          else if (isPrivilegedGrant(grant)) warnings.push({ path: at, message: `'${grant}' is privileged: only a trusted (first-party or self-hosted) install can approve it; a marketplace install refuses it` })
          else if ((tierOf(grant) === 'MEDIUM' || tierOf(grant) === 'HIGH') && (typeof item === 'string' || !(item as { reason?: string }).reason)) {
            warnings.push({ path: at, message: `'${grant}' has no reason: a ${tierOf(grant)} grant should say why (shown at install and in the Admin)` })
          }
        })
      }
      checkList(g.required, 'grants.required', true)
      checkList(g.optional, 'grants.optional', false)
    }
  }
  // E.14: no trusted class. A server entry holds exactly what it declares, so it must declare.
  if (m.server !== undefined && m.grants === undefined) err('grants', 'a server entry needs grants: { required: [...] } (an empty list when it needs none) - an extension holds only what it declares')
  if (m.deploymentRoles !== undefined) {
    const roles = ['development', 'staging', 'production']
    if (!Array.isArray(m.deploymentRoles) || m.deploymentRoles.length === 0) err('deploymentRoles', `must be a non-empty array of deployment roles (${roles.join(', ')}); omit it to allow every deployment`)
    else {
      const seen = new Set<string>()
      m.deploymentRoles.forEach((r, i) => {
        if (typeof r !== 'string' || !roles.includes(r)) err(`deploymentRoles[${i}]`, `must be one of ${roles.join(', ')}`)
        else if (seen.has(r)) err(`deploymentRoles[${i}]`, `'${r}' is declared twice`)
        else seen.add(r)
      })
    }
  }
  if (m.requires !== undefined) {
    // An ARRAY is `typeof 'object'`: without this an author who wrote
    // `requires: ['other']` got a silent empty requires - no error, and no
    // dependency (Phase 7, finding 7-6).
    if (!m.requires || typeof m.requires !== 'object' || Array.isArray(m.requires)) err('requires', 'must be an object: { capabilities?: string[], extensions?: (string | { id, version? })[], services?: string[] }')
    else {
      const caps = (m.requires as { capabilities?: unknown }).capabilities
      if (caps !== undefined) {
        if (!Array.isArray(caps)) err('requires.capabilities', 'must be an array of capability ids')
        else {
          const seen = new Set<string>()
          caps.forEach((c, i) => {
            if (typeof c !== 'string' || !CAPABILITY_ID.test(c)) err(`requires.capabilities[${i}]`, `must be a capability id (${CAPABILITY_ID})`)
            else if (seen.has(c)) err(`requires.capabilities[${i}]`, `'${c}' is declared twice`)
            else seen.add(c)
          })
        }
      }
      checkDeps((m.requires as { extensions?: unknown }).extensions, 'requires.extensions')
    }
  }
  if (m.optional !== undefined) {
    if (!m.optional || typeof m.optional !== 'object' || Array.isArray(m.optional)) err('optional', 'must be an object: { extensions?: (string | { id, version? })[] }')
    else checkDeps((m.optional as { extensions?: unknown }).extensions, 'optional.extensions')
  }

  // Config and secrets
  if (m.config !== undefined) {
    if (!m.config || typeof m.config !== 'object' || Array.isArray(m.config)) err('config', 'must be an object of { key: { type, ... } }')
    else {
      for (const [key, f] of Object.entries(m.config as Record<string, unknown>)) {
        const at = `config.${key}`
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) err(at, 'keys are identifiers')
        if (!f || typeof f !== 'object') { err(at, 'must be { type, label?, required?, default?, secret? }'); continue }
        const field = f as { type?: unknown; default?: unknown; secret?: unknown; required?: unknown }
        if (typeof field.type !== 'string' || !CONFIG_TYPES.has(field.type)) { err(`${at}.type`, `must be one of ${[...CONFIG_TYPES].join(', ')}`); continue }
        if (field.secret !== undefined && typeof field.secret !== 'boolean') err(`${at}.secret`, 'must be a boolean')
        if (field.secret === true && field.type !== 'string') err(`${at}.secret`, 'only a string can be a secret')
        if (field.secret === true && field.default !== undefined) err(`${at}.default`, 'a secret has no default: it would be a credential in code')
        if (field.default !== undefined && !configValueMatches(field.type, field.default)) err(`${at}.default`, `does not match type '${field.type}'`)
      }
    }
  }
  if (m.secrets !== undefined) {
    if (!Array.isArray(m.secrets)) err('secrets', 'must be an array of environment variable NAMES')
    else {
      const seen = new Set<string>()
      m.secrets.forEach((n, i) => {
        if (typeof n !== 'string' || !SECRET_NAME.test(n)) err(`secrets[${i}]`, `must be an environment variable name (${SECRET_NAME}); values never belong in a manifest`)
        else if (seen.has(n)) err(`secrets[${i}]`, `'${n}' is declared twice`)
        else seen.add(n)
      })
    }
  }

  // Typed settings (Extension Kernel K7.1): the definition is data and must be well-formed before anything desugars from it.
  if (m.settings !== undefined) {
    for (const issue of validateSettingsDefinition(m.settings)) err(`settings${issue.path ? `.${issue.path}` : ''}`, issue.message)
  }
  if (m.settingsVersion !== undefined && (!Number.isInteger(m.settingsVersion) || (m.settingsVersion as number) < 1)) err('settingsVersion', 'must be a whole number, 1 or more')

  // The runtime Admin bundle (Extension Kernel K7.3): a relative built file, nothing remote, nothing source.
  if (m.ui !== undefined) {
    const ui = m.ui
    if (typeof ui !== 'string' || ui.trim() === '' || /^[a-z]+:\/\//i.test(ui) || ui.startsWith('/') || !/\.(m?js)$/.test(ui)) err('ui', "must be a relative path to a built .js or .mjs bundle (e.g. './dist/admin.js'), produced by tangen extension bundle-ui")
  }

  // Admin slots (Extension Kernel K7.2): descriptors only, and the grant to fill them.
  if (m.slots !== undefined) {
    for (const issue of validateSlotContributions(m.slots)) err(`slots${issue.path}`, issue.message)
    const declared = m.grants && typeof m.grants === 'object' ? grantNames(((m.grants as { required?: unknown[] }).required ?? []) as never) : null
    if (Array.isArray(m.slots) && m.slots.length > 0 && declared && !declared.includes(ADMIN_CONTRIBUTE_GRANT)) {
      err('slots', `filling an Admin slot needs the ${ADMIN_CONTRIBUTE_GRANT} grant in grants.required`)
    }
  }

  // Contributions: unique identities within the manifest
  const unique = (list: unknown, path: string, key: string, pattern?: RegExp) => {
    if (list === undefined) return
    if (!Array.isArray(list)) { err(path, 'must be an array'); return }
    const seen = new Set<string>()
    list.forEach((item, i) => {
      const v = item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined
      if (typeof v !== 'string' || v === '' && key !== 'path') { err(`${path}[${i}].${key}`, 'must be a non-empty string'); return }
      if (pattern && !pattern.test(v)) { err(`${path}[${i}].${key}`, `must match ${pattern}`); return }
      if (seen.has(v)) err(`${path}[${i}].${key}`, `'${v}' is contributed twice`)
      else seen.add(v)
    })
  }
  unique(m.fieldTypes, 'fieldTypes', 'name')
  unique(m.sidebarPanels, 'sidebarPanels', 'id')
  unique(m.dashboardWidgets, 'dashboardWidgets', 'id')
  unique(m.pages, 'pages', 'path')
  unique(m.capabilities, 'capabilities', 'id')
  unique(m.customTables, 'customTables', 'name')
  unique(m.routes, 'routes', 'path')
  if (m.realtime !== undefined) {
    if (!m.realtime || typeof m.realtime !== 'object') err('realtime', 'must be { channels: [...] }')
    else unique((m.realtime as { channels?: unknown }).channels, 'realtime.channels', 'name', CHANNEL_NAME)
  }
  if (Array.isArray(m.pages)) {
    m.pages.forEach((p, i) => { if (p && typeof p === 'object' && typeof (p as { path?: unknown }).path === 'string' && (p as { path: string }).path.startsWith('/')) err(`pages[${i}].path`, "is relative to the extension root; must not start with '/'") })
  }
  if (Array.isArray(m.commands) && m.commands.length > 3) warnings.push({ path: 'commands', message: 'at most 3 commands are surfaced; the rest are dropped' })

  // Deprecations still honoured by nothing: they moved to the server entry.
  // Connectors C1: a pack's declared connectors, and the `kind` that frames it.
  if (m.kind !== undefined && m.kind !== 'extension' && m.kind !== 'connector-pack') {
    err('kind', "must be 'extension' (the default) or 'connector-pack'")
  }
  if (m.connectors !== undefined) {
    if (!Array.isArray(m.connectors)) err('connectors', 'must be an array of { id, provider, hosts }')
    else {
      const seen = new Set<string>()
      m.connectors.forEach((raw, i) => {
        const c = (raw ?? {}) as unknown as Record<string, unknown>
        const at = `connectors[${i}]`
        if (typeof c.id !== 'string' || !CONNECTOR_ID_PATTERN.test(c.id)) {
          err(`${at}.id`, `must be '<provider>.<authKind>' in lowercase, like 'google.oauth' or 'slack.token' (got ${JSON.stringify(c.id)})`)
          return
        }
        if (seen.has(c.id)) err(`${at}.id`, `'${c.id}' is declared twice`)
        seen.add(c.id)
        const provider = c.id.split('.')[0]!
        if (typeof c.provider !== 'string' || c.provider === '') err(`${at}.provider`, "must name the outside service, e.g. 'google'")
        else if (c.provider !== provider) err(`${at}.provider`, `must be '${provider}', the first segment of '${c.id}': a connector id is <provider>.<authKind>`)
        if (c.hosts !== undefined && (!Array.isArray(c.hosts) || c.hosts.some((h) => typeof h !== 'string' || h === ''))) {
          err(`${at}.hosts`, 'must be a list of hostnames the connector reaches')
        }
        if (c.label !== undefined && typeof c.label !== 'string') err(`${at}.label`, 'must be a string')
        // A brand is how an operator RECOGNISES the provider in a list. The
        // mark is the pack's own asset, inline, so it needs no route and no
        // CSP exception - and a URL here would be a host the manifest did not
        // declare, fetched by the Admin.
        if (c.brand !== undefined) {
          const brand = (c.brand ?? {}) as Record<string, unknown>
          if (typeof c.brand !== 'object' || Array.isArray(c.brand)) err(`${at}.brand`, 'must be an object: { icon?, color? }')
          else {
            if (brand.icon !== undefined) {
              if (typeof brand.icon !== 'string') err(`${at}.brand.icon`, 'must be a data: URI string')
              else {
                const issue = connectorBrandIconIssue(brand.icon)
                if (issue) err(`${at}.brand.icon`, issue)
              }
            }
            if (brand.color !== undefined && (typeof brand.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(brand.color))) {
              err(`${at}.brand.color`, "must be a hex colour like '#4285F4'")
            }
          }
        }
      })
    }
  }
  if (m.kind === 'connector-pack' && (!Array.isArray(m.connectors) || m.connectors.length === 0)) {
    err('connectors', "a connector-pack declares the connectors it offers, so an operator sees the providers and hosts before its code runs")
  }

  for (const key of ['onInstall', 'onUninstall', 'contentHooks'] as const) {
    if (m[key] !== undefined) warnings.push({ path: key, message: `'${key}' on the manifest is deprecated and ignored; declare it in the server entry (defineExtensionServer)` })
  }

  return { ok: errors.length === 0, errors, warnings }
}

function configValueMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'boolean': return typeof value === 'boolean'
    case 'string[]': return Array.isArray(value) && value.every((v) => typeof v === 'string')
    default: return true
  }
}

/**
 * Validates install options against the manifest's `config`: unknown keys,
 * missing required keys and type mismatches are errors; defaults fill the
 * gaps. Returns the effective options.
 */
export function validateExtensionOptions(
  manifest: Pick<TangenExtensionManifest, 'config'>,
  options: Record<string, unknown> | undefined,
): { ok: boolean; errors: ManifestIssue[]; options: Record<string, unknown> } {
  const errors: ManifestIssue[] = []
  const out: Record<string, unknown> = { ...(options ?? {}) }
  const config = manifest.config ?? {}
  for (const key of Object.keys(out)) {
    if (!(key in config)) errors.push({ path: `options.${key}`, message: `not a key this extension declares (${Object.keys(config).join(', ') || 'none'})` })
  }
  for (const [key, field] of Object.entries(config)) {
    if (out[key] === undefined) {
      if (field.default !== undefined) out[key] = field.default
      else if (field.required) errors.push({ path: `options.${key}`, message: 'is required' })
      continue
    }
    if (!configValueMatches(field.type, out[key])) errors.push({ path: `options.${key}`, message: `must be a ${field.type}` })
  }
  return { ok: errors.length === 0, errors, options: out }
}

/** Formats issues for an operator: one line each, path first. */
export function formatManifestIssues(issues: ManifestIssue[]): string {
  return issues.map((i) => `  - ${i.path ? `${i.path}: ` : ''}${i.message}`).join('\n')
}

/** Throws a single error naming the extension and every problem. */
export function assertExtensionManifest(input: unknown, label?: string): asserts input is TangenExtensionManifest {
  const r = validateExtensionManifest(input)
  if (r.ok) return
  const id = label ?? (input && typeof input === 'object' ? String((input as { id?: unknown }).id ?? '?') : '?')
  throw new Error(`extension '${id}': the manifest is not valid\n${formatManifestIssues(r.errors)}`)
}

/**
 * The sentence that refuses an install or enable on a deployment whose role
 * the manifest's `deploymentRoles` policy excludes; null when permitted.
 */
export function deploymentRoleRefusal(
  manifest: { id?: string; deploymentRoles?: ReadonlyArray<string> } | null | undefined,
  role: string | null | undefined,
): string | null {
  const allowed = manifest?.deploymentRoles
  if (!allowed || !role || allowed.includes(role)) return null
  return `Extension '${manifest?.id ?? '?'}' is limited to ${allowed.join(', ')} deployments by its manifest; this is a ${role} deployment.`
}

/**
 * The admin-route paths an extension declares that CORE serves itself, so the
 * extension's own handler can never run.
 *
 * There is one today: `settings`, which core answers for any manifest that
 * declares typed `settings` (Extension Kernel K7.1). An extension declaring
 * both got silent shadowing - its page asked for its own settings and was
 * handed the generated form's payload, which has none of its shape (SEO, in
 * a real project, 2026-09-20). Pure, so the registry can warn at load and a
 * test can assert the rule without a runtime.
 */
export function shadowedAdminRoutePaths(
  manifest: { settings?: unknown } | undefined,
  routes: ReadonlyArray<{ method?: string; path?: string }> | undefined,
): string[] {
  if (!manifest?.settings || !Array.isArray(routes)) return []
  const out = new Set<string>()
  for (const route of routes) {
    const method = String(route?.method ?? '').toUpperCase()
    if (method !== 'GET' && method !== 'POST') continue
    // The mount strips the extension prefix, so the path core compares is
    // exactly this one - with or without a leading slash.
    if (String(route?.path ?? '').replace(/^\/+/, '') === 'settings') out.add('settings')
  }
  return [...out]
}
