/**
 * File Name: index.ts
 * Purpose: Storage adapter registry + per-(workspace, environment) resolution
 *          — mirrors the AI provider pattern (factory per backend, throw on
 *          unknown) with the config priority envConfig.storage >
 *          workspace.storage > local default.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { storageConfigFor } from '../../config/service-settings'
import type { StorageAdapter, StorageConfig, WorkspaceProject, StorageProviderEntry, StorageProviderDefinition } from '@tangen/types'
import { validateStorageProvider, CORE_STORAGE_ADAPTERS } from '@tangen/types'
import { contributions, noteContributionWarning } from '../../kernel/contributions'
import { createLocalStorage } from './local'

// Lazy-required so the registry compiles while backends land incrementally
// (bun supports require() in ESM; the s3 module is server-only).
function getS3Factory(): (config: StorageConfig) => StorageAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./s3').createS3Storage
}

// ── The provider registry (Extension Kernel K8.2) ───────────────────────────

/** Core's adapters as providers: the same shape an extension contributes. */
const CORE_PROVIDERS: StorageProviderEntry[] = [
  { id: 'local', label: 'Local disk', description: 'Files under storage.mediaDir (default public/media); one replica only', source: 'core', create: (config) => createLocalStorage({ mediaDir: config.mediaDir }) },
  { id: 's3', label: 'S3-compatible', description: 'S3, R2, Spaces, MinIO, GCS interop - picked by endpoint', source: 'core', create: (config) => getS3Factory()(config) },
]

// Which extensions are active per workspace, registered at boot; null = every loaded server counts
// (a storage adapter is deployment infrastructure the operator named in config).
let _activeScope: ((workspaceId: string) => ReadonlySet<string> | null) | null = null
export function setStorageProvidersScope(fn: ((workspaceId: string) => ReadonlySet<string> | null) | null): void {
  _activeScope = fn
  _cache.clear()
}

/** Core's providers, then what the active extensions contribute (validated; an invalid one is dropped with a warning). */
export function listStorageProviders(workspaceId?: string): StorageProviderEntry[] {
  const out = [...CORE_PROVIDERS]
  const taken = new Set(out.map((p) => p.id))
  const active = workspaceId !== undefined ? _activeScope?.(workspaceId) ?? null : null
  for (const c of contributions<StorageProviderDefinition>('storage.provider@1', { ...(active ? { activeIds: active } : {}), ...(workspaceId !== undefined ? { workspaceId } : {}) })) {
    const issues = validateStorageProvider(c.item)
    if (issues.length) {
      noteContributionWarning(`storage.provider@1 '${String((c.item as { id?: unknown })?.id ?? '?')}' from extension "${c.extensionId}" dropped: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`)
      continue
    }
    if (taken.has(c.item.id)) { noteContributionWarning(`storage.provider@1 from extension "${c.extensionId}" dropped: adapter id '${c.item.id}' is already taken`); continue }
    taken.add(c.item.id)
    out.push({ ...c.item, source: { extensionId: c.extensionId } })
  }
  return out
}

/** The adapter ids this deployment can build for a workspace - what boot hands the deployment validator. */
export function knownStorageAdapters(workspaceId?: string): string[] {
  return listStorageProviders(workspaceId).map((p) => p.id)
}

/** Instantiates an adapter for a config (custom instance passes through; an id goes through the provider registry). */
export function getStorageAdapter(config: StorageConfig = {}, scope?: { workspaceId?: string }): StorageAdapter {
  const adapter = config.adapter ?? 'local'
  if (typeof adapter === 'object') return adapter
  const providers = listStorageProviders(scope?.workspaceId)
  const provider = providers.find((p) => p.id === adapter)
  if (!provider) throw new Error(`Unknown storage adapter: ${String(adapter)} (known: ${providers.map((p) => p.id).join(', ')}; core: ${CORE_STORAGE_ADAPTERS.join(', ')})`)
  return provider.create(config as never)
}

// One adapter per (workspace, env) — clients (S3) hold connection state
const _cache = new Map<string, StorageAdapter>()

/** Test helper — clears memoized adapters. */
export function resetStorageCache(): void {
  _cache.clear()
}

/**
 * Resolves the storage adapter for a workspace + environment slug.
 * Priority: the environment's `storage` override > the workspace `storage`
 * config > local disk.
 */
export function resolveStorage(
  project: WorkspaceProject | undefined,
): StorageAdapter {
  const cacheKey = `${project?.workspaceId ?? '_'}`
  const cached = _cache.get(cacheKey)
  if (cached) return cached

  // The resolved deployment's storage slice: values by layer, credentials by
  // the accessor (plan-config-resolver section 11); an adapter object in the
  // config wins as before.
  const config = storageConfigFor(project)
  const adapter = getStorageAdapter(config, { workspaceId: project?.workspaceId })
  _cache.set(cacheKey, adapter)
  return adapter
}

// Boot-time projects provider so deep services (media loader) can resolve a
// workspace's adapter without threading ctx through every call site.
let _projectsProvider: (() => WorkspaceProject[]) | null = null

export function setStorageProjectsProvider(fn: () => WorkspaceProject[]): void {
  _projectsProvider = fn
}

/** Resolves by raw ids using the boot-registered projects provider. */
export function resolveStorageByIds(workspaceId: string): StorageAdapter {
  const project = _projectsProvider?.().find((p) => p.workspaceId === workspaceId)
  return resolveStorage(project)
}
