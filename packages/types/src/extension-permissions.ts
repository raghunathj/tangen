/**
 * File Name: extension-permissions.ts
 * Purpose: The extension permission contract and its compiler
 *   (tasks/plan-permissions-tree.md). An extension declares RESOURCES x ACTIONS
 *   in its manifest (`permissions.resources`); this expands each into a
 *   capability def - id `<action>:<resource>`, a standard label, standard
 *   implications (write/delete imply read, manage implies read+write) - plus
 *   grouping metadata (resource, action, sensitive) the permission tree renders.
 *   Standard verbs (read/write/delete/manage) are sugar; a custom action gives
 *   its own `{ id, label, implies?, sensitive? }`.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure and browser-safe (string/JSON only). Enforcement is
 *   unchanged - the compiler shapes the CATALOG and implications; the extension
 *   still gates routes/actions with `req.can(<capability>)`. The raw
 *   `capabilities` manifest list stays as the escape hatch and merges after.
 */
import type { ExtensionCapabilityId } from './member-permissions'

/** The four standard verbs; sugar for the common CRUD-ish shape. */
export type StandardAction = 'read' | 'write' | 'delete' | 'manage'

/** A non-standard action, declared in full. */
export interface ExtensionActionDef {
  /** Verb id, e.g. 'export' - becomes `<id>:<resource>`. */
  id: string
  label?: string
  /** Action ids (within this resource) a holder of this one also gets. */
  implies?: string[]
  /** Marks the "grants access to sensitive data" cue on the role/member page. */
  sensitive?: boolean
}

/** A noun the extension governs, with the actions available on it. */
export interface ExtensionResourceDef {
  id: string
  label: string
  actions: Array<StandardAction | ExtensionActionDef>
}

/** The declarative permission block on a manifest. */
export interface ExtensionPermissionsDef {
  resources?: ExtensionResourceDef[]
}

/** A capability def with the grouping metadata the permission tree needs. */
export interface CompiledCapability {
  id: ExtensionCapabilityId
  label: string
  description?: string
  implies?: ExtensionCapabilityId[]
  /** The resource this capability belongs to (grouping); absent for raw caps. */
  resource?: string
  /** The action verb (grouping / icon). */
  action?: string
  /** Whether it reveals sensitive data (banner cue). */
  sensitive?: boolean
}

const STANDARD: Record<StandardAction, { verb: string; implies: StandardAction[] }> = {
  read: { verb: 'Read', implies: [] },
  write: { verb: 'Write', implies: ['read'] },
  delete: { verb: 'Delete', implies: ['read'] },
  manage: { verb: 'Manage', implies: ['read', 'write'] },
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const WRITE_VERBS = new Set(['write', 'manage', 'delete'])

/**
 * Capability scopes (resources) that expose a write-ish verb (write/manage/
 * delete) but no `read` - the read/write split is missing, so a role can't grant
 * read-only. A Doctor nudge for extension authors: declare `read:<scope>` too.
 * Returns the scopes, sorted, de-duplicated.
 */
export function findCoarseCapabilities(capabilities: Array<{ id: string }>): string[] {
  const byScope = new Map<string, Set<string>>()
  for (const c of capabilities) {
    const [verb, scope] = c.id.split(':')
    if (!scope) continue
    const set = byScope.get(scope) ?? (byScope.set(scope, new Set()), byScope.get(scope)!)
    set.add(verb!)
  }
  const out: string[] = []
  for (const [scope, verbs] of byScope) {
    if (!verbs.has('read') && [...verbs].some((v) => WRITE_VERBS.has(v))) out.push(scope)
  }
  return out.sort()
}

/**
 * Expands an extension's `permissions.resources` into capability defs, then
 * appends any raw `capabilities` unchanged. Additive and pure: order is
 * resources first (grouped), raw last.
 */
export function compileExtensionPermissions(
  perm: ExtensionPermissionsDef | undefined,
  raw: Array<{ id: string; label: string; description?: string; implies?: string[] } & Record<string, unknown>> = [],
): CompiledCapability[] {
  const out: CompiledCapability[] = []
  for (const res of perm?.resources ?? []) {
    const noun = res.label.toLowerCase()
    for (const a of res.actions) {
      const def: ExtensionActionDef = typeof a === 'string' ? { id: a } : a
      const std = STANDARD[def.id as StandardAction]
      const impliesActions = def.implies ?? (std ? std.implies : [])
      const implies = impliesActions.map((act) => `${act}:${res.id}` as ExtensionCapabilityId)
      out.push({
        id: `${def.id}:${res.id}` as ExtensionCapabilityId,
        label: def.label ?? (std ? `${std.verb} ${noun}` : `${cap(def.id)} ${noun}`),
        implies: implies.length ? implies : undefined,
        resource: res.id,
        action: def.id,
        sensitive: def.sensitive ?? def.id === 'delete',
      })
    }
  }
  // Raw capabilities pass through with every field intact (e.g. `gates`).
  for (const c of raw) out.push({ ...c, id: c.id as ExtensionCapabilityId } as CompiledCapability)
  return out
}
