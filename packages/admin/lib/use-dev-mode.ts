/**
 * File Name: use-dev-mode.ts
 * Purpose: The single "is this a developer context" signal for the admin UI.
 *   True only when the running source is writable (local dev / devspace) - the
 *   ONLY place it is appropriate to surface developer instructions (CLI
 *   commands like `tangen push`, schema flags like `localized: true`).
 *   Everywhere else the admin is a content-editor tool and must show plain,
 *   action-free copy - no commands, no code - so editors are not confused by
 *   dev jargon.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reads the ONE Admin bootstrap store (closure plan Phase
 *   8A, Unit 10) rather than fetching `/admin/ui-config` itself into a cache
 *   keyed by environment alone. `schemaWritable` is an environment-ROLE rule,
 *   not a capability, so it stays a flag; false until the read resolves,
 *   which is the safe default (hide dev hints).
 */
import { useParams } from 'react-router-dom'
import { useCapabilities } from './use-capabilities'

/**
 * Whether developer-facing hints (commands, code) may be shown. Gate every
 * message that mentions a CLI command or schema code behind this.
 */
export function useDevMode(): boolean {
  const params = useParams<{ workspaceId: string }>()
  const { flags } = useCapabilities(params.workspaceId)
  return flags.schemaWritable
}
