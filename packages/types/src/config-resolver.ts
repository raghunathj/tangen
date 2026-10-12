/**
 * File Name: config-resolver.ts
 * Purpose: The one configuration resolver (tasks/plan-config-resolver.md,
 *          revised by tasks/remove-environments-programme.md, stage R5).
 *          Two layers - workspace and deployment - over the platform
 *          defaults; a key's spec says which layers may set it, how they
 *          combine, whether a less specific layer may serve a more specific
 *          one (fallback policy, keyed on the DEPLOYMENT ROLE), whether
 *          `null` disables it, and whether it is a secret reference.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. Every value comes with its provenance (which
 *          layer and source won, or why nothing did) and a finding when a
 *          placement, type, fallback, disable or requirement rule is broken.
 *          Secret references are resolved through the SecretProvider only
 *          for presence; material never enters the result.
 */
import type { DeploymentRole } from './deployment-role'
import { SECRET_REF, type ConfigKeySpec, type ConfigRegistry, type ConfigScope, type ConfigSourceId, type FallbackPolicy } from './config-registry'
import type { SecretProvider } from './secret-provider'

export type ConfigLayer = 'platform' | ConfigScope

export interface ConfigSource {
  source: ConfigSourceId
  layer: ConfigScope
  values: Record<string, unknown>
}

export type ProvenanceState = 'default' | 'inherited' | 'overridden' | 'disabled' | 'bound' | 'missing' | 'invalid'

export interface Provenance {
  key: string
  state: ProvenanceState
  layer: ConfigLayer | null
  source: ConfigSourceId | null
  policy: FallbackPolicy
  scopes: readonly ConfigScope[]
  value?: unknown
  secret?: { secretRef: string; resolved: boolean; provider: string }
  error?: string
}

export interface ConfigFinding {
  severity: 'error' | 'warning' | 'info'
  code: 'PLACEMENT' | 'TYPE' | 'REQUIRED' | 'SECRET_MISSING' | 'SECRET_REF_INVALID' | 'DISABLE_NOT_SUPPORTED' | 'FALLBACK'
  key: string
  message: string
  source?: ConfigSourceId
}

export interface ResolveConfigInput {
  registry: ConfigRegistry
  /** The deployment role of the process; production turns on `required: 'production'` and refuses `nonProductionOnly` fallbacks. */
  role: DeploymentRole
  sources: readonly ConfigSource[]
  variables?: Record<string, string | undefined>
  secrets?: SecretProvider
}

export interface ResolvedConfig {
  role: DeploymentRole
  values: Readonly<Record<string, unknown>>
  provenance: Readonly<Record<string, Provenance>>
  findings: ConfigFinding[]
  secretRefs: ReadonlyMap<string, string>
}

const LAYER_ORDER: Record<ConfigScope, number> = { workspace: 1, deployment: 2 }

