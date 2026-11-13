/**
 * File Name: deployment-validation.ts
 * Purpose: The ONE deployment validator (tasks/remove-environments-programme.md,
 *          stage R5): every resolution finding of this deployment, production
 *          on local media, replicas over local media. Boot logs and refuses
 *          on an error; `tangen doctor --deployment` prints the same list with
 *          provenance. Neither reimplements a rule.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ConfigFinding } from './config-resolver'
import type { ResolvedDeployment } from './deployment'

export interface DeploymentFinding {
  severity: 'error' | 'warning' | 'info'
  /**
   * Config resolution's own codes, plus every code a deployment check emits.
   *
   * The second group had fallen behind the code: `tangen doctor --deployment`
   * and `doctor-connections.ts` were pushing nine codes this union did not
   * name, so the findings they produce were a type error in published
   * TypeScript. These are deployment findings, which is what this type is for,
   * so they belong here rather than in a widened local alias.
   */
  code:
    | ConfigFinding['code']
    | 'LOCAL_MEDIA_PRODUCTION' | 'LOCAL_MEDIA_REPLICAS' | 'LOCAL_DEFAULT_DATABASE' | 'STORAGE_ADAPTER_UNKNOWN'
    | 'PUBLIC_URL_UNSET'
    | 'DANGLING_GRANT' | 'COARSE_CAPABILITY'
    | 'CONNECTION_UNREADABLE' | 'CONNECTIONS_KEY_DERIVED'
    | 'CONNECTION_PROVIDER_CONFLICT' | 'CONNECTION_DORMANT' | 'CONNECTION_PENDING'
    | 'CONNECTION_HEALTH_FAILED' | 'CONNECTION_NEEDS_CAPABILITY' | 'CONNECTOR_PACK_DISABLED'
  message: string
  workspace?: string
  key?: string
}

export interface ValidateProjectDeploymentInput {
  project: { workspaceId: string; slug?: string }
  deployment: ResolvedDeployment
  replicas?: number
  /** The storage adapter ids this deployment can build (core's plus the active extensions' `storage.provider@1`); absent when the caller loads no servers (the CLI). */
  knownStorageAdapters?: readonly string[]
}

export function validateProjectDeployment(input: ValidateProjectDeploymentInput): DeploymentFinding[] {
  const out: DeploymentFinding[] = []
  const seen = new Set<string>()
  const push = (f: DeploymentFinding) => { const k = `${f.code}|${f.message}`; if (!seen.has(k)) { seen.add(k); out.push(f) } }
  const ws = input.project.workspaceId
  const r = input.deployment

  for (const f of r.findings) push({ severity: f.severity, code: f.code, message: f.message, workspace: ws, key: f.key })

  // Extension Kernel K8.2: a deployment naming an adapter nobody here provides cannot serve media.
  if (input.knownStorageAdapters) {
    const adapter = r.get<string | null>('storage.adapter')
    if (typeof adapter === 'string' && adapter !== '' && !input.knownStorageAdapters.includes(adapter)) {
      push({ severity: 'error', code: 'STORAGE_ADAPTER_UNKNOWN', message: `storage.adapter names '${adapter}', which nothing here provides (known: ${input.knownStorageAdapters.join(', ')}); install and enable the extension whose storage.provider@1 contributes it, or name a core adapter`, workspace: ws, key: 'storage.adapter' })
    }
  }

  // A public URL nobody named, outside development. The deployment serves
  // every page correctly and hands out wrong links: `server.url` is what the
  // share dialog, an embed script tag and a notification mail are built from,
  // and its default is a localhost URL in development and NOTHING at all in
  // staging or production. MEASURED on a real deployment 2026-11-13: with no
  // SERVER_URL, the Forms share dialog published
  // `http://localhost/api/v1/ext/forms/...` to be pasted into a website.
  //
  // Derived from the registry rather than from a list of keys, so a URL key
  // added later is covered the day it is added.
  if (r.role !== 'development') {
    for (const spec of r.registry.specs.values()) {
      if (spec.type !== 'url' || spec.secret) continue
      if (!spec.scopes.includes('deployment')) continue
      // `deploymentVariables` may be a function of the role; only a plain
      // list names a variable an operator can be told to set.
      const vars = spec.deploymentVariables
      const variable = Array.isArray(vars) ? vars[0] : undefined
      if (!variable) continue
      const value = r.get<string | null>(spec.key)
      if (typeof value === 'string' && value.trim() !== '') continue
      if (value === null) continue                      // explicitly disabled is a decision
      push({
        severity: 'warning',
        code: 'PUBLIC_URL_UNSET',
        message: `${spec.key} is not set on this ${r.role} deployment: set ${variable} to the address callers actually use. Until then every absolute link built from it - share dialogs, embed snippets, notification mails - falls back to the request, and to "http://localhost" where there is no request to read.`,
        workspace: ws,
        key: spec.key,
      })
    }
  }

  // D6: local media is per machine. One production replica is warned; several are refused.
  const replicas = Math.max(1, Math.floor(input.replicas ?? 1))
  if (r.role === 'production') {
    const adapter = r.get<string | null>('storage.adapter')
    if (adapter === null || adapter === undefined || adapter === 'local') {
      if (replicas > 1) {
        push({ severity: 'error', code: 'LOCAL_MEDIA_REPLICAS', message: `production stores media on local disk (storage.adapter local) with TANGEN_REPLICAS=${replicas}: each replica would hold a different set of files. Use the s3 adapter (or a shared MEDIA_DIR mounted on every replica) before running more than one replica.`, workspace: ws, key: 'storage.adapter' })
      } else {
        push({ severity: 'warning', code: 'LOCAL_MEDIA_PRODUCTION', message: 'production stores media on local disk (storage.adapter local): back MEDIA_DIR up, and switch to the s3 adapter before running replicas.', workspace: ws, key: 'storage.adapter' })
      }
    }
  }
  return out
}

export function deploymentRefusal(findings: DeploymentFinding[]): string | null {
  const errors = findings.filter((f) => f.severity === 'error')
  return errors.length ? `deployment refused: ${errors.length} configuration error${errors.length === 1 ? '' : 's'} (see above)` : null
}

export function logDeploymentFindings(findings: DeploymentFinding[], log: { error: (m: string) => void; warning: (m: string) => void; info: (m: string) => void }): void {
  for (const f of findings) {
    const line = `[${f.workspace ?? '-'}] ${f.message}`
    if (f.severity === 'error') log.error(line)
    else if (f.severity === 'warning') log.warning(line)
    else log.info(line)
  }
}
