/**
 * File Name: api-key-containment.ts
 * Purpose: A credential may not out-rank the actor that minted it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Security audit finding 22, found 2026-10-28.
 *
 *          `POST /api/v1/api-keys` validated the requested permission
 *          document against the CATALOGUE - every scope and action known -
 *          and stored it. It never compared it with what the MINTER holds. So
 *          a member whose only administrative capability is `manage:apiKeys`,
 *          and whose content bundle is a viewer's, could mint a key carrying
 *          `objects.actions: ['delete']` and then act through it. The
 *          capability to issue credentials became the authority those
 *          credentials carry.
 *
 *          The platform already decided this question once, in the other
 *          direction: finding 4b narrowed a live-preview token to its
 *          minter's field access, for exactly this reason. Keys never got the
 *          same treatment. This is that rule, applied where credentials are
 *          actually issued.
 *
 *          DENY BY DEFAULT PER SCOPE. A scope the minter's own document says
 *          nothing about is excess in full - not "unspecified, therefore
 *          fine". An unbounded request against a bounded minter is excess
 *          too: a minter scoped to `allowedTypes: ['post']` cannot mint a key
 *          that names no allow-list at all, because no allow-list means every
 *          type.
 *
 *          `admin: true` allows everything, as it always has: an owner or
 *          admin session is the actor the whole model trusts, and narrowing
 *          it here would only move the question.
 */
import type { ApiKeyPermissions } from '@tangen/types'
import { RequestError } from './errors'

/** What a minter's own authority looks like: a key's document, or the admin sentinel. */
export type MinterAuthority = ApiKeyPermissions | { admin: true } | undefined | null