export function readPath(values: Record<string, unknown> | undefined, key: string): unknown {
  let cur: unknown = values
  for (const seg of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

function typeMatches(type: ConfigKeySpec['type'], value: unknown): boolean {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'url': return typeof value === 'string' && (value === '' || isUrl(value))
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'boolean': return typeof value === 'boolean'
    case 'string[]': return Array.isArray(value) && value.every((v) => typeof v === 'string')
    case 'secretRef': return typeof value === 'string'
    case 'json': return value !== undefined
  }
}

function isUrl(v: string): boolean {
  try { new URL(v); return true } catch { return false }
}

function coerceVariable(type: ConfigKeySpec['type'], raw: string): unknown {
  switch (type) {
    case 'number': return Number(raw)
    case 'boolean': return raw === 'true' || raw === '1'
    case 'string[]': return raw.split(',').map((s) => s.trim()).filter(Boolean)
    case 'json': try { return JSON.parse(raw) } catch { return raw }
    default: return raw
  }
}

function mostSpecific(scopes: readonly ConfigScope[]): ConfigScope {
  return [...scopes].sort((a, b) => LAYER_ORDER[b] - LAYER_ORDER[a])[0]!
}

export function resolveConfig(input: ResolveConfigInput): ResolvedConfig {
  const values: Record<string, unknown> = {}
  const provenance: Record<string, Provenance> = {}
  const findings: ConfigFinding[] = []
  const secretRefs = new Map<string, string>()
  const isProduction = input.role === 'production'
  const variables = input.variables ?? {}

  // Placement: a source that sets a key outside the key's scopes is a finding.
  for (const src of input.sources) {
    for (const spec of input.registry.specs.values()) {
      if (spec.scopes.includes(src.layer)) continue
      if (readPath(src.values, spec.key) === undefined) continue
      findings.push({ severity: 'error', code: 'PLACEMENT', key: spec.key, source: src.source, message: `"${spec.key}" may be set at ${spec.scopes.join(' or ')} scope, not by ${src.source} (${src.layer})` })
    }
  }

  for (const spec of input.registry.specs.values()) {
    const policy = spec.fallback ?? 'allowed'
    const base = (over: Partial<Provenance>): Provenance => ({ key: spec.key, state: 'missing', layer: null, source: null, policy, scopes: spec.scopes, ...over })
    const record = (p: Provenance, value: unknown) => {
      values[spec.key] = value
      provenance[spec.key] = spec.diagnostic || spec.secret ? p : { ...p, value: undefined }
      if (spec.diagnostic && !spec.secret) provenance[spec.key]!.value = value
    }

    type Candidate = { layer: ConfigLayer; source: ConfigSourceId; value: unknown }
    const candidates: Candidate[] = []
    const def = typeof spec.default === 'function' ? (spec.default as (ctx: { role: DeploymentRole; variables: Record<string, string | undefined> }) => unknown)({ role: input.role, variables }) : spec.default
    if (def !== undefined) candidates.push({ layer: 'platform', source: 'platform-default', value: def })
    if (spec.secret && spec.secretRef !== undefined && def === undefined) candidates.push({ layer: 'platform', source: 'platform-default', value: spec.secretRef })
    for (const src of input.sources) {
      if (!spec.scopes.includes(src.layer)) continue
      const v = readPath(src.values, spec.key)
      if (v !== undefined) candidates.push({ layer: src.layer, source: src.source, value: v })
    }
    if (spec.deploymentVariables && spec.scopes.includes('deployment')) {
      const names = typeof spec.deploymentVariables === 'function' ? spec.deploymentVariables({ role: input.role }) : spec.deploymentVariables
      for (const name of names) {
        const raw = variables[name]?.trim()
        if (raw) { candidates.push({ layer: 'deployment', source: 'deployment-variable', value: spec.secret ? name : coerceVariable(spec.type, raw) }); break }
      }
    }
    candidates.sort((a, b) => (a.layer === 'platform' ? 0 : LAYER_ORDER[a.layer]) - (b.layer === 'platform' ? 0 : LAYER_ORDER[b.layer]))

    let winner: Candidate | undefined
    let merged: unknown = undefined
    let disabled = false
    let invalid: string | undefined
    for (const c of candidates) {
      if (c.value === null) {
        if (spec.disable) { disabled = true; winner = c; merged = null; continue }
        findings.push({ severity: 'error', code: 'DISABLE_NOT_SUPPORTED', key: spec.key, source: c.source, message: `"${spec.key}" does not support null (explicit disable); leave it unset instead` })
        invalid = 'null is not a value for this key'
        continue
      }
      if (!typeMatches(spec.type, c.value)) {
        findings.push({ severity: 'error', code: 'TYPE', key: spec.key, source: c.source, message: `"${spec.key}" from ${c.source} must be a ${spec.type}` })
        invalid = `must be a ${spec.type}`
        continue
      }
      if (spec.secret && !SECRET_REF.test(String(c.value))) {
        findings.push({ severity: 'error', code: 'SECRET_REF_INVALID', key: spec.key, source: c.source, message: `"${spec.key}" from ${c.source} must be the NAME of a secret (a variable name); it looks like material` })
        invalid = 'not a secret reference'
        continue
      }
      if (spec.validate) {
        const problem = spec.validate(c.value as never)
        if (problem) { findings.push({ severity: 'error', code: 'TYPE', key: spec.key, source: c.source, message: `"${spec.key}" from ${c.source}: ${problem}` }); invalid = problem; continue }
      }
      disabled = false
      if (typeof spec.merge === 'function' && winner) merged = spec.merge(merged as never, c.value as never, { scope: c.layer === 'platform' ? 'workspace' : c.layer })
      else if (spec.merge === 'union' && Array.isArray(merged) && Array.isArray(c.value)) merged = [...new Set([...merged, ...c.value])]
      else merged = c.value
      winner = c
    }

    if (winner && !disabled && winner.layer !== mostSpecific(spec.scopes)) {
      if (policy === 'forbidden') {
        findings.push({ severity: 'error', code: 'FALLBACK', key: spec.key, source: winner.source, message: `"${spec.key}" must be set at ${mostSpecific(spec.scopes)} scope; a ${winner.layer} value may not serve it (fallback: forbidden)` })
        winner = undefined; merged = undefined
      } else if (policy === 'nonProductionOnly' && isProduction) {
        findings.push({ severity: 'error', code: 'FALLBACK', key: spec.key, source: winner.source, message: `"${spec.key}" inherits a ${winner.layer} value, which a production deployment may not use (fallback: nonProductionOnly)` })
        winner = undefined; merged = undefined
      }
    }

    const requiredHere = spec.required === true || (spec.required === 'production' && isProduction)
    if (!winner) {
      if (requiredHere) findings.push({ severity: 'error', code: 'REQUIRED', key: spec.key, message: `"${spec.key}" is required${spec.required === 'production' ? ' on a production deployment' : ''} and nothing sets it` })
      record(base({ state: invalid ? 'invalid' : 'missing', error: invalid }), undefined)
      continue
    }
    if (disabled) { record(base({ state: 'disabled', layer: winner.layer, source: winner.source }), null); continue }
    const state: ProvenanceState = winner.layer === 'platform' ? 'default' : winner.layer === mostSpecific(spec.scopes) ? (winner.layer === 'deployment' ? 'bound' : 'overridden') : 'inherited'
    if (spec.secret) {
      const ref = String(merged)
      secretRefs.set(spec.key, ref)
      const resolved = input.secrets?.has(ref) ?? false
      if (requiredHere && !resolved) findings.push({ severity: 'error', code: 'SECRET_MISSING', key: spec.key, message: `"${spec.key}" refers to ${ref}, which this deployment's secret provider${input.secrets ? ` (${input.secrets.kind})` : ''} does not have` })
      else if (spec.required === 'production' && !resolved) findings.push({ severity: 'warning', code: 'SECRET_MISSING', key: spec.key, message: `"${spec.key}" refers to ${ref}, which this deployment's secret provider does not have; a production deployment refuses to start without it` })
      record(base({ state, layer: winner.layer, source: winner.source, secret: { secretRef: ref, resolved, provider: input.secrets?.kind ?? 'none' } }), { secretRef: ref, resolved })
      continue
    }
    record(base({ state, layer: winner.layer, source: winner.source }), merged)
  }

  return { role: input.role, values, provenance, findings, secretRefs }
}

/** Only keys declared clientSafe, never a secret. The one route to a browser. */
export function clientSafeProjection(registry: ConfigRegistry, resolved: Pick<ResolvedConfig, 'values'>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of registry.specs.values()) {
    if (!spec.clientSafe || spec.secret) continue
    if (spec.key in resolved.values && resolved.values[spec.key] !== undefined) out[spec.key] = resolved.values[spec.key]
  }
  return out
}

/** The log and Doctor projection: provenance for every key, values only for diagnostic keys, never material. */
export function diagnosticProjection(registry: ConfigRegistry, resolved: Pick<ResolvedConfig, 'provenance'>): Provenance[] {
  return [...registry.specs.values()].map((spec) => {
    const p = resolved.provenance[spec.key]!
    return spec.diagnostic && !spec.secret ? p : { ...p, value: undefined }
  })
}
