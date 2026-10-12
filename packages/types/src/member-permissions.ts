/**
 * File Name: member-permissions.ts
 * Purpose: RBAC core — member roles compile to permission bundles that are
 *          structurally ApiKeyPermissions, so member authorization flows
 *          through the exact same check sites as API keys. Adds admin-area
 *          capabilities on top for management surfaces.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: owner/admin/superadmin intentionally keep the historic
 *          `{ admin: true }` fast path (bypasses every check). Custom roles
 *          are stored per workspace (roles table) and referenced by slug in
 *          members.role; unknown slugs degrade to the viewer bundle.
 */
import type {ApiKeyPermissions, } from './api-keys'
import type { ExtensionId } from './registry'


/** Core (platform-shipped) admin-area capabilities grantable to member roles (not API keys). */
export type CoreCapability =
  | 'use:ai'
  | 'manage:members'
  | 'manage:roles'
  | 'manage:apiKeys'
  | 'manage:webhooks'
  | 'manage:settings'
  /**
   * Connectors B3: READ AND USE ONLY. It may list a connection's identity and
   * state and browse the resources inside one (a spreadsheet, a channel), in
   * order to point an automation at it. It may not connect, re-consent,
   * revoke, rename, delete, test, change what a connection is authorized for,
   * or see one byte of material - all of that stays `manage:settings`, which
   * implies this. Held by nobody unless a role is given it, because it is how
   * an operator decides who may aim an automation at an integration.
   * The boundary is held per verb by kernel-connections-permissions.test.ts.
   */
  | 'connections:use'
  | 'manage:aiSettings'
  | 'manage:cron'
  | 'schema:migrate'
  /** Releases (Phase 5B): submit / withdraw / add items; approve (freezes the payload); apply / schedule / retry. */
  | 'releases:review'
  | 'releases:approve'
  | 'releases:apply'

/**
 * An extension-declared capability id — namespaced `scope:name` strings
 * declared in a manifest's `capabilities` array (e.g. `review:approve`;
 * Flows declares `read:flows`/`manage:flows` this way). The `& {}` keeps
 * TypeScript from collapsing the core union into the template literal, so
 * core ids keep IDE autocomplete.
 */
export type ExtensionCapabilityId = `${string}:${string}` & {}

/**
 * Anything a role's `capabilities` list may hold: a core capability or an
 * extension-declared one. Extension ids are open by design — the roles
 * editor catalogs only the capabilities of extensions actually installed.
 */
export type Capability = CoreCapability | ExtensionCapabilityId

/** The CORE capability catalog. Extension capabilities ride their manifests. */
export const ALL_CAPABILITIES: CoreCapability[] = [
  'use:ai',
  'manage:members', 'manage:roles', 'manage:apiKeys', 'manage:webhooks',
  'manage:settings', 'connections:use', 'manage:aiSettings', 'manage:cron', 'schema:migrate',
  'releases:review', 'releases:approve', 'releases:apply',
]

/**
 * A member role's resolved permissions — structurally an ApiKeyPermissions
 * (so assertObjectPermission / check*Permission accept it unchanged) plus
 * admin-area capabilities.
 */
// `extensions` on a member bundle is the page allow-list below, not the key model's extension grants.
export type MemberPermissions = Omit<ApiKeyPermissions, 'extensions'> & {
  capabilities?: Capability[]
  /**
   * Extension pages this role may open: 'all' (default when absent), or an
   * allow-list of extension ids ('auth', 'seo', 'forms', 'notes', dev-route segments
   * like 'pincodes'). UI-level gating — extension-contributed FIELDS on
   * content objects always follow the content permissions instead.
   */
  extensions?: 'all' | ExtensionId[]
  /**
   * Content languages this role may WRITE: 'all' (default when absent) or
   * locale codes, e.g. ['de']. A restricted role can only edit translations
   * for the listed locales — base-language edits, publishing, scheduling,
   * restoring, and deleting require base-locale rights. Reads are never
   * locale-restricted; API keys unaffected. Role edits apply within ~60s
   * (permission-bundle cache).
   */
  locales?: 'all' | string[]
}

/** A stored custom role (roles table row shape). */
export interface RoleDefinition {
  id: string
  workspaceId: string
  /** Stable per-workspace identifier — what members.role and field access lists reference. */
  slug: string
  name: string
  description?: string | null
  permissions: MemberPermissions
  createdAt: string
  updatedAt: string
}

