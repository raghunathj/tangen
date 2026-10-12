/**
 * File Name: field-defaults.ts
 * Purpose: B2 — apply field defaults SERVER-SIDE on create (previously only the admin
 *   form pre-filled them, so REST creates never got defaults). Static values pass
 *   through; declarative dynamic defaults ({ $dynamic: 'now' | 'currentUser' | 'uuid' })
 *   resolve at write time via the shared resolver in @tangen/types — no functions in
 *   stored config, so the builder UI and schema AI can represent every default.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { isDynamicDefault, resolveDynamicDefault, flattenFields } from '@tangen/types'
import type { FieldDefinition } from '@tangen/types'

export interface DefaultsCtx {
  /** Audit actor (member/API key) — feeds { $dynamic: 'currentUser' }. */
  actorId?: string | null
  /** Injectable clock/uuid for tests. */
  now?: () => Date
  uuid?: () => string
}

/**
 * Returns the values to store for fields ABSENT from the payload that declare a
 * config.default. Provided values — including explicit null ("clear it") — always win.
 */
export function applyFieldDefaults(
  fields: FieldDefinition[],
  provided: Record<string, unknown>,
  ctx: DefaultsCtx = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...provided }
  for (const field of flattenFields(fields)) {
    if (field.name in out) continue
    const dflt = (field.config as { default?: unknown })?.default
    if (dflt === undefined) continue
    const value = isDynamicDefault(dflt) ? resolveDynamicDefault(dflt.$dynamic, ctx) : dflt
    if (value === null || value === undefined) continue // unresolvable → leave empty
    out[field.name] = value
  }
  return out
}
