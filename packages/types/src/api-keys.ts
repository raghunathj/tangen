/**
 * File Name: api-keys.ts
 * Purpose: Types for API key permissions, API key records, workspace members, and
 * member roles — used by both the API server and the admin panel.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */

/**
 * The ONE catalogue of actions each built-in scope can grant (closure plan
 * Phase 2, Unit 5). The permission types below derive from it, and the API
 * validates every key create/update against it: an action not listed here
 * is refused with a 422, never stored and silently ignored.
 */
export const API_KEY_SCOPE_ACTIONS = {
  objects: ['read', 'read_draft', 'write', 'publish', 'delete'],
  media: ['read', 'write', 'delete'],
  webhooks: ['read', 'write', 'delete'],
  search: ['read'],
  globals: ['read', 'write'],
  schema: ['push', 'pull'],
  tables: ['read'],
} as const
export type ApiKeyScope = keyof typeof API_KEY_SCOPE_ACTIONS
/** Knowledge retrieval audiences a key may be granted. */
export const API_KEY_SEARCH_AUDIENCES = ['public', 'internal'] as const
/** Actions that can be granted on object resources for an API key. */
export type ObjectAction = typeof API_KEY_SCOPE_ACTIONS.objects[number]
/** Actions that can be granted on forms — read the schema, submit entries. */
/** Fine-grained permission set for an API key, scoped per resource category. */
export interface ApiKeyPermissions {
  objects?: {
    actions?: ObjectAction[]
    /** Flat allow-list of type slugs this key can access (all types if omitted) */
    allowedTypes?: string[]
    types?: Record<string, ObjectAction[]>
    /**
     * Field allow-lists (Extension Kernel K1.3), keyed by type name or `'*'`
     * for every type: `write` names the only fields a write may touch,
     * `read` the only fields a read returns. A pattern is a field name
     * (`title`, `metaDescription`) or `<group>.*` for every field of that
     * group. Compiled from `content:<verb>:fields(...)` grants; absent means
     * no field restriction from the bundle (role lists still apply).
     */
    fields?: Record<string, { read?: string[]; write?: string[] }>
  }
  /**
   * Locales this key may write BEYOND the base locale. Omit ⇒ the base
   * locale only (K0: a key is never an unconditional locale writer);
   * `'all'` ⇒ every locale the workspace declares. Reads are never
   * locale-restricted. Same shape as MemberPermissions.locales.
   */
  locales?: 'all' | string[]
  media?: {
    actions: (typeof API_KEY_SCOPE_ACTIONS.media[number])[]
    allowedFolders?: string[]
  }
  webhooks?: {
    actions: (typeof API_KEY_SCOPE_ACTIONS.webhooks[number])[]
  }
  search?: {
    actions: (typeof API_KEY_SCOPE_ACTIONS.search[number])[]
    allowedTypes?: string[]
    /**
     * Knowledge retrieval audiences this key may see. DEFAULT ['public'] —
     * a key must be explicitly granted 'internal' to retrieve internal
     * knowledge (fail closed).
     */
    audiences?: (typeof API_KEY_SEARCH_AUDIENCES[number])[]
  }
  /**
   * Globals access (workspace singletons read via the SDK's globals() API).
   * Omit to deny. `write` covers PUT/PATCH and is off unless granted;
   * allowedNames omits ⇒ every global the workspace declares.
   */
  globals?: {
    actions: (typeof API_KEY_SCOPE_ACTIONS.globals[number])[]
    allowedNames?: string[]
  }
  schema?: {
    actions: (typeof API_KEY_SCOPE_ACTIONS.schema[number])[]
  }
  /**
   * Custom-table access (used by MCP's query_table and future table APIs).
   * Omit to deny; allowedTables omits ⇒ all tables the workspace declares.
   */
  tables?: {
    actions: (typeof API_KEY_SCOPE_ACTIONS.tables[number])[]
    allowedTables?: string[]
  }
  /**
   * Performance-timing headers for this key's responses (the Tangen Toolbar's
   * server numbers). Off by default: db/queue timings are only emitted to keys
   * that opt in, so arbitrary API consumers never see them.
   */
  toolbar?: {
    enabled: boolean
  }
  /**
   * Grants under an EXTENSION's `apiKeyScope`, keyed by extension id:
   * `actions` on every item, `items` per-item overrides keyed by id or slug
   * (an override replaces the global grant for that item).
   * e.g. { forms: { actions: ['read'], items: { contact: ['read', 'submit'] } } }
   */
  extensions?: Record<string, { actions?: string[]; items?: Record<string, string[]> }>
  /**
   * Permissions for custom routes declared with apiGroup.
   * Key is the apiGroup.id; value is the list of allowed actions.
   * e.g. { pincode: ['check'], analytics: ['read', 'write'] }
   */
  customRoutes?: Record<string, string[]>
  /**
   * Per-item overrides for declared API resources (defineApiResource with an
   * items loader). Keyed by resource id, then item id or slug; an override
   * replaces the customRoutes[resourceId] actions for that item.
   * e.g. { pincode: { 'batch-south': ['Search'] } }
   */
  resources?: Record<string, Record<string, string[]>>
}

