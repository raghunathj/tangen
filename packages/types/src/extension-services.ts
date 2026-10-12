/**
 * File Name: extension-services.ts
 * Purpose: The typed-service reference an extension provides or requires
 *          (Extension Kernel K3.1, tasks/plan-extension-kernel.md):
 *          `<namespace>.<name>@<version>` where the namespace is the
 *          providing extension's id (`tangen` for the platform), a provider
 *          names a bare major (`seo.service@1`) and a consumer a range
 *          (`seo.service@^1`), resolved by the same semver engine extension
 *          dependencies use. Shared by the manifest validator, the activation
 *          resolver and the kernel's service registry.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { isValidVersionRange, satisfiesVersion } from './extension-manifest'

export interface ServiceRef {
  /** `seo.service` - namespace plus name. */
  id: string
  /** The providing extension's id: everything before the last dot. */
  namespace: string
  /** A bare major for a provider (`1`), a range for a consumer (`^1`, `>=1 <3`, `*`). */
  version: string
}

const SERVICE_ID = /^([a-z0-9][a-z0-9._-]*)\.([a-z0-9][a-z0-9_-]*)$/

/** `ns.name@version` → parts; null when malformed (no namespace, no `@`). */
export function parseServiceRef(ref: string): ServiceRef | null {
  if (typeof ref !== 'string') return null
  const at = ref.lastIndexOf('@')
  if (at <= 0 || at === ref.length - 1) return null
  const id = ref.slice(0, at)
  const version = ref.slice(at + 1)
  const m = SERVICE_ID.exec(id)
  if (!m) return null
  return { id, namespace: m[1]!, version }
}

/** A provider's ref names a bare major. */
export function isProvidedServiceRef(ref: string): boolean {
  const p = parseServiceRef(ref)
  return !!p && /^\d+$/.test(p.version)
}

/** A consumer's ref names a range the engine understands. */
export function isRequiredServiceRef(ref: string): boolean {
  const p = parseServiceRef(ref)
  return !!p && isValidVersionRange(p.version)
}

/** Whether a provider's major (`1`) satisfies a consumer's range (`^1`, `1`, `>=1 <3`, `*`). */
export function serviceMajorSatisfies(major: string, range: string): boolean {
  return /^\d+$/.test(major) && satisfiesVersion(`${major}.0.0`, range)
}
