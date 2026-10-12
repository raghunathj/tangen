/**
 * File Name: extension-grants.ts
 * Purpose: The grant language an extension is approved for, compiled into the
 *          authority the kernel already enforces (Extension Kernel K1.1,
 *          tasks/plan-extension-kernel.md). Content grants become the key-model
 *          bundle (`ApiKeyPermissions`) so the local client, TangenQL, GraphQL
 *          and every route guard refuse an extension exactly as they refuse a
 *          key; facility grants gate the ctx (`db:own`, `ai:*`, `jobs:*`, ...)
 *          and pass through verbatim; anything unrecognised is reported, never
 *          silently accepted. Pure: no I/O, no registry, no side effects.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Grammar is `<family>:<verb>[:<scope>(<a,b>)]*`.
 *          - content:read | read:draft | create | update | publish | delete
 *            with `types(a,b)` (per-type grant) and `fields(a,b)` (a field
 *            allow-list on the bundle, enforced by lib/field-access.ts).
 *          - media:read|write|delete [folders(...)], globals:read|write
 *            [names(...)], search:read [types(...)] [audiences(...)],
 *            webhooks:read|write|delete, tables:read [names(...)],
 *            schema:push|pull, locales:all | locales:en,fr,
 *            capability:<rbac capability id> (the id may contain colons).
 *          - facilities (`db:own`, `ai:generate`, `network:<host>`, ...) are
 *            not content authority; the ctx checks them by name.
 *          `admin` / `superadmin` are deliberately not grants: an extension can
 *          never hold the member fast path.
 */
import type { ApiKeyPermissions, ObjectAction } from './api-keys'
import { API_KEY_SCOPE_ACTIONS } from './api-keys'

export interface CompiledGrants {
  /** The key-model bundle: what the content, media, globals, search, webhooks, tables and schema guards enforce. */
  bundle: ApiKeyPermissions
  /** RBAC capabilities the extension holds (`capability:<id>`). */
  capabilities: string[]
  /** Write-locale scope; undefined means the caller's default (base only). */
  locales?: 'all' | string[]
  /** Facility grants, verbatim (`db:own`, `ai:generate`, `network:<host>`); the ctx gates on these. */
  facilities: Set<string>
  /** Grants nobody recognised. A caller that fails closed refuses the whole set. */
  unknown: string[]
}

const CONTENT_VERBS: Record<string, ObjectAction[]> = {
  read: ['read'],
  'read:draft': ['read', 'read_draft'],
  create: ['write'],
  update: ['write'],
  publish: ['publish'],
  delete: ['delete'],
}

/** Families whose grants gate the ctx rather than the content bundle. */
export const FACILITY_FAMILIES = [
  'db', 'ai', 'jobs', 'routes', 'events', 'filters', 'admin', 'flow', 'mcp', 'telemetry', 'storage', 'translation', 'graphql', 'hooks',
  'secrets', 'connections', 'network', 'interceptors', 'store', 'mail', 'realtime', 'delegation',
  'filesystem', 'process', 'runtime',
] as const

/**
 * The tier a marketplace install can never grant (RFC §D.3). Tested by prefix
 * or exact match; `schema:push` is here because it rewrites the content model.
 */
export const PRIVILEGED_GRANT_PATTERNS: readonly string[] = [
  'db:platform', 'network:any', 'network:private', 'secrets:any', 'interceptors:platform', 'schema:push',
  'filesystem:', 'process:', 'runtime:',
]

export function isPrivilegedGrant(grant: string): boolean {
  return PRIVILEGED_GRANT_PATTERNS.some((p) => (p.endsWith(':') ? grant.startsWith(p) : grant === p))
}

type Scopes = Record<string, string[]>

/** `read:types(post,page):fields(a)` → verb `read`, scopes { types: [post, page], fields: [a] }. Null on a malformed scope. */
function splitScopes(rest: string[]): { verb: string; scopes: Scopes } | null {
  const verbParts: string[] = []
  const scopes: Scopes = {}
  for (const part of rest) {
    const m = /^([a-z]+)\((.*)\)$/.exec(part)
    if (!m) {
      if (Object.keys(scopes).length) return null
      verbParts.push(part)
      continue
    }
    const args = m[2].split(',').map((s) => s.trim()).filter(Boolean)
    if (!args.length) return null
    scopes[m[1]] = args
  }
  return { verb: verbParts.join(':'), scopes }
}

function pushUnique<T>(list: T[], items: readonly T[]): T[] {
  for (const it of items) if (!list.includes(it)) list.push(it)
  return list
}

function has<T extends string>(list: readonly T[], v: string): v is T {
  return (list as readonly string[]).includes(v)
}

