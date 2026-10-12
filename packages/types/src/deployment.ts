/**
 * File Name: deployment.ts
 * Purpose: One ResolvedDeployment per workspace, composed from a project the
 *          way the loaders carry it (tasks/plan-config-resolver.md, sections
 *          6, 15, 17; tasks/remove-environments-programme.md, stage R5):
 *          the registry of Core, the site and the registered extensions;
 *          the sources - workspace config, Admin-typed installed options,
 *          the operator's gateway map, the deployment's variables; the
 *          secret provider; the deployment role of the process. Pure, so the
 *          API's boot and the CLI's commands resolve through the same code
 *          and can never disagree.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The resolved object carries the NO_LOG mark and a
 *          `toJSON` that yields nothing (amendment C). `values` and
 *          `provenance` are plain data; `diagnostics()` is the explicit log
 *          projection and `clientSafe()` the only browser projection.
 */
import { createConfigRegistry, extensionConfigSpecs, siteConfigSpecs, type ConfigRegistry, type SiteConfigDeclaration } from './config-registry'
import { coreConfigSpecs } from './core-config-keys'
import { integrationConfigSpecs, type IntegrationsDeclaration, type ResolvedIntegration } from './integrations'
import { resolveConfig, clientSafeProjection, diagnosticProjection, type ConfigSource, type ResolvedConfig, type Provenance } from './config-resolver'
import { createSecretAccessor, envSecretProvider, NO_LOG, type SecretAccessor, type SecretProvider } from './secret-provider'
import { resolveDeploymentRole, type DeploymentRole } from './deployment-role'
import type { ExtensionConfigField } from './extension'
import { AI_PROVIDER_SECRET_REFS } from './core-config-keys'

export interface ManifestLike { config?: Record<string, ExtensionConfigField>; secrets?: readonly string[] }

/** What the composition needs from a project - WorkspaceProject and a CLI's effective config both fit. */
export interface DeploymentProjectLike {
  workspaceId: string
  config?: Record<string, unknown>
  declaredExtensions?: ReadonlyArray<{ id?: string; resolve?: string; options?: Record<string, unknown> }>
  siteConfig?: SiteConfigDeclaration
  /** `app/config/integrations.ts`. */
  integrations?: IntegrationsDeclaration
  /** The operator's gateway policy for this deployment (the `gateway` key of the root tangen.config.ts), the ceiling a workspace may only narrow. */
  deploymentGateway?: unknown
}

export interface ResolvedDeployment extends ResolvedConfig {
  workspaceId: string
  registry: ConfigRegistry
  secrets: SecretAccessor
  get<T = unknown>(key: string): T | undefined
  explain(key: string): Provenance | undefined
  /** Only keys declared clientSafe. The one route to a browser. */
  clientSafe(): Record<string, unknown>
  /** The explicit log and Doctor projection: provenance, values only for diagnostic keys, never material. */
  diagnostics(): Provenance[]
  /** The extension's own keys as its ctx.options: `ext.<id>.<name>` → name. Secret keys are omitted. */
  extensionOptions(extensionId: string): Record<string, unknown>
  /** The site's own keys: `site.<name>` → name. Secret keys are omitted. */
  siteValues(): Record<string, unknown>
  /** A secret accessor answering a short name under one or more prefixes (`ext.<id>.secret`, `ext.<id>`, `site`). */
  scopedSecrets(prefixes: string[]): SecretAccessor
  /** One declared integration, resolved: its settings, its credentials from this deployment, whether every credential resolved. Undefined when not declared. */
  integration(name: string): ResolvedIntegration | undefined
}

export interface ResolveProjectDeploymentInput {
  project: DeploymentProjectLike
  /** The deployment role; resolved from `variables` (TANGEN_DEPLOYMENT_ROLE, else NODE_ENV) when omitted. */
  role?: DeploymentRole
  /** The registered extension's manifest, for its keys; undefined when unknown (the CLI). */
  manifestOf?: (id: string) => ManifestLike | undefined
  /** `workspace_installed_apps.options` per extension id for this workspace. */
  installedOptions?: Record<string, Record<string, unknown>>
  /**
   * The extensions ACTIVE in this workspace (installed and enabled). A
   * declared extension that is not active keeps its keys in the registry -
   * options still type, Doctor still explains - but nothing it declares is
   * REQUIRED: a credential for an extension that is not installed cannot
   * refuse a production boot. Omitted (a caller without install state):
   * nothing an extension declares is required.
   */
  activeExtensions?: ReadonlyArray<string>
  variables?: Record<string, string | undefined>
  secrets?: SecretProvider
}

