/**
 * File Name: config-registry.ts
 * Purpose: The one configuration registry (tasks/plan-config-resolver.md,
 *          section 3). Every configuration key Tangen Core, a site or an
 *          extension declares is a ConfigKeySpec: what type it has, which
 *          layers may set it, how layers combine, whether it may inherit,
 *          whether it is a secret reference, whether a browser may see it.
 *          The resolver (config-resolver.ts) reads nothing else.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Grown from the extension manifest's `config` field
 *          (ExtensionConfigField), so an extension's declaration is already
 *          a registry fragment. Namespaces are enforced by the key itself,
 *          not only by `owner`: Core owns everything outside `site.*` and
 *          `ext.*`, a site owns `site.*`, an extension owns `ext.<id>.*`.
 *          A secret key is always a REFERENCE (a variable name the
 *          deployment's secret provider resolves); material never enters
 *          the registry, a config file, an installed option or a resolved
 *          value.
 */
import type { DeploymentRole } from './deployment-role'
import type { ExtensionConfigField } from './extension'

/** The layers a key may be SET at. */
export type ConfigScope = 'workspace' | 'deployment'

/** Where a resolved value actually came from - finer than the scope, so Doctor can say which source won. */
export type ConfigSourceId =
  | 'platform-default'
  | 'workspace-config'
  | 'installed-extension-option'
  | 'operator-map'
  | 'deployment-variable'

export type FallbackPolicy = 'allowed' | 'nonProductionOnly' | 'forbidden'

export type ConfigValueType = 'string' | 'number' | 'boolean' | 'string[]' | 'json' | 'url' | 'secretRef'

export type ConfigOwner = 'core' | 'site' | `extension:${string}` | `integration:${string}`

export interface DefaultContext {
  role: DeploymentRole
  variables: Record<string, string | undefined>
}

export type MergeRule<T = unknown> = 'replace' | 'union' | ((parent: T | undefined, child: T | undefined, ctx: { scope: ConfigScope }) => T | undefined)

export interface ConfigKeySpec<T = unknown> {
  /** Dotted path: 'ai.model', 'redis.url', 'ext.acme-crm.leadPrefix', 'site.supportEmail'. */
  key: string
  owner: ConfigOwner
  type: ConfigValueType
  /** The layers that may SET this key. Any other placement is a finding. */
  scopes: readonly ConfigScope[]
  /** The platform value when nothing sets it; a function may derive it from the deployment. */
  default?: T | ((ctx: DefaultContext) => T | undefined)
  /** true: on every deployment. 'production': only where the deployment role is production. */
  required?: boolean | 'production'
  /** Whether `null` means "explicitly off". Keys without it refuse null. */
  disable?: boolean
  /** How layers combine. Scalars replace; only string[] and json keys may name another rule. */
  merge?: MergeRule<T>
  /** Whether a less specific layer's value may serve a more specific one. Default 'allowed'. */
  fallback?: FallbackPolicy
  /** The value is a REFERENCE to secret material. Implies type 'secretRef'. */
  secret?: boolean
  /** The platform's default reference for a secret key (the variable a self-hosted deployment sets). */
  secretRef?: string
  /** Deployment variables the deployment layer reads for this key, most specific first. */
  deploymentVariables?: readonly string[] | ((ctx: { role: DeploymentRole }) => readonly string[])
  /** Eligible for the client-safe projection. Never true on a secret key. */
  clientSafe?: boolean
  /** May appear in logs and Doctor output with its value. clientSafe implies it. */
  diagnostic?: boolean
  validate?: (value: T) => string | null
  label?: string
  description?: string
}

export interface ConfigRegistry {
  readonly specs: ReadonlyMap<string, ConfigKeySpec>
  get(key: string): ConfigKeySpec | undefined
  /** Every key under a dotted prefix, e.g. 'ext.acme-crm'. */
  under(prefix: string): ConfigKeySpec[]
}

export class ConfigRegistryError extends Error {
  constructor(message: string, public readonly key: string) {
    super(message)
    this.name = 'ConfigRegistryError'
  }
}

const KEY = /^[a-z][a-zA-Z0-9]*(?:[-_.][a-zA-Z0-9]+)*$/
/** A secret reference is a variable name; anything else is material where a name belongs. */
export const SECRET_REF = /^[A-Z][A-Z0-9_]*$/

/** The namespace a key belongs to, by its first segments. */
export function namespaceOf(key: string): { owner: ConfigOwner; prefix: string } {
  if (key === 'site' || key.startsWith('site.')) return { owner: 'site', prefix: 'site' }
  const ext = /^ext\.([^.]+)(?:\.|$)/.exec(key)
  if (ext) return { owner: `extension:${ext[1]}`, prefix: `ext.${ext[1]}` }
  const integration = /^integration\.([^.]+)(?:\.|$)/.exec(key)
  if (integration) return { owner: `integration:${integration[1]}`, prefix: `integration.${integration[1]}` }
  return { owner: 'core', prefix: '' }
}

/**
 * Refuses duplicates, a key whose namespace contradicts its owner, a secret
 * key that is not a reference, a secret key that claims to be client-safe,
 * and a merge rule on a scalar. Nothing else is decided here.
 */
