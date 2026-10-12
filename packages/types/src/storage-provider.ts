/**
 * File Name: storage-provider.ts
 * Purpose: The storage provider contract (Extension Kernel K8.2,
 *          tasks/plan-extension-kernel.md). A storage provider is a
 *          contribution on `storage.provider@1`: an id the deployment names
 *          in `storage.adapter`, a label, and `create(config)` returning a
 *          StorageAdapter built from the resolved `storage.*` slice. Core's
 *          `local` and `s3` are listed in the same shape, so the adapter
 *          switch is one registry rather than a case list. Pure.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { StorageAdapter, StorageConfig } from './storage'

/** The grant an extension needs to contribute a storage provider. */
export const STORAGE_PROVIDE_GRANT = 'storage:provide'
/** The ids core provides; a contribution may not take them. */
export const CORE_STORAGE_ADAPTERS = ['local', 's3'] as const

/** The resolved `storage.*` slice the provider builds from; keys beyond the core ones ride through untouched. */
export type StorageProviderConfig = StorageConfig & Record<string, unknown>

export interface StorageProviderDefinition {
  /** What `storage.adapter` names: `azure`, `gcs`, `memory`. */
  id: string
  label: string
  description?: string
  /** Builds the adapter for one deployment; called once per workspace and memoised. */
  create(config: StorageProviderConfig): StorageAdapter
}

/** A provider as the registry lists it. */
export interface StorageProviderEntry extends StorageProviderDefinition {
  source: 'core' | { extensionId: string }
}

export const STORAGE_ADAPTER_ID = /^[a-z0-9][a-z0-9._-]*$/

/** Shape check: a lowercase id core does not already provide, a label, a create function. */
export function validateStorageProvider(input: unknown): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = []
  if (!input || typeof input !== 'object') return [{ path: '', message: 'must be an object' }]
  const p = input as Partial<StorageProviderDefinition> & Record<string, unknown>
  if (typeof p.id !== 'string' || !STORAGE_ADAPTER_ID.test(p.id)) issues.push({ path: 'id', message: 'must be a lowercase id (letters, digits, . _ -)' })
  else if ((CORE_STORAGE_ADAPTERS as readonly string[]).includes(p.id)) issues.push({ path: 'id', message: `'${p.id}' is a core adapter; pick another id` })
  if (typeof p.label !== 'string' || !p.label.trim()) issues.push({ path: 'label', message: 'must be a non-empty string' })
  if (typeof p.create !== 'function') issues.push({ path: 'create', message: 'must be a function (config) => StorageAdapter' })
  return issues
}
