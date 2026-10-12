/**
 * File Name: field-access.ts
 * Purpose: Field-level access control — evaluates FieldAdminConfig.access
 *          role lists against the requesting member's effective role.
 *          Members only: API keys and admin sessions bypass (v1 contract).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: access lists name built-in roles and custom role
 *          slugs. Absent access (or an empty list) = everyone. Write
 *          denial also applies when read is denied — a field you cannot
 *          see is never writable.
 *          Grant allow-lists (Extension Kernel K1.3): an actor whose bundle
 *          carries `objects.fields` (an extension with
 *          `content:update:fields(seo.*)`) may write ONLY the fields the
 *          list names - the rest, built-ins included, are restricted; a
 *          `read` list projects reads the same way. A write outside the
 *          list is REFUSED (`assertGrantedWrite`), never silently stripped:
 *          a grant is explicit, and a dropped write is a wrong guess that
 *          succeeds.
 */
import type { ObjectTypeDefinition } from '@tangen/types'
import { decide } from '../kernel/policy'
import { actorFromContext, type LegacyIdentityContext } from '../kernel/actor'
import { RequestError } from './errors'

/** The bundle's field allow-lists, keyed by type name or '*'. */
export type FieldGrants = Record<string, { read?: string[]; write?: string[] }>

export interface FieldAccessContext {
  /** Effective member role (env override applied); null for API keys. */
  memberRole: string | null
  /** True for owner/admin/superadmin sessions — always bypass. */
  isAdmin: boolean
  /** Field allow-lists from the actor's bundle (K1.3); absent for members and plain keys. */
  fieldGrants?: FieldGrants
}

type AccessConfig = { read?: string[]; write?: string[] } | undefined
type FieldLike = { name: string; group?: string | null }

/** Built-in columns a write may name besides the type's fields; an allow-list must name them to open them. */
const BUILTIN_WRITABLE = ['title', 'slug'] as const

/** A pattern is a field name, or `<group>.*` for every field whose group is that. */
export function matchesFieldPattern(pattern: string, field: FieldLike): boolean {
  if (pattern.endsWith('.*')) return field.group === pattern.slice(0, -2)
  return pattern === field.name
}

/** The allow-list that applies to a type for an action: the '*' entry and the type's own, merged; null when none applies. */
function allowListFor(ctx: FieldAccessContext, typeName: string | undefined, action: 'read' | 'write'): string[] | null {
  const grants = ctx.fieldGrants
  if (!grants) return null
  const star = grants['*']?.[action]
  const own = typeName ? grants[typeName]?.[action] : undefined
  if (!star && !own) return null
  return [...(star ?? []), ...(own ?? [])]
}

/** Every field of the type (flattened list plus the writable built-ins) the allow-list does NOT name. */
function outsideAllowList(typeDef: Pick<ObjectTypeDefinition, 'fields'> & { name?: string }, ctx: FieldAccessContext, action: 'read' | 'write'): Set<string> {
  const out = new Set<string>()
  const allow = allowListFor(ctx, typeDef.name, action)
  if (!allow) return out
  const fields: FieldLike[] = [...BUILTIN_WRITABLE.map((name) => ({ name })), ...((typeDef.fields ?? []) as FieldLike[])]
  for (const f of fields) if (!allow.some((p) => matchesFieldPattern(p, f))) out.add(f.name)
  return out
}

function listAllows(list: string[] | undefined, role: string | null): boolean {
  if (!list || list.length === 0) return true
  if (!role) return true            // API keys unaffected in v1
  return list.includes(role)
}

/** Whether the caller may read a field with this admin config. */
export function canReadField(ctx: FieldAccessContext, access: AccessConfig): boolean {
  if (ctx.isAdmin || !access) return true
  return listAllows(access.read, ctx.memberRole)
}

/** Whether the caller may write a field (read denial implies write denial). */
export function canWriteField(ctx: FieldAccessContext, access: AccessConfig): boolean {
  if (ctx.isAdmin || !access) return true
  return listAllows(access.read, ctx.memberRole) && listAllows(access.write, ctx.memberRole)
}