const extensionIdOf = (e: { id?: string; resolve?: string }): string =>
  (e.id ?? e.resolve ?? '').replace(/^@tangen\/ext-/, '').replace(/^\.\.\/extensions\//, '').replace(/^\.\//, '')

/**
 * The registry for one project: Core, the site's declarations, and every
 * extension whose manifest is known. An extension's requirements apply only
 * where it is active (`activeExtensions`); elsewhere its keys are declared
 * but optional - declared ≠ installed ≠ enabled ≠ active.
 */
export function projectRegistry(
  project: DeploymentProjectLike,
  manifestOf: (id: string) => ManifestLike | undefined = () => undefined,
  activeExtensions: ReadonlyArray<string> = [],
): ConfigRegistry {
  const declaration = project.siteConfig ?? (project.config as { siteConfig?: SiteConfigDeclaration } | undefined)?.siteConfig
  const integrations = project.integrations ?? (project.config as { integrations?: IntegrationsDeclaration } | undefined)?.integrations
  const specs = [...coreConfigSpecs(), ...siteConfigSpecs(declaration), ...integrationConfigSpecs(integrations)]
  const active = new Set(activeExtensions)
  for (const e of project.declaredExtensions ?? []) {
    const id = extensionIdOf(e)
    const m = id ? manifestOf(id) : undefined
    if (!m) continue
    const fragment = extensionConfigSpecs(id, m)
    specs.push(...(active.has(id) ? fragment : fragment.map((s) => ({ ...s, required: false }))))
  }
  return createConfigRegistry(specs)
}

/** Keys of the workspace config that are declarations or loader carry-overs, never configuration values. */
const NOT_VALUES = ['siteConfig', 'integrations', 'workspaceId', 'name', 'slug', 'declaredExtensions', 'extensions', 'customTables', 'apiResources', 'formsBehavior', 'members', 'deploymentGateway']

export function resolveProjectDeployment(input: ResolveProjectDeploymentInput): ResolvedDeployment {
  const { project } = input
  const variables = input.variables ?? process.env
  const role = input.role ?? resolveDeploymentRole(variables)
  const registry = projectRegistry(project, input.manifestOf, input.activeExtensions)
  const secrets = input.secrets ?? envSecretProvider()
  const config = (project.config ?? {}) as Record<string, unknown>

  const extOptions: Record<string, Record<string, unknown>> = {}
  for (const e of project.declaredExtensions ?? []) { const id = extensionIdOf(e); if (id && e.options) extOptions[id] = e.options }
  const workspaceValues: Record<string, unknown> = { ...config, ext: extOptions }
  for (const k of NOT_VALUES) delete workspaceValues[k]
  const operator = (project.deploymentGateway ?? (config.deploymentGateway as unknown)) as { gateway?: unknown } | unknown

  const sources: ConfigSource[] = [
    { source: 'workspace-config', layer: 'workspace', values: workspaceValues },
    { source: 'installed-extension-option', layer: 'workspace', values: { ext: input.installedOptions ?? {} } },
    { source: 'operator-map', layer: 'deployment', values: { gateway: operator } },
  ]
  const resolved = resolveConfig({ registry, role, sources, variables, secrets })
  const accessor = createSecretAccessor(resolved.secretRefs, secrets)
  const slice = (prefix: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const spec of registry.under(prefix)) {
      if (spec.secret) continue
      const v = resolved.values[spec.key]
      if (v !== undefined) out[spec.key.slice(prefix.length + 1)] = v
    }
    return out
  }
  const noLog = (o: object) => {
    Object.defineProperty(o, NO_LOG, { value: true, enumerable: false })
    Object.defineProperty(o, 'toJSON', { value: () => undefined, enumerable: false })
    return o
  }
  const deployment: ResolvedDeployment = {
    ...resolved,
    workspaceId: project.workspaceId,
    registry,
    secrets: accessor,
    get: <T,>(key: string) => resolved.values[key] as T | undefined,
    explain: (key) => resolved.provenance[key],
    clientSafe: () => clientSafeProjection(registry, resolved),
    diagnostics: () => diagnosticProjection(registry, resolved),
    extensionOptions: (id) => slice(`ext.${id}`),
    siteValues: () => slice('site'),
    integration: (name) => {
      const prefix = `integration.${name}`
      const specs = registry.under(prefix)
      if (specs.length === 0) return undefined
      const secretKeys = specs.filter((s) => s.secret).map((s) => s.key)
      return noLog({
        name,
        values: slice(prefix),
        secrets: deployment.scopedSecrets([prefix]),
        ready: secretKeys.every((k) => (resolved.values[k] as { resolved?: boolean } | undefined)?.resolved === true),
      }) as ResolvedIntegration
    },
    scopedSecrets: (prefixes) => {
      const full = (name: string) => {
        if (registry.get(name)?.secret) return name
        for (const p of prefixes) { const k = `${p}.${name}`; if (registry.get(k)?.secret) return k }
        return undefined
      }
      return noLog({
        get: (name: string) => { const k = full(name); return k ? accessor.get(k) : undefined },
        has: (name: string) => { const k = full(name); return k ? accessor.has(k) : false },
        provider: accessor.provider,
      }) as SecretAccessor
    },
  }
  noLog(deployment)
  return deployment
}

/**
 * The embedding key for one embeddings config, as material from this
 * deployment's provider: `knowledge.embeddings.apiKey` when it names a
 * variable, else the named provider's own `ai.apiKey.<provider>` reference.
 * The API and the CLI both hand this to @tangen/knowledge, which reads
 * nothing from the process.
 */
export function embeddingsApiKeyFor(deployment: ResolvedDeployment, embeddings: { provider?: string }): string | undefined {
  const own = deployment.secrets.get('knowledge.embeddings.apiKey')
  if (own) return own
  const provider = embeddings.provider
  return provider && provider in AI_PROVIDER_SECRET_REFS ? deployment.secrets.get(`ai.apiKey.${provider}`) : undefined
}