export const BUILT_IN_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const
export type BuiltInRole = typeof BUILT_IN_ROLES[number]

export function isBuiltInRole(role: string): role is BuiltInRole {
  return (BUILT_IN_ROLES as readonly string[]).includes(role)
}

/**
 * Sentinel per-environment role meaning the member is *excluded* from that
 * environment — stored in `member_env_roles.role` and enforced at auth time
 * (a `none` override denies access to the env). This is how you keep someone
 * out of production while they still work in dev/staging. It is never a
 * workspace-default role; it only exists as a per-env override.
 */
export const NO_ACCESS_ROLE = 'none'

/** True when a role string is the per-env "No access" sentinel. */
export function isNoAccessRole(role: string | null | undefined): boolean {
  return role === NO_ACCESS_ROLE
}

const VIEWER_BUNDLE: MemberPermissions = {
  objects: { actions: ['read', 'read_draft'] },
  media: { actions: ['read'] },
  search: { actions: ['read'] },
  capabilities: [],
}

const EDITOR_BUNDLE: MemberPermissions = {
  objects: { actions: ['read', 'read_draft', 'write', 'publish', 'delete'] },
  media: { actions: ['read', 'write', 'delete'] },
  search: { actions: ['read'] },
  capabilities: ['use:ai'],
}

/**
 * Compiles a built-in role to its permission bundle. Custom-role slugs are
 * resolved by the caller (DB lookup) — this function's fallback for unknown
 * strings is the viewer bundle, the safe floor.
 */
export function permissionsForRole(role: string): MemberPermissions | { admin: true } {
  switch (role) {
    case 'owner':
    case 'admin':
    case 'superadmin':
      return { admin: true }
    case 'editor':
      return structuredClone(EDITOR_BUNDLE)
    case 'viewer':
    default:
      return structuredClone(VIEWER_BUNDLE)
  }
}

/**
 * Pure permission check against a member bundle — shared by the admin UI
 * (useCan) and server helpers (RouteContext.can). Per-item overrides
 * (objects.types) replace the global actions for that item.
 */
export function checkBundle(
  permissions: (MemberPermissions & { admin?: boolean }) | { admin: true } | null | undefined,
  action: string,
  resource: 'objects' | 'media' | 'search' | 'schema' = 'objects',
  item?: string,
): boolean {
  if (!permissions) return false
  const p = permissions as MemberPermissions & { admin?: boolean }
  if (p.admin === true) return true

  if (resource === 'objects') {
    const o = p.objects
    if (!o) return false
    const override = item ? o.types?.[item] : undefined
    if (override) return (override as string[]).includes(action)
    return (o.actions as string[] | undefined)?.includes(action) ?? false
  }
  const block = p[resource] as { actions?: string[] } | undefined
  return block?.actions?.includes(action) ?? false
}

/**
 * A code-defined role (defineRole() in site repos, registered via
 * TangenConfig.roles). Resolved in-memory at request time — no push needed,
 * identical across environments. `extends` merges on top of a built-in
 * bundle; a seed whose slug matches 'editor' or 'viewer' REPLACES that
 * built-in's compilation. owner/admin/superadmin can never be overridden.
 */
export interface RoleSeedDefinition {
  /** Stable slug — assignable to members, referenced by field access lists. */
  slug: string
  name: string
  description?: string
  /** Start from a built-in bundle and override selectively. */
  extends?: 'editor' | 'viewer'
  permissions?: MemberPermissions
}

const PROTECTED_ROLE_SLUGS = new Set(['owner', 'admin', 'superadmin'])

/** Compiles a code-defined role seed into its effective permission bundle. */
export function compileRoleSeed(seed: RoleSeedDefinition): MemberPermissions {
  const base = seed.extends
    ? (permissionsForRole(seed.extends) as MemberPermissions)
    : {}
  const overrides = seed.permissions ?? {}
  return {
    ...base,
    ...overrides,
    // capabilities/extensions/locales replace wholesale when provided
    capabilities: overrides.capabilities ?? base.capabilities ?? [],
    ...(overrides.extensions !== undefined ? { extensions: overrides.extensions }
      : base.extensions !== undefined ? { extensions: base.extensions } : {}),
    ...(overrides.locales !== undefined ? { locales: overrides.locales }
      : base.locales !== undefined ? { locales: base.locales } : {}),
  }
}