export function createConfigRegistry(specs: readonly ConfigKeySpec[]): ConfigRegistry {
  const map = new Map<string, ConfigKeySpec>()
  for (const raw of specs) {
    const spec = normalise(raw)
    if (!KEY.test(spec.key)) throw new ConfigRegistryError(`"${spec.key}" is not a configuration key (dotted lower-case segments)`, spec.key)
    if (map.has(spec.key)) throw new ConfigRegistryError(`"${spec.key}" is declared twice`, spec.key)
    const ns = namespaceOf(spec.key)
    if (ns.owner !== spec.owner) {
      throw new ConfigRegistryError(`"${spec.key}" belongs to ${describeOwner(ns.owner)} by its name, but is declared by ${describeOwner(spec.owner)}`, spec.key)
    }
    if (spec.scopes.length === 0) throw new ConfigRegistryError(`"${spec.key}" allows no scope; nothing could ever set it`, spec.key)
    if (spec.secret) {
      if (spec.type !== 'secretRef') throw new ConfigRegistryError(`"${spec.key}" is a secret, so its type is 'secretRef' (a variable name), not '${spec.type}'`, spec.key)
      if (spec.clientSafe) throw new ConfigRegistryError(`"${spec.key}" is a secret and can never be client-safe`, spec.key)
      if (spec.secretRef !== undefined && !SECRET_REF.test(spec.secretRef)) throw new ConfigRegistryError(`"${spec.key}": secretRef "${spec.secretRef}" is not a variable name`, spec.key)
    }
    if (spec.merge !== undefined && spec.merge !== 'replace' && spec.type !== 'string[]' && spec.type !== 'json') {
      throw new ConfigRegistryError(`"${spec.key}" is a ${spec.type}; only string[] and json keys may name a merge rule`, spec.key)
    }
    map.set(spec.key, spec)
  }
  return {
    specs: map,
    get: (key) => map.get(key),
    under: (prefix) => [...map.values()].filter((s) => s.key === prefix || s.key.startsWith(`${prefix}.`)),
  }
}

function normalise(spec: ConfigKeySpec): ConfigKeySpec {
  const out: ConfigKeySpec = { fallback: 'allowed', ...spec }
  if (out.secret && out.type !== 'secretRef' && out.type === 'string') out.type = 'secretRef'
  if (out.clientSafe) out.diagnostic = true
  return out
}

function describeOwner(owner: ConfigOwner): string {
  return owner === 'core' ? 'Tangen Core' : owner === 'site' ? 'the site' : owner.startsWith('integration:') ? `integration "${owner.slice('integration:'.length)}"` : `extension "${owner.slice('extension:'.length)}"`
}

// ── Extension declarations → registry fragment ────────────────────────────────

/**
 * An extension's manifest is already a registry fragment: `config` becomes
 * `ext.<id>.<key>` (workspace-scoped options, as the documented contract
 * says; a `secret: true` field is a reference the workspace names), and
 * `secrets` become `ext.<id>.secret.<NAME>` (deployment references, required in production).
 */
export function extensionConfigSpecs(
  extensionId: string,
  manifest: { config?: Record<string, ExtensionConfigField>; secrets?: readonly string[] },
): ConfigKeySpec[] {
  const owner: ConfigOwner = `extension:${extensionId}`
  const out: ConfigKeySpec[] = []
  for (const [name, field] of Object.entries(manifest.config ?? {})) {
    out.push({
      key: `ext.${extensionId}.${name}`,
      owner,
      type: field.secret ? 'secretRef' : (field.type as ConfigValueType),
      scopes: ['workspace'],
      default: field.default,
      required: field.required,
      secret: field.secret === true,
      fallback: 'allowed',
      label: field.label,
      description: field.description,
    })
  }
  for (const name of manifest.secrets ?? []) {
    out.push({
      key: `ext.${extensionId}.secret.${name}`,
      owner,
      type: 'secretRef',
      scopes: ['deployment'],
      secret: true,
      secretRef: name,
      // Required where it matters: a laptop without a vendor key still boots;
      // a production deployment without it does not.
      required: 'production',
      fallback: 'allowed',
      description: `Deployment credential ${name} declared by ${extensionId}`,
    })
  }
  return out
}

// ── Site declarations ─────────────────────────────────────────────────────────

/** One key a site declares in `app/config/site.ts`. The key name is the object key; the path becomes `site.<name>`. */
export type SiteConfigField<T = unknown> = Omit<ConfigKeySpec<T>, 'key' | 'owner'>

export type SiteConfigDeclaration = Record<string, SiteConfigField>

/**
 * Identity helper for `app/config/site.ts`; the literal keys are kept so the
 * site's own types can name them (see `TangenSiteConfig` in custom-routes).
 */
export function defineSiteConfig<const T extends SiteConfigDeclaration>(declaration: T): T {
  return declaration
}

export function siteConfigSpecs(declaration: SiteConfigDeclaration | undefined): ConfigKeySpec[] {
  return Object.entries(declaration ?? {}).map(([name, field]) => ({ ...field, key: `site.${name}`, owner: 'site' as const }))
}
