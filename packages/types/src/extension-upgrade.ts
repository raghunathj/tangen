/**
 * File Name: extension-upgrade.ts
 * Purpose: The UPGRADE plan (closure plan Phase 4, Unit 8), pure: given the
 *          installation row, the registered manifest (the target), the
 *          migration plan the ledger produced and the scope's dependency
 *          inputs, decide whether an upgrade may proceed. The API's
 *          lifecycle service and the CLI both run this plan, then the same
 *          migration runner.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Structural inputs only (no @tangen/db import: the
 *          types package is the shared layer). A downgrade is refused (the
 *          ledger cannot run backwards); the same version with nothing
 *          pending is a no-op; the stored options must fit the new
 *          manifest's `config`; the dependency resolver must not block the
 *          extension at the new version; the migration history must match.
 */
import type { TangenExtensionManifest } from './extension'
import { parseSemver, compareSemver, validateExtensionOptions } from './extension-manifest'
import { resolveExtensionActivation, type ActivationInput } from './extension-dependencies'

export interface UpgradePlanInput {
  row: { state: string; version: string | null; options: Record<string, unknown> } | null
  manifest: TangenExtensionManifest
  /** What the ledger says: the pending migration ids and why the run would be refused. */
  migrationPlan: { pending: string[]; refusals: string[] }
  /** For the dependency check at the new version: the scope's installed rows and the loaded manifests. */
  installed: ActivationInput['installed']
  manifests: ActivationInput['manifests']
  capability: ActivationInput['capability']
}

export interface UpgradePlan {
  ok: boolean
  /** No work: already at the target version with nothing pending. */
  noop: boolean
  from: string | null
  to: string
  refusals: string[]
  pendingMigrations: string[]
  /** The effective options after the new config's defaults. */
  options: Record<string, unknown>
}

export function planExtensionUpgrade(input: UpgradePlanInput): UpgradePlan {
  const refusals: string[] = []
  const to = input.manifest.version
  const from = input.row?.version ?? null
  const pendingMigrations = input.migrationPlan.pending
  const options = validateExtensionOptions(input.manifest, input.row?.options ?? {})
  if (!input.row || input.row.state !== 'installed') {
    return { ok: false, noop: false, from, to, refusals: ['not installed here'], pendingMigrations, options: options.options }
  }
  const target = parseSemver(to)
  if (!target) refusals.push(`the registered version '${to}' is not a semver version`)
  const current = from ? parseSemver(from) : null
  if (target && current) {
    const cmp = compareSemver(target, current)
    if (cmp < 0) refusals.push(`'${to}' is older than the installed '${from}': a downgrade cannot run the ledger backwards`)
    if (cmp === 0 && pendingMigrations.length === 0 && input.migrationPlan.refusals.length === 0) {
      return { ok: true, noop: true, from, to, refusals: [], pendingMigrations, options: options.options }
    }
  }
  if (!options.ok) refusals.push(...options.errors.map((e) => `${e.path}: ${e.message} (update the options before upgrading)`))
  refusals.push(...input.migrationPlan.refusals.map((r) => `migration history: ${r}`))
  // Dependencies at the new version: what the resolver would say once the row carries `to`.
  const activation = resolveExtensionActivation({
    installed: { ...input.installed, [input.manifest.id]: { version: to, enabled: true } },
    manifests: { ...input.manifests, [input.manifest.id]: input.manifest },
    capability: input.capability,
  })[input.manifest.id]
  if (activation && !activation.active) refusals.push(`at ${to} the extension would not be active here: ${activation.reason}`)
  return { ok: refusals.length === 0, noop: false, from, to, refusals, pendingMigrations, options: options.options }
}