/** Builds the access context from a request's auth decorations. */
export function fieldAccessContext(ctx: LegacyIdentityContext): FieldAccessContext {
  // K2: derived from the actor, once; a role belongs to a member actor only.
  const actor = actorFromContext(ctx)
  const fieldGrants = (actor?.authority.bundle as { objects?: { fields?: FieldGrants } } | undefined)?.objects?.fields
  return {
    memberRole: actor?.identity.kind === 'member' ? actor.role : null,
    isAdmin: actor?.authority.admin === true,
    ...(fieldGrants ? { fieldGrants } : {}),
  }
}

/** Field names of a type the caller may NOT write. */
export function restrictedWriteFields(
  typeDef: (Pick<ObjectTypeDefinition, 'fields'> & { name?: string }) | undefined,
  ctx: FieldAccessContext,
): Set<string> {
  if (ctx.isAdmin || !typeDef?.fields) return new Set<string>()
  const out = outsideAllowList(typeDef, ctx, 'write')
  for (const f of typeDef.fields) {
    const access = (f.config?.admin as { access?: AccessConfig } | undefined)?.access
    if (access && !canWriteField(ctx, access)) out.add(f.name)
  }
  return out
}

/** Field names of a type the caller may NOT read. */
export function restrictedReadFields(
  typeDef: (Pick<ObjectTypeDefinition, 'fields'> & { name?: string }) | undefined,
  ctx: FieldAccessContext,
): Set<string> {
  if (ctx.isAdmin || !typeDef?.fields) return new Set<string>()
  const out = outsideAllowList(typeDef, ctx, 'read')
  for (const f of typeDef.fields) {
    const access = (f.config?.admin as { access?: AccessConfig } | undefined)?.access
    if (access && !canReadField(ctx, access)) out.add(f.name)
  }
  return out
}

/**
 * K1.3: a write that names a field outside the actor's grant allow-list is
 * refused with a 403 naming the fields. Role-list restrictions are not
 * asserted here - they keep stripping, as documented for members.
 */
export function assertGrantedWrite(
  values: Record<string, unknown>,
  typeDef: (Pick<ObjectTypeDefinition, 'fields'> & { name?: string }) | undefined,
  ctx: FieldAccessContext,
): void {
  if (ctx.isAdmin || !typeDef) return
  const outside = outsideAllowList(typeDef, ctx, 'write')
  if (outside.size === 0) return
  const denied = Object.keys(values).filter((k) => outside.has(k)).sort()
  if (denied.length === 0) return
  throw new RequestError('FORBIDDEN', `Your grants do not cover writing ${denied.join(', ')} on ${typeDef.name ?? 'this type'}`, 403)
}

/**
 * Strips denied fields from a write payload in place-safe fashion.
 * Returns the stripped field names (for the X-Tangen-Restricted-Fields header).
 */
export function stripRestrictedWrites<T extends Record<string, unknown>>(
  values: T,
  restricted: Set<string>,
): { values: T; stripped: string[] } {
  if (restricted.size === 0) return { values, stripped: [] }
  const stripped: string[] = []
  const next: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (restricted.has(k)) stripped.push(k)
    else next[k] = v
  }
  return { values: next as T, stripped }
}

/** Removes denied fields from response rows (read mask). `id` always survives. */
export function applyFieldAccessMask<T extends Record<string, unknown>>(
  rows: T[],
  restricted: Set<string>,
): T[] {
  if (restricted.size === 0) return rows
  return rows.map((row) => {
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (k !== 'id' && restricted.has(k)) continue
      next[k] = v
    }
    return next as T
  })
}

/**
 * Locale-level write access: MemberPermissions.locales limits which content
 * languages a role may write ('all' when absent). `locale` null means the
 * default language / base object (create, publish, delete, base-field
 * updates). Reads are never locale-restricted. Admin bypasses; a key writes
 * the base locale by default and other locales only with a `locales` grant.
 */
export function canWriteLocale(
  ctx: LegacyIdentityContext,
  locale: string | null,
  defaultLocale: string | undefined,
): boolean {
  // K2: the locale rule is the kernel's, keyed on the actor's locale scope
  // (a key's `locales` grant, a member's bundle, an admin's fast path).
  return decide(actorFromContext(ctx), { kind: 'locale', action: 'write', locale, defaultLocale: defaultLocale ?? null }).allow
}