/** Compile approved grant strings into enforceable authority. Never throws; see `unknown`. */
export function compileGrants(grants: readonly string[]): CompiledGrants {
  const bundle: ApiKeyPermissions = {}
  const out: CompiledGrants = { bundle, capabilities: [], facilities: new Set(), unknown: [] }

  for (const raw of new Set(grants.map((g) => g.trim()).filter(Boolean))) {
    const [family, ...rest] = raw.split(':')
    if (!rest.length) { out.unknown.push(raw); continue }

    if (family === 'capability') { pushUnique(out.capabilities, [rest.join(':')]); continue }

    if (family === 'locales') {
      const spec = rest.join(':')
      if (spec === 'all') { out.locales = 'all'; bundle.locales = 'all' }
      else {
        const list = spec.split(',').map((s) => s.trim()).filter(Boolean)
        if (!list.length) { out.unknown.push(raw); continue }
        const current = Array.isArray(out.locales) ? out.locales : []
        out.locales = out.locales === 'all' ? 'all' : pushUnique(current, list)
        bundle.locales = out.locales
      }
      continue
    }

    if (has(FACILITY_FAMILIES, family)) { out.facilities.add(raw); continue }

    const parsed = splitScopes(rest)
    if (!parsed) { out.unknown.push(raw); continue }
    const { verb, scopes } = parsed

    switch (family) {
      case 'content': {
        const actions = CONTENT_VERBS[verb]
        if (!actions) { out.unknown.push(raw); break }
        const objects = (bundle.objects ??= {})
        const types = scopes.types && !scopes.types.includes('*') ? scopes.types : null
        if (types) {
          objects.types ??= {}
          for (const t of types) pushUnique((objects.types[t] ??= []), actions)
        } else {
          pushUnique((objects.actions ??= []), actions)
        }
        if (scopes.fields) {
          // K1.3: the allow-list is keyed per type when types(...) scopes the verb, else '*'.
          const side: 'read' | 'write' = verb.startsWith('read') ? 'read' : 'write'
          const fieldsMap = (objects.fields ??= {})
          for (const t of types ?? ['*']) {
            const entry = (fieldsMap[t] ??= {})
            entry[side] = pushUnique(entry[side] ?? [], scopes.fields)
          }
        }
        break
      }
      case 'media': {
        if (!has(API_KEY_SCOPE_ACTIONS.media, verb)) { out.unknown.push(raw); break }
        const media = (bundle.media ??= { actions: [] })
        pushUnique(media.actions, [verb])
        if (scopes.folders) media.allowedFolders = pushUnique(media.allowedFolders ?? [], scopes.folders)
        break
      }
      case 'globals': {
        if (!has(API_KEY_SCOPE_ACTIONS.globals, verb)) { out.unknown.push(raw); break }
        const globals = (bundle.globals ??= { actions: [] })
        pushUnique(globals.actions, [verb])
        if (scopes.names) globals.allowedNames = pushUnique(globals.allowedNames ?? [], scopes.names)
        break
      }
      case 'search': {
        if (!has(API_KEY_SCOPE_ACTIONS.search, verb)) { out.unknown.push(raw); break }
        const search = (bundle.search ??= { actions: [] })
        pushUnique(search.actions, [verb])
        if (scopes.types) search.allowedTypes = pushUnique(search.allowedTypes ?? [], scopes.types)
        if (scopes.audiences) {
          const bad = scopes.audiences.find((a) => a !== 'public' && a !== 'internal')
          if (bad) { out.unknown.push(raw); break }
          search.audiences = pushUnique(search.audiences ?? [], scopes.audiences as ('public' | 'internal')[])
        }
        break
      }
      case 'webhooks': {
        if (!has(API_KEY_SCOPE_ACTIONS.webhooks, verb)) { out.unknown.push(raw); break }
        pushUnique((bundle.webhooks ??= { actions: [] }).actions, [verb])
        break
      }
      case 'tables': {
        if (!has(API_KEY_SCOPE_ACTIONS.tables, verb)) { out.unknown.push(raw); break }
        const tables = (bundle.tables ??= { actions: [] })
        pushUnique(tables.actions, [verb])
        if (scopes.names) tables.allowedTables = pushUnique(tables.allowedTables ?? [], scopes.names)
        break
      }
      case 'schema': {
        if (!has(API_KEY_SCOPE_ACTIONS.schema, verb)) { out.unknown.push(raw); break }
        pushUnique((bundle.schema ??= { actions: [] }).actions, [verb])
        break
      }
      default:
        out.unknown.push(raw)
    }
  }
  return out
}
