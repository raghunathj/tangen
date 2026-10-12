/**
 * File Name: intersect.ts
 * Purpose: The authority a service runs with when a CALLER dispatches it
 *          (Extension Kernel K3.2, tasks/plan-extension-kernel.md; proposal
 *          D.2): the provider's grants intersected with the caller's
 *          authority. A viewer cannot read drafts through a provider that
 *          may, and a provider cannot be made to write by a caller that may
 *          not. The identity stays the provider's - attribution names who
 *          ran the code - the caller rides as `onBehalfOf` and initiator.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. The admin fast path is a ceiling only when both
 *          sides hold it; a side that holds it contributes nothing else, so
 *          the other side's bundle is the result. Facilities are the
 *          provider's: the ctx a service runs with is the provider's
 *          concern, not the caller's. Locales: `all` yields to the other
 *          side, `base` wins over anything, lists intersect. Field
 *          allow-lists: a list on either side applies; on both, the common
 *          patterns.
 */
import type { ActorContext, ApiKeyPermissions, ExecutionContext, LocaleScope, ObjectAction } from '@tangen/types'
import { createExecution } from './execution'

type Bundle = ApiKeyPermissions & { capabilities?: string[] }

const both = <T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined => {
  if (!a || !b) return undefined
  return a.filter((x) => b.includes(x))
}

/** `undefined` on either side means "everything" for an allow-list; the other side's list is the result. */
const allowList = (a: string[] | undefined, b: string[] | undefined): string[] | undefined => {
  if (!a) return b
  if (!b) return a
  return a.filter((x) => b.includes(x))
}

function intersectObjects(a: Bundle['objects'], b: Bundle['objects']): Bundle['objects'] {
  if (!a || !b) return undefined
  const out: NonNullable<Bundle['objects']> = {}
  const actions = both(a.actions, b.actions)
  if (actions && actions.length) out.actions = actions
  // Per-type grants: what a type may do is (its own list, else the flat actions) on each side, intersected.
  const typeNames = new Set([...Object.keys(a.types ?? {}), ...Object.keys(b.types ?? {})])
  if (typeNames.size) {
    const types: Record<string, ObjectAction[]> = {}
    for (const t of typeNames) {
      const per = both(a.types?.[t] ?? a.actions, b.types?.[t] ?? b.actions) ?? []
      // Only worth a per-type entry when it adds to (or differs from) the flat actions.
      const extra = per.filter((x) => !(out.actions ?? []).includes(x))
      if (extra.length) types[t] = per
    }
    if (Object.keys(types).length) out.types = types
  }
  const allowedTypes = allowList(a.allowedTypes, b.allowedTypes)
  if (allowedTypes) out.allowedTypes = allowedTypes
  const fieldKeys = new Set([...Object.keys(a.fields ?? {}), ...Object.keys(b.fields ?? {})])
  if (fieldKeys.size) {
    const fields: NonNullable<Bundle['objects']>['fields'] = {}
    for (const k of fieldKeys) {
      const entry: { read?: string[]; write?: string[] } = {}
      const read = allowList(a.fields?.[k]?.read, b.fields?.[k]?.read)
      const write = allowList(a.fields?.[k]?.write, b.fields?.[k]?.write)
      if (read) entry.read = read
      if (write) entry.write = write
      if (Object.keys(entry).length) fields[k] = entry
    }
    if (Object.keys(fields).length) out.fields = fields
  }
  return Object.keys(out).length ? out : undefined
}

function intersectScope<T extends { actions: string[] }>(a: T | undefined, b: T | undefined, lists: Array<keyof T> = []): T | undefined {
  if (!a || !b) return undefined
  const actions = both(a.actions, b.actions) ?? []
  if (!actions.length) return undefined
  const out = { actions } as T
  for (const key of lists) {
    const merged = allowList(a[key] as string[] | undefined, b[key] as string[] | undefined)
    if (merged) (out as Record<string, unknown>)[key as string] = merged
  }
  return out
}

function intersectBundle(a: Bundle, b: Bundle): ApiKeyPermissions {
  const out: ApiKeyPermissions = {}
  const objects = intersectObjects(a.objects, b.objects)
  if (objects) out.objects = objects
  const media = intersectScope(a.media, b.media, ['allowedFolders'])
  if (media) out.media = media
  const webhooks = intersectScope(a.webhooks, b.webhooks)
  if (webhooks) out.webhooks = webhooks
  const search = intersectScope(a.search, b.search, ['allowedTypes', 'audiences'])
  if (search) out.search = search
  const globals = intersectScope(a.globals, b.globals, ['allowedNames'])
  if (globals) out.globals = globals
  const schema = intersectScope(a.schema, b.schema)
  if (schema) out.schema = schema
  const tables = intersectScope(a.tables, b.tables, ['allowedTables'])
  if (tables) out.tables = tables
  return out
}

function intersectLocales(a: LocaleScope, b: LocaleScope): LocaleScope {
  if (a === 'base' || b === 'base') return 'base'
  if (a === 'all') return b
  if (b === 'all') return a
  return a.filter((l) => b.includes(l))
}

/**
 * The provider's actor narrowed to what the caller may as well. The
 * result keeps the provider's identity and facilities; the caller becomes
 * `onBehalfOf`.
 */
export function intersectAuthority(provider: ActorContext, caller: ActorContext): ActorContext {
  const pa = provider.authority
  const ca = caller.authority
  const admin = pa.admin && ca.admin
  let bundle: ApiKeyPermissions
  let capabilities: string[]
  if (admin) { bundle = {}; capabilities = [] }
  else if (pa.admin) { bundle = { ...(ca.bundle as ApiKeyPermissions) }; capabilities = [...ca.capabilities] }
  else if (ca.admin) { bundle = { ...(pa.bundle as ApiKeyPermissions) }; capabilities = [...pa.capabilities] }
  else {
    bundle = intersectBundle(pa.bundle as Bundle, ca.bundle as Bundle)
    capabilities = pa.capabilities.filter((c) => ca.capabilities.includes(c))
  }
  const { capabilities: _c, ...cleanBundle } = bundle as ApiKeyPermissions & { capabilities?: unknown }
  return {
    identity: provider.identity,
    workspaceId: provider.workspaceId,
    role: null,
    authority: {
      bundle: cleanBundle,
      admin,
      superadmin: pa.superadmin && ca.superadmin,
      capabilities,
      locales: admin ? 'all' : intersectLocales(pa.locales, ca.locales),
      ...(pa.facilities ? { facilities: [...pa.facilities] } : {}),
    },
    onBehalfOf: caller.onBehalfOf ?? caller.identity,
    reason: provider.reason,
  }
}

/** The execution a dispatched service runs in: the intersected actor, the caller as initiator, chained to the caller's execution. */
export function dispatchExecution(providerExec: ExecutionContext, callerExec: ExecutionContext): ExecutionContext {
  if (providerExec.workspaceId !== callerExec.workspaceId) {
    throw new Error(`A service is dispatched within one workspace: provider runs in ${providerExec.workspaceId}, caller in ${callerExec.workspaceId}`)
  }
  return createExecution({
    kind: 'job', source: 'extension', workspaceId: providerExec.workspaceId,
    actor: intersectAuthority(providerExec.actor, callerExec.actor),
    initiator: (callerExec.actor.onBehalfOf ?? callerExec.actor.identity) as never,
    correlationId: callerExec.correlationId, causationId: callerExec.id,
    locale: callerExec.locale,
  })
}
