/**
 * File Name: api-key-permissions.ts
 * Purpose: Validates an API key's permission document against the one
 *          catalogue of scopes and actions (@tangen/types
 *          API_KEY_SCOPE_ACTIONS) before it is stored (closure plan Phase 2,
 *          Unit 5). An unknown scope, an unknown or empty action, a
 *          malformed list or flag is refused with a 422 naming the field;
 *          nothing unknown is ever stored to be silently ignored - or,
 *          worse, silently honoured by a later reader.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. Custom-route and resource actions are the
 *          site's own vocabulary (declared with apiGroup / defineApiResource),
 *          so for them the shape is validated - non-empty identifiers in a
 *          list - not the names. Authorization to CALL the key routes is
 *          checked before this runs and independently of it.
 */
import { API_KEY_SCOPE_ACTIONS, API_KEY_SEARCH_AUDIENCES, type ApiKeyPermissions } from '@tangen/types'
import { RequestError } from './errors'

const SCOPES = Object.keys(API_KEY_SCOPE_ACTIONS) as Array<keyof typeof API_KEY_SCOPE_ACTIONS>
/** Scopes that are a flag rather than an action list. */
const FLAG_SCOPES = ['toolbar'] as const
/** Scopes whose actions are the site's own vocabulary. */
const SITE_SCOPES = ['customRoutes', 'resources', 'extensions'] as const
const KNOWN_SCOPES = new Set<string>([...SCOPES, ...FLAG_SCOPES, ...SITE_SCOPES, 'locales'])
const ACTION_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const LIST_KEYS: Record<string, string[]> = {
  objects: ['allowedTypes'], media: ['allowedFolders'], search: ['allowedTypes'], globals: ['allowedNames'], tables: ['allowedTables'],
}

export interface PermissionValidation {
  ok: boolean
  fieldErrors: Record<string, string>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function checkActions(path: string, value: unknown, allowed: readonly string[] | null, errors: Record<string, string>): void {
  if (!Array.isArray(value)) { errors[path] = 'must be a list of actions'; return }
  for (const a of value) {
    if (typeof a !== 'string' || a === '') { errors[path] = 'an action must be a non-empty string'; return }
    if (allowed ? !allowed.includes(a) : !ACTION_NAME.test(a)) {
      errors[path] = allowed ? `unknown action "${a}" (allowed: ${allowed.join(', ')})` : `"${a}" is not a valid action name`
      return
    }
  }
}

function checkStringList(path: string, value: unknown, errors: Record<string, string>): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.some((s) => typeof s !== 'string' || s === '')) errors[path] = 'must be a list of non-empty strings'
}

