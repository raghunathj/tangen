/**
 * File Name: resolvers.ts
 * Purpose: The resolver-hook contract the schema-builder wires in, plus the
 *          implementations (G2): list/single queries and relation fields
 *          over an injected local client. Relations go through a per-request
 *          batch loader (no N+1); every content-type access is gated by an
 *          injected canRead so GraphQL matches REST's permission model.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Resolvers read the client / canRead / loaders from the
 *          GraphQL contextValue (createRequestContext), so the hooks are
 *          static and the builder imports no I/O.
 */
import { GraphQLError, type GraphQLFieldResolver } from 'graphql'
import { RouteError } from '@tangen/types'
import { whereToFilter } from './filter'
import { createBatchLoaders, type BatchLoaders } from './loaders'
import type { RealtimeSubscriber } from './subscriptions'

type Row = Record<string, unknown>

/** What resolvers read off the GraphQL contextValue. */
export interface GraphqlRequestContext {
  client: {
    objects: (type: string) => any
    table?: (name: string) => any
    globals?: (name: string) => any
  }
  canRead: (typeName: string) => boolean
  canWrite: (typeName: string) => boolean
  /** K0: publish, unpublish and preflight need objects:publish, not a write grant. */
  canPublish?: (typeName: string) => boolean
  canReadDrafts?: (typeName: string) => boolean
  loaders: BatchLoaders
  /** Realtime R5: present only on the WebSocket adapter; subscription fields refuse without it. */
  realtime?: RealtimeSubscriber
}

/** Builds the per-request context (call once per request in the mount). */
export function createRequestContext(input: {
  client: GraphqlRequestContext['client']
  canRead: (typeName: string) => boolean
  /** Absent ⇒ writes denied (read-only mount). */
  canWrite?: (typeName: string) => boolean
  /** Absent ⇒ draft reads denied (objects:read_draft — preview keys). */
  canReadDrafts?: (typeName: string) => boolean
  /** Absent ⇒ publish, unpublish and preflight denied (objects:publish). */
  canPublish?: (typeName: string) => boolean
  /** Realtime R5: the per-connection subscriber the WebSocket adapter installs; absent over POST. */
  realtime?: RealtimeSubscriber
}): GraphqlRequestContext {
  return {
    client: input.client,
    canRead: input.canRead,
    canWrite: input.canWrite ?? (() => false),
    canReadDrafts: input.canReadDrafts ?? (() => false),
    canPublish: input.canPublish ?? (() => false),
    loaders: createBatchLoaders(input.client, input.canRead),
    ...(input.realtime ? { realtime: input.realtime } : {}),
  }
}

function requireRead(ctx: GraphqlRequestContext, type: string): void {
  if (!ctx.canRead(type)) {
    throw new GraphQLError(`You do not have permission to read '${type}'`, {
      extensions: { code: 'FORBIDDEN' },
    })
  }
}

function requireDraftRead(ctx: GraphqlRequestContext, type: string): void {
  if (!ctx.canReadDrafts?.(type)) {
    throw new GraphQLError(`Draft access to '${type}' requires the objects:read_draft grant`, {
      extensions: { code: 'FORBIDDEN' },
    })
  }
}

function requirePublish(ctx: GraphqlRequestContext, type: string): void {
  if (!ctx.canPublish || !ctx.canPublish(type)) {
    throw new GraphQLError(`You do not have permission to publish '${type}'`, {
      extensions: { code: 'FORBIDDEN' },
    })
  }
}

function requireWrite(ctx: GraphqlRequestContext, type: string): void {
  if (!ctx.canWrite(type)) {
    throw new GraphQLError(`You do not have permission to write '${type}'`, {
      extensions: { code: 'FORBIDDEN' },
    })
  }
}

function idOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) return String((value as { id: unknown }).id)
  return ''
}

function idsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(idOf).filter(Boolean)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    // JSON array form
    if (trimmed.startsWith('[')) {
      try { const p = JSON.parse(trimmed); if (Array.isArray(p)) return p.map(idOf).filter(Boolean) } catch { /* fall through */ }
    }
    // Postgres array literal form: {a,b,c} (ids may be brace-wrapped uuids)
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed.slice(1, -1).split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter(Boolean)
    }
    return trimmed ? [trimmed] : []
  }
  return []
}

