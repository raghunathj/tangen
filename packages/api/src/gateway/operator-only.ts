/**
 * File Name: operator-only.ts
 * Purpose: D-15. Some Gateway keys describe the deployment rather than a
 *   tenant: who sits in front of the process (trustedProxy), where the
 *   rate-limit store lives, whether log redaction may be shortened. A
 *   workspace stating one of them would be escalating its own privilege, so
 *   the loader refuses the config by name before anything is merged.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: One deployment has one operator ceiling: the `gateway`
 *   block of the root tangen.config.ts. The workspace config is the only
 *   tenant-authored object that exists; there is no environment file for a
 *   tenant to restate a ceiling in. `server.trustedProxy` is the path the
 *   environment-era files used and is refused too, so a leftover file fails
 *   by name rather than being ignored.
 */
import { OPERATOR_ONLY_KEYS } from '@tangen/types'

/** Every dotted path a workspace config may not state. */
export const OPERATOR_ONLY_PATHS: readonly string[] = [
  'server.trustedProxy',
  ...OPERATOR_ONLY_KEYS.map((key) => `gateway.${key}`),
]

export class OperatorOnlyKeyError extends Error {
  readonly workspace: string
  readonly key: string
  readonly requested: unknown

  constructor(info: { workspace: string; key: string; requested: unknown }, message: string) {
    super(message)
    this.name = 'OperatorOnlyKeyError'
    this.workspace = info.workspace
    this.key = info.key
    this.requested = info.requested
  }
}

export function readPath(source: unknown, path: string): unknown {
  let cursor: unknown = source
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

export interface OperatorOnlyCheck {
  /** Workspace slug, named in the error so an operator knows which file to open. */
  workspace: string
  /** The tenant-authored workspace config. */
  tenant: unknown
  /** Defaults to every operator-only path. */
  paths?: readonly string[]
}

/**
 * Finds the first operator-only key a workspace config states.
 * @param check - The workspace slug and its config.
 * @returns The error to throw, or null when the tenant states nothing it may not.
 */
export function findOperatorOnlyOverride(check: OperatorOnlyCheck): OperatorOnlyKeyError | null {
  for (const key of check.paths ?? OPERATOR_ONLY_PATHS) {
    const requested = readPath(check.tenant, key)
    if (requested === undefined) continue
    return new OperatorOnlyKeyError(
      { workspace: check.workspace, key, requested },
      `gateway: workspace '${check.workspace}' states '${key}', which is operator-only. ` +
      `Requested ${JSON.stringify(requested)}. ` +
      'That key describes the deployment rather than a tenant - a workspace able to widen ' +
      'proxy trust, move the rate-limit store or shorten log redaction would be escalating ' +
      'its own privilege. Set it under `gateway` in tangen.config.ts and remove it from the ' +
      'workspace config.',
    )
  }
  return null
}

/**
 * The loader's guard over one workspace config.
 * @throws OperatorOnlyKeyError naming the workspace, the key and the requested value.
 */
export function assertNoOperatorOnlyOverrides(opts: { workspace: string; workspaceConfig: unknown }): void {
  const breach = findOperatorOnlyOverride({ workspace: opts.workspace, tenant: opts.workspaceConfig })
  if (breach) throw breach
}
