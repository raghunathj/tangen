/**
 * File Name: integrations.ts
 * Purpose: Code-declared integrations (plan-environment-architecture
 *          section 8, D4; Stage 3 E): a third-party service a site talks
 *          to, declared once in `app/config/integrations.ts` as a registry
 *          fragment - its non-secret settings and its credential
 *          REFERENCES. Values come from the workspace and environment
 *          files; material from the deployment's secret provider; routes
 *          and jobs read the resolved integration through `ctx.integration`.
 *          Nothing here is a provider abstraction: it is configuration, on
 *          the same resolver as Core, the site and the extensions.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A credential defaults to `fallback: 'forbidden'` and
 *          `required: 'production'`: production must supply the variable the
 *          reference names (a workspace or environment file may name a
 *          different variable for non-production, never for production).
 */
import type { ConfigKeySpec, ConfigScope, FallbackPolicy } from './config-registry'

export interface IntegrationSetting {
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'json' | 'url'
  /** Default ['workspace']. */
  scopes?: readonly ConfigScope[]
  default?: unknown
  required?: boolean | 'production'
  clientSafe?: boolean
  label?: string
  description?: string
}

export interface IntegrationCredential {
  /** The NAME of the variable the deployment supplies (e.g. 'STRIPE_API_KEY'). Never a value. */
  secretRef: string
  /** Default 'forbidden': production binds its own. 'nonProductionOnly' lets a workspace-named reference serve outside production. */
  fallback?: FallbackPolicy
  /** Default 'production'. */
  required?: boolean | 'production'
  /** Default ['workspace', 'deployment']: a workspace may NAME a reference; the deployment binds it (fallback decides whether the name may serve). */
  scopes?: readonly ConfigScope[]
  label?: string
  description?: string
}

export interface IntegrationDeclaration {
  label?: string
  config?: Record<string, IntegrationSetting>
  secrets?: Record<string, IntegrationCredential>
}

export type IntegrationsDeclaration = Record<string, IntegrationDeclaration>

/** Identity helper for `app/config/integrations.ts`. */
export function defineIntegrations<const T extends IntegrationsDeclaration>(declaration: T): T {
  return declaration
}

const NAME = /^[a-z][a-z0-9-]*$/

/** The registry fragment of every declared integration: `integration.<name>.<key>`, owned by `integration:<name>`. */
export function integrationConfigSpecs(declaration: IntegrationsDeclaration | undefined): ConfigKeySpec[] {
  const out: ConfigKeySpec[] = []
  for (const [name, decl] of Object.entries(declaration ?? {})) {
    if (!NAME.test(name)) throw new Error(`integration "${name}": the name is lower-case letters, digits and hyphens`)
    const owner = `integration:${name}` as const
    for (const [key, field] of Object.entries(decl.config ?? {})) {
      out.push({
        key: `integration.${name}.${key}`, owner, type: field.type,
        scopes: field.scopes ?? ['workspace'],
        default: field.default, required: field.required, clientSafe: field.clientSafe, fallback: 'allowed',
        label: field.label, description: field.description,
      })
    }
    for (const [key, cred] of Object.entries(decl.secrets ?? {})) {
      out.push({
        key: `integration.${name}.${key}`, owner, type: 'secretRef', secret: true,
        secretRef: cred.secretRef,
        scopes: cred.scopes ?? ['workspace', 'deployment'],
        fallback: cred.fallback ?? 'forbidden',
        required: cred.required ?? 'production',
        // The deployment binds the credential by supplying the variable the reference names.
        deploymentVariables: [cred.secretRef],
        label: cred.label, description: cred.description ?? `${name}: ${key}, as the NAME of the variable holding it`,
      })
    }
  }
  return out
}

/** What a route or job receives for one integration. */
export interface ResolvedIntegration {
  name: string
  /** Non-secret settings by declared key. */
  values: Record<string, unknown>
  /** The credentials by declared key, from this deployment's provider. */
  secrets: { get(name: string): string | undefined; has(name: string): boolean }
  /** Every declared credential resolved in this deployment. */
  ready: boolean
}
