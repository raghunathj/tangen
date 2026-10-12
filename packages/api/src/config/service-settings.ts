/**
 * File Name: service-settings.ts
 * Purpose: The slices Core services receive from the resolved deployment
 *          (tasks/plan-config-resolver.md, section 11): mail, storage and
 *          the AI secrets, by workspace. Services stop
 *          resolving; they are handed values, and read material only
 *          through the accessor.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { EmbeddingsConfig, MailConfig, StorageConfig, WorkspaceProject } from '@tangen/types'
import { embeddingsApiKeyFor } from '@tangen/types'
import { resolveProjectDeployment, type ResolvedDeployment } from '@tangen/types'
import { resolvedFor } from './state'

/** The deployment for a workspace: boot's, or - before boot, in a test - composed on the spot from the project. */
export function deploymentFor(project: WorkspaceProject | undefined): ResolvedDeployment | undefined {
  const fromBoot = resolvedFor(project?.workspaceId)
  if (fromBoot || !project) return fromBoot
  return resolveProjectDeployment({ project: project as never })
}

export interface MailSettings {
  service?: string
  fromEmail?: string
  fromName?: string
  smtp: { host: string; port: number; user?: string; pass?: string }
  /** The SendGrid or Resend key, as material, for the adapter only. */
  apiKey?: string
}

/**
 * Mail settings for a workspace. The resolved keys carry the
 * workspace's mail config (app/config/mail.ts is the workspace layer) under
 * the environment file and the deployment's variables; `config` stands in
 * only where no deployment was resolved (a unit test, a bare adapter call).
 */
export function mailSettingsFor(workspaceId: string | undefined, config?: MailConfig): MailSettings {
  const r = resolvedFor(workspaceId)
  return {
    service: r ? r.get<string>('mail.service') : config?.service,
    fromEmail: r ? r.get<string>('mail.fromEmail') : config?.fromEmail,
    fromName: r ? r.get<string>('mail.fromName') : config?.fromName,
    smtp: {
      host: r?.get<string>('mail.smtp.host') ?? 'localhost',
      port: r?.get<number>('mail.smtp.port') ?? 587,
      user: r?.secrets.get('mail.smtp.user'),
      pass: r?.secrets.get('mail.smtp.pass'),
    },
    apiKey: r?.secrets.get('mail.apiKey'),
  }
}

/** The storage config for a workspace, values and credentials resolved; a custom adapter object in the config wins. */
export function storageConfigFor(project: WorkspaceProject | undefined): StorageConfig {
  const authored = project?.storage ?? {}
  if (authored.adapter && typeof authored.adapter === 'object') return authored
  const r = deploymentFor(project)
  if (!r) return authored
  const adapter = r.get<string | null>('storage.adapter')
  return {
    ...authored,
    // K8.2: any provider id rides through; the storage registry resolves it (an unknown one is a clear error there).
    adapter: (adapter === null ? undefined : (adapter as 'local' | 's3' | undefined)) ?? 'local',
    mediaDir: r.get<string>('storage.mediaDir') ?? authored.mediaDir,
    bucket: r.get<string>('storage.bucket') ?? authored.bucket,
    region: r.get<string>('storage.region') ?? authored.region,
    endpoint: r.get<string>('storage.endpoint') ?? authored.endpoint,
    publicBaseUrl: r.get<string>('storage.publicBaseUrl') ?? authored.publicBaseUrl,
    accessKeyId: r.secrets.get('storage.accessKeyId'),
    secretAccessKey: r.secrets.get('storage.secretAccessKey'),
  }
}

/**
 * The embeddings config with its key resolved to material for the adapter:
 * `knowledge.embeddings.apiKey` when it names a variable, else the named
 * provider's own `ai.apiKey.<provider>` reference. The @tangen/knowledge
 * package reads nothing from the process (plan-config-resolver section 11).
 */
export function embeddingsSettingsFor(project: WorkspaceProject | undefined, embeddings: EmbeddingsConfig): EmbeddingsConfig {
  const r = deploymentFor(project)
  return { ...embeddings, apiKey: r ? embeddingsApiKeyFor(r, embeddings) : undefined }
}