/** A stored API key record — keyHash is a bcrypt hash; the raw key is never stored. */
export interface ApiKey {
  id: string
  workspaceId: string
  label: string
  keyPrefix: string
  keyHash: string
  permissions: ApiKeyPermissions
  expiresAt: string | null
  createdAt: string
  createdBy: string
  lastUsedAt: string | null
  revokedAt: string | null
}

/** Role levels available to workspace members. */
export type MemberRole = 'owner' | 'admin' | 'editor' | 'viewer'

/** A workspace member record linking a user account to a role. */
export interface Member {
  id: string
  workspaceId: string
  email: string
  name: string | null
  role: MemberRole
  createdAt: string
  lastLoginAt: string | null
}

/**
 * The object-read gate, shared by every read surface.
 *
 * This rule (a per-type override wins, otherwise the global action list plus
 * allowedTypes, admin bundles pass everything) is the platform's, not any one
 * protocol's. It lived in `@tangen/graphql` and its own comment said it
 * "mirrors the object-read logic REST/MCP use", which is the tell: a rule
 * three surfaces must agree on does not belong to one of them.
 *
 * Moving it here fixed a real leak. `realtime/authorize.ts` imported it from
 * `@tangen/graphql`, so every server resolved that whole package at boot even
 * though `routes/graphql.ts` goes to deliberate trouble to lazy-import it.
 * `@tangen/graphql` re-exports these, so nothing downstream changed.
 */
function canObjectsAction(
  permissions: ApiKeyPermissions | { admin: true } | undefined,
  action: 'read' | 'write' | 'read_draft' | 'publish' | 'delete',
  typeName: string,
): boolean {
  if (!permissions) return false
  if ('admin' in permissions && permissions.admin === true) return true
  const objects = (permissions as ApiKeyPermissions).objects
  if (!objects) return false
  const override = objects.types?.[typeName]
  if (override) return (override as string[]).includes(action)
  if (!objects.actions?.includes(action as never)) return false
  if (objects.allowedTypes && !objects.allowedTypes.includes(typeName)) return false
  return true
}

/** Can this caller READ the given content type? */
export function canReadType(
  permissions: ApiKeyPermissions | { admin: true } | undefined,
  typeName: string,
): boolean {
  return canObjectsAction(permissions, 'read', typeName)
}

/** Can this caller read DRAFTS of the given type? (objects:read_draft) */
export function canReadDraftsType(
  permissions: ApiKeyPermissions | { admin: true } | undefined,
  typeName: string,
): boolean {
  return canObjectsAction(permissions, 'read_draft', typeName)
}

/** Can this caller PUBLISH the given content type? (objects:publish - a write grant is not enough) */
export function canPublishTypeObjects(
  permissions: ApiKeyPermissions | { admin: true } | undefined,
  typeName: string,
): boolean {
  return canObjectsAction(permissions, 'publish', typeName)
}

/** Can this caller WRITE the given content type? */
export function canWriteTypeObjects(
  permissions: ApiKeyPermissions | { admin: true } | undefined,
  typeName: string,
): boolean {
  return canObjectsAction(permissions, 'write', typeName)
}