/**
 * The resolver hooks. Each factory returns a static resolver that reads the
 * request context — so nothing here is per-request state.
 */
export function createResolvers() {
  const list = (type: string): GraphQLFieldResolver<unknown, GraphqlRequestContext> =>
    async (_parent, args, ctx) => {
      requireRead(ctx, type)
      // depth(0) keeps relation fields as raw ids so relation resolvers can
      // batch-load them (rather than the query engine auto-expanding to a
      // display value); GraphQL selection drives what actually gets fetched.
      let b = ctx.client.objects(type).where(whereToFilter(args.where)).depth(0)
      if (args.orderBy?.field) b = b.sort(args.orderBy.field, args.orderBy.direction === 'desc' ? 'desc' : 'asc')
      if (typeof args.limit === 'number') b = b.limit(args.limit)
      if (typeof args.offset === 'number') b = b.offset(args.offset)
      if (args.after) b = b.after(args.after)
      if (args.locale) b = b.locale(args.locale)
      // Public surface: published content by default; drafts need read_draft
      const wanted = String(args.status ?? 'published')
      if (wanted !== 'published') requireDraftRead(ctx, type)
      b = b.status(wanted)
      const res = await b.get()
      return { data: res.data ?? [], meta: res.meta ?? { total: (res.data ?? []).length } }
    }

  const single = (type: string): GraphQLFieldResolver<unknown, GraphqlRequestContext> =>
    async (_parent, args, ctx) => {
      requireRead(ctx, type)
      // Permission errors must SURFACE — only absence collapses to null below.
      const wanted = String(args.status ?? 'published')
      if (wanted !== 'published') requireDraftRead(ctx, type)
      // find/findBySlug throw 404 when absent — GraphQL wants null there.
      try {
        let b = ctx.client.objects(type)
        if (args.locale) b = b.locale(String(args.locale))
        b = b.status(wanted)
        if (args.id) return (await b.find(String(args.id))).data ?? null
        if (args.slug) return (await b.findBySlug(String(args.slug))).data ?? null
      } catch { return null }
      return null
    }

  /** Polymorphic object refs ({ id, type }) — resolved through the published-only
   *  batch loaders; unreadable types and unresolved refs drop (null / filtered). */
  const objectRef = (_parent: string, fieldName: string): GraphQLFieldResolver<Row, GraphqlRequestContext> =>
    async (parent, _args, ctx) => {
      const val = parent?.[fieldName]
      const resolveOne = async (ref: unknown) => {
        const r = ref as { id?: string; type?: string } | null
        if (!r || typeof r.id !== 'string' || typeof r.type !== 'string') return null
        if (!ctx.canRead(r.type)) return null
        const row = await ctx.loaders.load(r.type, r.id)
        return row ? { ...row, type: r.type } : null
      }
      if (Array.isArray(val)) {
        const out = await Promise.all(val.map(resolveOne))
        return out.filter((x) => x !== null)
      }
      return resolveOne(val)
    }

  const relationOne = (_parent: string, fieldName: string, targetType: string): GraphQLFieldResolver<Row, GraphqlRequestContext> =>
    (parent, _args, ctx) => {
      const id = idOf(parent?.[fieldName])
      return id ? ctx.loaders.load(targetType, id) : null
    }

  const relationMany = (_parent: string, fieldName: string, targetType: string): GraphQLFieldResolver<Row, GraphqlRequestContext> =>
    async (parent, _args, ctx) => {
      const ids = idsOf(parent?.[fieldName])
      const rows = await ctx.loaders.loadMany(targetType, ids)
      return { data: rows, meta: { total: rows.length, limit: rows.length, offset: 0, nextCursor: null } }
    }

  const table = (name: string): GraphQLFieldResolver<unknown, GraphqlRequestContext> =>
    async (_parent, args, ctx) => {
      if (!ctx.client.table) return { data: [], meta: { total: 0 } }
      let b = ctx.client.table(name).where(args.where ?? {})
      if (args.orderBy?.field) b = b.sort(args.orderBy.field, args.orderBy.direction === 'desc' ? 'desc' : 'asc')
      if (typeof args.limit === 'number') b = b.limit(args.limit)
      if (typeof args.offset === 'number') b = b.offset(args.offset)
      const res = await b.find()
      return { data: res.data ?? [], meta: res.meta ?? { total: (res.data ?? []).length } }
    }

  const global = (): GraphQLFieldResolver<unknown, GraphqlRequestContext> =>
    async (_parent, args, ctx) => {
      if (!ctx.client.globals) return null
      return ctx.client.globals(String(args.name)).get()
    }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const create = (type: string): GraphQLFieldResolver<unknown, GraphqlRequestContext> =>
    async (_p, args, ctx) => {
      requireWrite(ctx, type)
      const { title, slug, ...values } = (args.input ?? {}) as Record<string, unknown>
      return (await ctx.client.objects(type).create({
        title: String(title ?? 'Untitled'),
        values: { ...(slug !== undefined ? { slug } : {}), ...values },
      })).data
    }

  const update = (type: string): GraphQLFieldResolver<unknown, GraphqlRequestContext> =>
    async (_p, args, ctx) => {
      requireWrite(ctx, type)
      const input = { ...(args.input ?? {}) } as Record<string, unknown>
      return (await ctx.client.objects(type).update(String(args.id), input)).data
    }

  const publish = (type: string): GraphQLFieldResolver<unknown, GraphqlRequestContext> =>
    async (_p, args, ctx) => {
      requirePublish(ctx, type)
      try {
        return (await ctx.client.objects(type).publish(String(args.id), { cascade: args.cascade === true })).data
      } catch (e) { throw asCascadeError(e) }
    }

  const preflight = (type: string): GraphQLFieldResolver<unknown, GraphqlRequestContext> =>
    async (_p, args, ctx) => { requirePublish(ctx, type); return (await ctx.client.objects(type).publishPreflight(String(args.id))).data }

  const unpublish = (type: string): GraphQLFieldResolver<unknown, GraphqlRequestContext> =>
    async (_p, args, ctx) => { requirePublish(ctx, type); return (await ctx.client.objects(type).unpublish(String(args.id))).data }

  const remove = (type: string): GraphQLFieldResolver<unknown, GraphqlRequestContext> =>
    async (_p, args, ctx) => {
      requireWrite(ctx, type)
      await ctx.client.objects(type).delete(String(args.id))
      return { id: String(args.id), deleted: true }
    }

  return { list, single, relationOne, relationMany, objectRef, table, global, create, update, publish, preflight, unpublish, remove }
}