/** Finds the code-defined role for a slug (built-in owner/admin protected). */
export function resolveCodeRole(
  seeds: RoleSeedDefinition[] | undefined,
  slug: string,
): RoleSeedDefinition | undefined {
  if (PROTECTED_ROLE_SLUGS.has(slug)) return undefined
  return seeds?.find((r) => r.slug === slug)
}

// ─── Per-user additive grants (tasks/plan-per-user-grants.md) ─────────────────

/**
 * A per-member additive grant: extra capabilities and extension-page access
 * layered ON TOP of the member's role. Grants only ever ADD - they never
 * remove or replace a role right. Content actions (objects/media/locales) are
 * NOT grantable per member in v1; those stay role-only. See
 * tasks/plan-per-user-grants.md.
 */
export interface MemberGrants {
  /** Extra admin-area capabilities this member holds beyond their role. */
  capabilities?: Capability[]
  /** Extra extension pages this member may open, by id. */
  extensions?: ExtensionId[]
}

/** A member holding grants that reference something no longer installed. */
export interface DanglingGrant {
  memberId: string
  unknownCapabilities: string[]
  unknownExtensions: string[]
}

/**
 * Finds grants that reference a capability or extension id nothing in this
 * deployment declares - a Doctor warning (an extension was uninstalled, or a
 * typo in a declared grant). A granted extension id must be installed; a
 * granted capability must be a core one or be namespaced under an installed
 * extension (`<extensionId>:name`), which avoids false positives on
 * extension-declared capabilities.
 */
export function findDanglingGrants(
  grants: Array<{ memberId: string; capabilities: string[]; extensions: string[] }>,
  known: { coreCapabilities: string[]; installedExtensionIds: string[] },
): DanglingGrant[] {
  const core = new Set(known.coreCapabilities)
  const installed = new Set(known.installedExtensionIds)
  const out: DanglingGrant[] = []
  for (const g of grants) {
    const unknownCapabilities = (g.capabilities ?? []).filter((c) => !core.has(c) && !installed.has(c.split(':')[0]!))
    const unknownExtensions = (g.extensions ?? []).filter((e) => !installed.has(e))
    if (unknownCapabilities.length || unknownExtensions.length) out.push({ memberId: g.memberId, unknownCapabilities, unknownExtensions })
  }
  return out
}

/** One effective capability tagged with where it came from. */
export interface SourcedCapability {
  capability: Capability
  source: 'role' | 'grant'
}

/**
 * Tags each effective capability by origin - the provenance the admin needs to
 * answer "why can this member do X?". Role capabilities are listed first (source
 * 'role'); a capability that comes ONLY from a grant is 'grant'. A capability
 * held by both is 'role' (the role already grants it). De-duplicated.
 */
export function capabilitySources(roleCapabilities: Capability[], grantCapabilities: Capability[]): SourcedCapability[] {
  const role = new Set(roleCapabilities)
  const seen = new Set<string>()
  const out: SourcedCapability[] = []
  for (const c of roleCapabilities) { if (!seen.has(c)) { seen.add(c); out.push({ capability: c, source: 'role' }) } }
  for (const c of grantCapabilities) { if (!seen.has(c)) { seen.add(c); out.push({ capability: c, source: role.has(c) ? 'role' : 'grant' }) } }
  return out
}

/**
 * Unions a member's grants onto their role bundle. Additive only: the result is
 * always a superset of `base` (output ⊇ base for every field). Because the merge
 * cannot subtract, it is the one place a per-user grant enters authority (it is
 * called right after the role bundle resolves, before the actor is built).
 *
 * - The admin fast-path bundle (`{ admin: true }`) already grants everything, so
 *   grants pass through it unchanged.
 * - `extensions` absent means "every page" (the role may open all of them), and
 *   `'all'` says so explicitly; a grant cannot widen either. Only a role holding
 *   a FINITE allow-list has the granted ids unioned in.
 */
export function mergeMemberGrants(
  base: MemberPermissions | { admin: true },
  grants?: MemberGrants,
): MemberPermissions | { admin: true } {
  if (!grants || (base as { admin?: boolean }).admin === true) return base
  const b = base as MemberPermissions
  const merged: MemberPermissions = { ...b }

  if (grants.capabilities?.length) {
    merged.capabilities = [...new Set([...(b.capabilities ?? []), ...grants.capabilities])]
  }

  // Only a finite allow-list can be widened; absent/'all' is already maximal.
  if (grants.extensions?.length && Array.isArray(b.extensions)) {
    merged.extensions = [...new Set([...b.extensions, ...grants.extensions])] as ExtensionId[]
  }

  return merged
}