/** Every problem in a permission document, keyed by the field that carries it. */
export function validateApiKeyPermissions(input: unknown): PermissionValidation {
  const errors: Record<string, string> = {}
  if (input === undefined || input === null) return { ok: true, fieldErrors: errors }
  if (!isRecord(input)) return { ok: false, fieldErrors: { permissions: 'must be an object' } }

  for (const [scope, value] of Object.entries(input)) {
    // K0: a key holds grants, never the admin sentinel. Before this an
    // `admin: true` key satisfied every member-only gate (the sentinel is
    // tested before the member check in the guards).
    if (scope === 'admin') { errors['permissions.admin'] = 'admin is not an API-key scope: keys hold grants, never the admin sentinel'; continue }
    if (!KNOWN_SCOPES.has(scope)) { errors[`permissions.${scope}`] = `unknown permission scope (known: ${[...KNOWN_SCOPES].join(', ')})`; continue }
    if (value === undefined) continue
    if (scope === 'locales') {
      if (value !== 'all' && !(Array.isArray(value) && value.length > 0 && value.every((c) => typeof c === 'string' && c !== ''))) errors['permissions.locales'] = "must be 'all' or a non-empty list of locale codes"
      continue
    }
    if ((FLAG_SCOPES as readonly string[]).includes(scope)) {
      if (!isRecord(value) || typeof value.enabled !== 'boolean') errors[`permissions.${scope}`] = 'must be { enabled: true | false }'
      continue
    }
    if (scope === 'customRoutes') {
      if (!isRecord(value)) { errors['permissions.customRoutes'] = 'must map a resource id to a list of actions'; continue }
      for (const [id, actions] of Object.entries(value)) checkActions(`permissions.customRoutes.${id}`, actions, null, errors)
      continue
    }
    if (scope === 'extensions') {
      // An extension's apiKeyScope (plan-core-slimming F1): { actions?, items? } per extension id.
      if (!isRecord(value)) { errors['permissions.extensions'] = 'must map an extension id to its grants'; continue }
      for (const [id, grant] of Object.entries(value)) {
        if (!isRecord(grant)) { errors[`permissions.extensions.${id}`] = 'must be { actions?, items? }'; continue }
        if (grant.actions !== undefined) checkActions(`permissions.extensions.${id}.actions`, grant.actions, null, errors)
        if (grant.items !== undefined) {
          if (!isRecord(grant.items)) errors[`permissions.extensions.${id}.items`] = 'must map an item id to a list of actions'
          else for (const [item, actions] of Object.entries(grant.items)) checkActions(`permissions.extensions.${id}.items.${item}`, actions, null, errors)
        }
      }
      continue
    }
    if (scope === 'resources') {
      if (!isRecord(value)) { errors['permissions.resources'] = 'must map a resource id to its items'; continue }
      for (const [id, items] of Object.entries(value)) {
        if (!isRecord(items)) { errors[`permissions.resources.${id}`] = 'must map an item id to a list of actions'; continue }
        for (const [item, actions] of Object.entries(items)) checkActions(`permissions.resources.${id}.${item}`, actions, null, errors)
      }
      continue
    }
    // A built-in scope: { actions, per-entry overrides, allow-lists }.
    const allowed = API_KEY_SCOPE_ACTIONS[scope as keyof typeof API_KEY_SCOPE_ACTIONS]
    if (!isRecord(value)) { errors[`permissions.${scope}`] = 'must be an object'; continue }
    const actionsOptional = scope === 'objects'
    if (value.actions !== undefined || !actionsOptional) checkActions(`permissions.${scope}.actions`, value.actions, allowed, errors)
    const overrides = scope === 'objects' ? value.types : undefined
    if (overrides !== undefined) {
      if (!isRecord(overrides)) errors[`permissions.${scope}.types`] = 'must map a name to a list of actions'
      else for (const [name, actions] of Object.entries(overrides)) checkActions(`permissions.${scope}.types.${name}`, actions, allowed, errors)
    }
    for (const key of LIST_KEYS[scope] ?? []) checkStringList(`permissions.${scope}.${key}`, value[key], errors)
    if (scope === 'search' && value.audiences !== undefined) {
      if (!Array.isArray(value.audiences) || value.audiences.some((a) => !(API_KEY_SEARCH_AUDIENCES as readonly string[]).includes(a as string))) {
        errors['permissions.search.audiences'] = `must list only: ${API_KEY_SEARCH_AUDIENCES.join(', ')}`
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, fieldErrors: errors }
}

/** The validated document, or a 422 VALIDATION_ERROR with every field named. */
export function assertApiKeyPermissions(input: unknown): ApiKeyPermissions {
  const v = validateApiKeyPermissions(input)
  if (!v.ok) throw new RequestError('VALIDATION_ERROR', 'permissions are invalid', 422, v.fieldErrors)
  return (input ?? {}) as ApiKeyPermissions
}

/**
 * The permissions a key is RESOLVED with: the stored document minus any
 * `admin` sentinel a legacy document may still carry. Defence in depth for
 * keys created before K0 refused the scope at validation.
 */
export function sanitizeApiKeyPermissions(stored: unknown): ApiKeyPermissions {
  if (!isRecord(stored)) return {}
  const { admin: _admin, ...rest } = stored as Record<string, unknown>
  return rest as ApiKeyPermissions
}