/** Translate a local-client RouteError from a cascade into a GraphQLError whose
 * extensions carry the publish plan (so clients can confirm / deep-link). */
function asCascadeError(e: unknown): unknown {
  if (e instanceof RouteError) {
    const code = e.status === 409 ? 'NEEDS_CASCADE' : e.status === 422 ? 'CASCADE_BLOCKED' : 'REQUEST_ERROR'
    return new GraphQLError(e.message, { extensions: { code, status: e.status, plan: e.details } })
  }
  return e
}

/**
 * Factory hooks the schema-builder attaches. Each returns the actual GraphQL
 * resolver for a given type (or relation field).
 */
export interface ResolverHooks {
  list?: (typeName: string) => GraphQLFieldResolver<unknown, unknown>
  single?: (typeName: string) => GraphQLFieldResolver<unknown, unknown>
  relationOne?: (parentType: string, fieldName: string, targetType: string) => GraphQLFieldResolver<unknown, unknown>
  relationMany?: (parentType: string, fieldName: string, targetType: string) => GraphQLFieldResolver<unknown, unknown>
  objectRef?: (parentType: string, fieldName: string) => GraphQLFieldResolver<unknown, unknown>
  table?: (name: string) => GraphQLFieldResolver<unknown, unknown>
  global?: () => GraphQLFieldResolver<unknown, unknown>
  create?: (typeName: string) => GraphQLFieldResolver<unknown, unknown>
  update?: (typeName: string) => GraphQLFieldResolver<unknown, unknown>
  publish?: (typeName: string) => GraphQLFieldResolver<unknown, unknown>
  preflight?: (typeName: string) => GraphQLFieldResolver<unknown, unknown>
  unpublish?: (typeName: string) => GraphQLFieldResolver<unknown, unknown>
  remove?: (typeName: string) => GraphQLFieldResolver<unknown, unknown>
}
