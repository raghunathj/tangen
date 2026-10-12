/**
 * File Name: admin-slots.ts
 * Purpose: Admin slots (Extension Kernel K7.2, tasks/plan-extension-kernel.md;
 *          plan-framework-extensibility primitive 3). A core screen exposes a
 *          SLOT; an extension fills it with descriptor-only items declared
 *          in the manifest - the slot, an id, the client module's export
 *          name, a priority, an access rule - so the Admin can mount, order
 *          and gate them without running extension code first. The
 *          component itself arrives through the Admin build (K7.3 makes
 *          that runtime). Pure.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { AdminAccessRule } from './admin-extension'

/** The core slot points, `id@major`. */
export const ADMIN_SLOTS = ['admin.settings.sections@1', 'admin.extension.overview@1'] as const
export type AdminSlotId = (typeof ADMIN_SLOTS)[number]

export interface ExtensionSlotContribution {
  /** Which core slot this fills. */
  slot: AdminSlotId | (string & {})
  /** Unique within the extension for that slot. */
  id: string
  /** The named export of the extension's client module (`src/index.ts`) that renders it; receives `{ context }`. */
  component: string
  label?: string
  /** Higher renders first; default 0. Ties break by extension id, then item id. */
  priority?: number
  /** Who sees it, with the Admin's page semantics; absent = every member who can open the screen. */
  access?: AdminAccessRule
}

/** The grant a grants-declaring extension needs to fill any slot. */
export const ADMIN_CONTRIBUTE_GRANT = 'admin:contribute'

const NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const ID = /^[a-z0-9][a-z0-9._-]*$/

/** Shape check for the manifest's `slots`: unknown slot, duplicate item, bad component name or priority. Paths are relative to `slots`. */
export function validateSlotContributions(input: unknown): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = []
  if (!Array.isArray(input)) return [{ path: '', message: 'must be an array of { slot, id, component, priority?, access? }' }]
  const seen = new Set<string>()
  input.forEach((raw, i) => {
    const at = `[${i}]`
    if (!raw || typeof raw !== 'object') { issues.push({ path: at, message: 'must be an object' }); return }
    const item = raw as Partial<ExtensionSlotContribution> & Record<string, unknown>
    if (typeof item.slot !== 'string' || !(ADMIN_SLOTS as readonly string[]).includes(item.slot)) issues.push({ path: `${at}.slot`, message: `must be one of ${ADMIN_SLOTS.join(', ')}` })
    if (typeof item.id !== 'string' || !ID.test(item.id)) issues.push({ path: `${at}.id`, message: 'must be a lowercase id (letters, digits, . _ -)' })
    else {
      const key = `${String(item.slot)}:${item.id}`
      if (seen.has(key)) issues.push({ path: `${at}.id`, message: `'${item.id}' fills ${String(item.slot)} twice` })
      else seen.add(key)
    }
    if (typeof item.component !== 'string' || !NAME.test(item.component)) issues.push({ path: `${at}.component`, message: 'must be the name of an export of the client module' })
    if (item.priority !== undefined && (typeof item.priority !== 'number' || !Number.isFinite(item.priority))) issues.push({ path: `${at}.priority`, message: 'must be a number' })
    if (item.access !== undefined && (!item.access || typeof item.access !== 'object')) issues.push({ path: `${at}.access`, message: 'must be an access rule ({ roles?, capability? })' })
  })
  return issues
}

/**
 * The items an extension may fill given its EFFECTIVE grants: all of them
 * when `admin:contribute` is held, none otherwise (E.14: no trusted class).
 * What the extensions list hands the Admin.
 */
export function allowedSlotContributions(
  manifest: { slots?: ExtensionSlotContribution[] } | null | undefined,
  grants: readonly string[],
): ExtensionSlotContribution[] {
  const items = manifest?.slots ?? []
  if (items.length === 0) return []
  if (!grants.includes(ADMIN_CONTRIBUTE_GRANT)) return []
  return items.map((s) => ({ slot: s.slot, id: s.id, component: s.component, ...(s.label !== undefined ? { label: s.label } : {}), ...(s.priority !== undefined ? { priority: s.priority } : {}), ...(s.access !== undefined ? { access: s.access } : {}) }))
}
