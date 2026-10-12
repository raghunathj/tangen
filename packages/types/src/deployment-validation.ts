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
  code: ConfigFinding['code'] | 'LOCAL_MEDIA_PRODUCTION' | 'LOCAL_MEDIA_REPLICAS' | 'LOCAL_DEFAULT_DATABASE' | 'STORAGE_ADAPTER_UNKNOWN'
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