/** Scopes whose value is a flag rather than an action list. */
const FLAG_SCOPES = new Set(['toolbar'])
/** Scopes whose actions are the site's own vocabulary, keyed by id (then item). */
const SITE_SCOPES = new Set(['customRoutes', 'resources', 'extensions'])
/** Per built-in scope, the allow-list key that bounds it. */
const LIST_KEY: Record<string, string> = {
  objects: 'allowedTypes', media: 'allowedFolders', search: 'allowedTypes',
  globals: 'allowedNames', tables: 'allowedTables',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined

/** Each requested entry the holder does not have, as `<path>.<entry>`. */
function excessItems(path: string, requested: unknown, held: string[] | undefined, out: string[]): void {
  const req = strings(requested)
  if (!req) return                                  // shape is the validator's job, not this one's
  if (!held) { out.push(path); return }             // the holder has none: the whole list is excess
  for (const item of req) if (!held.includes(item)) out.push(`${path}.${item}`)
}

/**
 * An allow-list bound: the requested list must be a subset of the minter's,
 * and an ABSENT requested list is excess whenever the minter has one, because
 * absent means every entry.
 */
function excessBound(path: string, requested: unknown, held: unknown, out: string[]): void {
  const heldList = strings(held)
  if (!heldList) return                             // the minter is unbounded here
  const reqList = strings(requested)
  if (!reqList) { out.push(path); return }          // unbounded request against a bounded minter
  for (const item of reqList) if (!heldList.includes(item)) out.push(`${path}.${item}`)
}

/** A map of id -> actions (customRoutes, extensions.items, resources.*). */
function excessActionMap(path: string, requested: unknown, held: unknown, out: string[]): void {
  if (!isRecord(requested)) return
  const heldMap = isRecord(held) ? held : undefined
  for (const [id, actions] of Object.entries(requested)) {
    if (!heldMap) { out.push(`${path}.${id}`); continue }
    excessItems(`${path}.${id}`, actions, strings(heldMap[id]), out)
  }
}

/**
 * Every path in `requested` that the minter does not itself hold. Empty means
 * the request is contained and may be issued.
 */
export function apiKeyPermissionExcess(requested: unknown, minter: MinterAuthority): string[] {
  if (minter && 'admin' in minter && (minter as { admin?: unknown }).admin === true) return []
  if (!isRecord(requested)) return []
  const held = isRecord(minter) ? (minter as Record<string, unknown>) : {}
  const out: string[] = []

  for (const [scope, value] of Object.entries(requested)) {
    if (value === undefined) continue
    const mine = held[scope]

    // A flag scope is asked FIRST, because `{ enabled: false }` asks for
    // nothing and a minter that says nothing about the scope has nothing to
    // withhold.
    if (FLAG_SCOPES.has(scope)) {
      const want = isRecord(value) && value.enabled === true
      const have = isRecord(mine) && mine.enabled === true
      if (want && !have) out.push(scope)
      continue
    }

    if (mine === undefined || mine === null) { out.push(scope); continue }

    if (scope === 'locales') {
      if (mine === 'all') continue
      if (value === 'all') { out.push('locales'); continue }
      excessItems('locales', value, strings(mine), out)
      continue
    }

    if (scope === 'extensions') {
      if (!isRecord(value)) continue
      for (const [id, grant] of Object.entries(value)) {
        const mineGrant = isRecord(mine) ? mine[id] : undefined
        if (!isRecord(mineGrant)) { out.push(`extensions.${id}`); continue }
        if (isRecord(grant) && grant.actions !== undefined) {
          excessItems(`extensions.${id}.actions`, grant.actions, strings(mineGrant.actions), out)
        }
        if (isRecord(grant) && grant.items !== undefined) {
          excessActionMap(`extensions.${id}.items`, grant.items, mineGrant.items, out)
        }
      }
      continue
    }

    if (scope === 'resources') {
      if (!isRecord(value)) continue
      for (const [id, items] of Object.entries(value)) {
        const mineItems = isRecord(mine) ? mine[id] : undefined
        if (!isRecord(mineItems)) { out.push(`resources.${id}`); continue }
        excessActionMap(`resources.${id}`, items, mineItems, out)
      }
      continue
    }

    if (scope === 'customRoutes') { excessActionMap('customRoutes', value, mine, out); continue }

    if (SITE_SCOPES.has(scope)) continue   // unreachable; kept so a new site scope is not silently allowed
    if (!isRecord(value) || !isRecord(mine)) continue

    // A built-in scope: the flat action list, the per-type overrides, and the
    // allow-list that bounds it.
    excessItems(`${scope}.actions`, value.actions, strings(mine.actions), out)

    if (scope === 'objects' && isRecord(value.types)) {
      const mineTypes = isRecord(mine.types) ? mine.types : undefined
      const mineAllowed = strings(mine.allowedTypes)
      for (const [name, actions] of Object.entries(value.types)) {
        // The minter's effective authority on THIS type: its own override if
        // it has one, else its flat list - the same precedence the request
        // guard applies when the key is used.
        const mineEffective = strings(mineTypes?.[name]) ?? strings(mine.actions)
        excessItems(`objects.types.${name}`, actions, mineEffective, out)
        // And the type has to be one the minter may touch at all. A per-type
        // override of its own names it; otherwise the allow-list bounds it.
        if (!mineTypes?.[name] && mineAllowed && !mineAllowed.includes(name)) out.push(`objects.types.${name}`)
      }
    }

    const listKey = LIST_KEY[scope]
    if (listKey) excessBound(`${scope}.${listKey}`, value[listKey], mine[listKey], out)

    if (scope === 'search' && value.audiences !== undefined) {
      excessItems('search.audiences', value.audiences, strings(mine.audiences), out)
    }
  }

  return [...new Set(out)].sort()
}

/**
 * The requested document, or a 403 naming every scope the minter does not
 * hold - named, so the Admin can say why rather than showing a bare refusal.
 */
export function assertApiKeyContained(requested: ApiKeyPermissions, minter: MinterAuthority): ApiKeyPermissions {
  const excess = apiKeyPermissionExcess(requested, minter)
  if (excess.length > 0) {
    throw new RequestError(
      'FORBIDDEN',
      `A key cannot be given authority you do not hold: ${excess.join(', ')}`,
      403,
      Object.fromEntries(excess.map((p) => [`permissions.${p}`, 'you do not hold this'])),
      { excess },
    )
  }
  return requested
}
