/**
 * File Name: schema-builder.ts
 * Purpose: The heart of @tangen/graphql — turns a content SchemaDefinition
 *          into a GraphQLSchema. Each type becomes an object type (system
 *          fields + mapped content fields); relations wire to the target
 *          type (single) or its Connection (many); every type gets a list
 *          query (where/orderBy/limit/offset/after/locale → Connection) and
 *          a single query (id/slug). WhereInput + OrderBy inputs are
 *          generated per type. Field/type object references are thunked so
 *          self- and mutual-recursion build safely.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure — no I/O. Resolvers are attached separately (G2)
 *          so this stays unit-testable. Unsupported field types degrade to
 *          the JSON scalar rather than crashing the schema.
 */
import {
  GraphQLSchema, GraphQLObjectType, GraphQLInputObjectType, GraphQLNonNull,
  GraphQLList, GraphQLID, GraphQLString, GraphQLFloat, GraphQLInt, GraphQLBoolean, GraphQLUnionType,
  type GraphQLOutputType, type GraphQLInputType, type GraphQLFieldConfigMap,
  type GraphQLInputFieldConfigMap, type GraphQLFieldConfigArgumentMap,
} from 'graphql'
import type { SchemaDefinition, ObjectTypeDefinition, FieldDefinition } from '@tangen/types'
import { activeFields } from '@tangen/types'
import { GraphQLJSON, GraphQLDateTime } from './scalars'
import { buildSubscriptionType } from './subscriptions'
import {
  typeName, singleQueryName, listQueryNameFor, connectionName, whereInputName, orderByName,
} from './naming'

export interface CustomTableInput {
  name: string
  columns: Record<string, { type: string; nullable?: boolean }>
}

export interface BuildSchemaOptions {
  /** Attach resolvers by wiring these hooks (G2 supplies them). */
  resolvers?: import('./resolvers').ResolverHooks
  /** Custom tables → table_<name> queries over a generated row type. */
  customTables?: CustomTableInput[]
  /** Global names → a global(name) query (returns the JSON blob). */
  globalNames?: string[]
  /** Generate create/update/publish/unpublish/delete mutations per type. */
  mutations?: boolean
  /** Reusable component registry — resolves string refs in component fields (NR-3 typed blocks). */
  componentRegistry?: Array<{ name: string; label?: string; fields?: Array<Record<string, unknown>> }>
  /**
   * Realtime R5: generate the Subscription type (`<type>Changed`,
   * `objectsChanged`) over the realtime envelopes. The API mount sets it
   * only when a realtime hub is running in the process, so introspection
   * never advertises what the deployment cannot serve.
   */
  subscriptions?: boolean
}

/** Scalar/leaf mapping for a content field type → a GraphQL output type. */
function scalarOutput(fieldType: string): GraphQLOutputType | null {
  switch (fieldType) {
    case 'number': case 'currency': case 'rating': return GraphQLFloat
    case 'boolean': return GraphQLBoolean
    case 'date': return GraphQLDateTime
    // STRUCTURED values — richtext is a TipTap doc ({ type: 'doc', … }),
    // range reads as { min, max }, object is a polymorphic { id, type } ref.
    // Serializing any of these as String errors on every row with content.
    case 'json': case 'repeater': case 'component': case 'group': case 'geopoint':
    case 'richtext': case 'range': case 'object':
      return GraphQLJSON
    case 'multiselect': case 'tags':
      return new GraphQLList(GraphQLString)
    case 'text': case 'textarea': case 'slug': case 'email': case 'time':
    case 'url': case 'phone': case 'select': case 'color': case 'code': case 'password':
      return GraphQLString
    default:
      return null   // unknown → caller degrades to JSON
  }
}

/** The scalar input type used inside a WhereInput field filter. */
function filterScalarInput(fieldType: string): GraphQLInputType {
  switch (fieldType) {
    case 'number': case 'currency': case 'rating': return GraphQLFloat
    case 'boolean': return GraphQLBoolean
    default: return GraphQLString
  }
}

/** Custom-table column type → GraphQL output type. */
function tableColumnType(colType: string): GraphQLOutputType {
  switch (colType) {
    case 'number': return GraphQLFloat
    case 'boolean': return GraphQLBoolean
    case 'timestamp': return GraphQLDateTime
    case 'json': return GraphQLJSON
    default: return GraphQLString
  }
}

export function buildContentSchema(schema: SchemaDefinition, opts: BuildSchemaOptions = {}): GraphQLSchema {
  // TL-2: disabled types are absent from the GraphQL schema entirely (the
  // schema fingerprint includes the flag, so toggling regenerates). Disabled
  // *fields* are likewise dropped from every type (#42) — hidden everywhere.
  const types = (schema.types ?? [])
    .filter((t) => (t as { disabled?: boolean }).disabled !== true)
    .map((t) => ({ ...t, fields: activeFields((t.fields ?? []) as FieldDefinition[]) }))
  const byName = new Map(types.map((t) => [t.name, t]))
  const objectTypes = new Map<string, GraphQLObjectType>()
  const connectionTypes = new Map<string, GraphQLObjectType>()
  const whereInputs = new Map<string, GraphQLInputObjectType>()
  const orderByInputs = new Map<string, GraphQLInputObjectType>()

  // ── Shared types ──────────────────────────────────────────────────────────
  const QueryMeta = new GraphQLObjectType({
    name: 'QueryMeta',
    fields: {
      total: { type: new GraphQLNonNull(GraphQLInt) },
      limit: { type: GraphQLInt },
      offset: { type: GraphQLInt },
      nextCursor: { type: GraphQLString },
    },
  })
  const Media = new GraphQLObjectType({
    name: 'Media',
    fields: {
      id: { type: GraphQLID },
      /** Direct URL when the storage backend exposes one; null on local storage → use the /media proxy with storagePath. */
      url: { type: GraphQLString },
      thumbnailUrl: { type: GraphQLString },
      filename: { type: GraphQLString },
      originalName: { type: GraphQLString },
      mimeType: { type: GraphQLString },
      sizeBytes: { type: GraphQLFloat },
      width: { type: GraphQLFloat },
      height: { type: GraphQLFloat },
      altText: { type: GraphQLString },
      /** Alias of altText (kept for existing queries). */
      alt: { type: GraphQLString, resolve: (p: Record<string, unknown>) => p?.altText ?? null },
      tags: { type: new GraphQLList(GraphQLString) },
      storagePath: { type: GraphQLString },
      thumbnailPath: { type: GraphQLString },
      /** Rendition metadata keyed by variant name ({ hero: { width, storagePath… } }). */
      variants: { type: GraphQLJSON },
      /** Direct URLs per variant name — only when the storage backend exposes public URLs. */
      variantUrls: { type: GraphQLJSON },
      variantsStatus: { type: GraphQLString },
    },
  })
  const TableOrderBy = new GraphQLInputObjectType({
    name: 'TableOrderBy',
    fields: { field: { type: new GraphQLNonNull(GraphQLString) }, direction: { type: GraphQLString } },
  })

  const r = opts.resolvers

  // ── Object types (thunked fields → cycle-safe) ────────────────────────────
  const getObjectType = (name: string): GraphQLObjectType | undefined => {
    if (objectTypes.has(name)) return objectTypes.get(name)
    const def = byName.get(name)
    if (!def) return undefined
    const gqlType = new GraphQLObjectType({
      name: typeName(name),
      description: def.label,
      fields: () => buildObjectFields(def),
    })
    objectTypes.set(name, gqlType)
    return gqlType
  }

  const getConnectionType = (name: string): GraphQLObjectType => {
    if (connectionTypes.has(name)) return connectionTypes.get(name)!
    const conn = new GraphQLObjectType({
      name: connectionName(name),
      fields: () => ({
        data: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(getObjectType(name)!))) },
        meta: { type: new GraphQLNonNull(QueryMeta) },
      }),
    })
    connectionTypes.set(name, conn)
    return conn
  }

  function buildObjectFields(def: ObjectTypeDefinition): GraphQLFieldConfigMap<unknown, unknown> {
    const fields: GraphQLFieldConfigMap<unknown, unknown> = {
      id: { type: new GraphQLNonNull(GraphQLID) },
      status: { type: GraphQLString },
      title: { type: GraphQLString },
      slug: { type: GraphQLString },
      createdAt: { type: GraphQLDateTime },
      updatedAt: { type: GraphQLDateTime },
      publishedAt: { type: GraphQLDateTime },
      /** Preview reads (status draft/any): is this newer than the published web? Null on published-default reads. */
      hasDraftChanges: { type: GraphQLBoolean },
    }
    for (const f of def.fields ?? []) {
      fields[f.name] = fieldConfig(def, f)
    }
    return fields
  }

  // Polymorphic `object` fields become a UNION of their include types, so
  // consumers select real fields via inline fragments instead of raw JSON refs.
  const unionTypes = new Map<string, GraphQLUnionType>()
  const getObjectUnion = (ownerName: string, fieldName: string, members: string[]): GraphQLUnionType => {
    const key = `${ownerName}:${fieldName}`
    if (unionTypes.has(key)) return unionTypes.get(key)!
    const union = new GraphQLUnionType({
      name: `${typeName(ownerName)}${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1).replace(/[^A-Za-z0-9]/g, '')}Ref`,
      types: () => members.map((m) => getObjectType(m)).filter((t): t is GraphQLObjectType => !!t),
      resolveType: (value: unknown) => typeName(String((value as { type?: string })?.type ?? '')),
    })
    unionTypes.set(key, union)
    return union
  }

  // ── NR-3: typed blocks + repeater rows ─────────────────────────────────────
  // Every block def becomes a real object type (_key/_type/_label + sub-fields,
  // nested relations resolved through the published-only loaders); component
  // fields become lists of a per-field union; repeater fields become lists of
  // a per-field row type. Falls back to JSON when defs can't be resolved.
  const registry = (opts.componentRegistry ?? []) as Array<{ name: string; fields?: Array<Record<string, unknown>> }>
  const blockTypes = new Map<string, GraphQLObjectType>()
  const rowTypes = new Map<string, GraphQLObjectType>()
  const pascal = (v: string) => v.replace(/(^|[^A-Za-z0-9]+)([a-z0-9])/gi, (_m, _s, c) => String(c).toUpperCase()).replace(/[^A-Za-z0-9]/g, '')

  function subFieldConfig(owner: string, sf: Record<string, unknown>): { type: GraphQLOutputType; resolve?: any } | null {
    const cfg = (sf.config ?? {}) as { targetType?: string; many?: boolean; components?: unknown; fields?: unknown }
    const name = sf.name as string
    const ft = sf.fieldType as string
    if (ft === 'relation' && cfg.targetType && byName.has(cfg.targetType)) {
      return cfg.many === true
        ? { type: getConnectionType(cfg.targetType), resolve: r?.relationMany?.(owner, name, cfg.targetType) }
        : { type: getObjectType(cfg.targetType)!, resolve: r?.relationOne?.(owner, name, cfg.targetType) }
    }
    if (ft === 'component') {
      const list = getBlockListConfig(`${owner}${pascal(name)}`, cfg.components)
      if (list) return list
      return { type: GraphQLJSON }
    }
    if (ft === 'repeater') {
      const row = getRowType(`${owner}${pascal(name)}`, (cfg.fields ?? []) as Array<Record<string, unknown>>)
      return row ? { type: new GraphQLList(row) } : { type: GraphQLJSON }
    }
    if (ft === 'media') return { type: Media }   // the platform expands block media exactly like top-level media
    const scalar = scalarOutput(ft)
    return { type: scalar ?? GraphQLJSON }
  }

  function getBlockType(def: { name: string; label?: string; fields?: Array<Record<string, unknown>> }): GraphQLObjectType {
    const key = def.name
    if (blockTypes.has(key)) return blockTypes.get(key)!
    const t = new GraphQLObjectType({
      name: `Block${pascal(def.name)}`,
      description: (def as { label?: string }).label,
      fields: () => {
        const out: GraphQLFieldConfigMap<unknown, unknown> = {
          _key: { type: GraphQLString },
          _type: { type: GraphQLString },
          _label: { type: GraphQLString },
        }
        for (const sf of def.fields ?? []) {
          const conf = subFieldConfig(`Block${pascal(def.name)}`, sf)
          if (conf) out[sf.name as string] = conf
        }
        return out
      },
    })
    blockTypes.set(key, t)
    return t
  }

  function resolveBlockDefs(refs: unknown): Array<{ name: string; fields?: Array<Record<string, unknown>> }> {
    const out: Array<{ name: string; fields?: Array<Record<string, unknown>> }> = []
    for (const ref of (Array.isArray(refs) ? refs : []) as Array<string | { name?: string }>) {
      const def = typeof ref === 'string' ? registry.find((c) => c.name === ref) : ref
      if (def && typeof def.name === 'string') out.push(def as never)
    }
    return out
  }

  /** List(union of block types) + a resolver that drops unknown/legacy blocks. */
  function getBlockListConfig(unionBase: string, refs: unknown): { type: GraphQLOutputType; resolve: any } | null {
    const defs = resolveBlockDefs(refs)
    if (defs.length === 0) return null
    const knownNames = new Set(defs.map((d) => d.name))
    const union = defs.length === 1
      ? getBlockType(defs[0])
      : new GraphQLUnionType({
          name: `${unionBase}Block`,
          types: () => defs.map((d) => getBlockType(d)),
          resolveType: (value: unknown) => `Block${pascal(String((value as { _type?: string })?._type ?? ''))}`,
        })
    return {
      type: new GraphQLList(union),
      resolve: (parent: Record<string, unknown>, _a: unknown, _c: unknown, info: { fieldName: string }) => {
        const v = parent?.[info.fieldName]
        if (!Array.isArray(v)) return []
        // unknown block types can't join a union — drop them (legacy data)
        return v.filter((b) => knownNames.has(String((b as { _type?: string; type?: string })?._type ?? (b as { type?: string })?.type ?? '')))
      },
    }
  }

  function getRowType(base: string, fields: Array<Record<string, unknown>>): GraphQLObjectType | null {
    if (!fields.length) return null
    const key = base
    if (rowTypes.has(key)) return rowTypes.get(key)!
    const t = new GraphQLObjectType({
      name: `${base}Row`,
      fields: () => {
        const out: GraphQLFieldConfigMap<unknown, unknown> = { _key: { type: GraphQLString } }
        for (const sf of fields) {
          const conf = subFieldConfig(`${base}Row`, sf)
          if (conf) out[sf.name as string] = conf
        }
        return out
      },
    })
    rowTypes.set(key, t)
    return t
  }

  function fieldConfig(def: ObjectTypeDefinition, f: FieldDefinition): { type: GraphQLOutputType; resolve?: any } {
    const cfg = (f.config ?? {}) as { targetType?: string; many?: boolean; include?: string[] }
    if (f.fieldType === 'relation' && cfg.targetType && byName.has(cfg.targetType)) {
      if (cfg.many) {
        return {
          type: getConnectionType(cfg.targetType),
          resolve: r?.relationMany?.(def.name, f.name, cfg.targetType),
        }
      }
      return {
        type: getObjectType(cfg.targetType)!,
        resolve: r?.relationOne?.(def.name, f.name, cfg.targetType),
      }
    }
    if (f.fieldType === 'media') return { type: Media }
    if (f.fieldType === 'component') {
      const typed = getBlockListConfig(`${typeName(def.name)}${pascal(f.name)}`, (f.config as { components?: unknown })?.components)
      if (typed) return typed
      return { type: GraphQLJSON }   // no resolvable defs → raw blocks
    }
    if (f.fieldType === 'repeater') {
      const row = getRowType(`${typeName(def.name)}${pascal(f.name)}`, (((f.config as { fields?: unknown })?.fields) ?? []) as Array<Record<string, unknown>>)
      if (row) return { type: new GraphQLList(row) }
      return { type: GraphQLJSON }
    }
    if (f.fieldType === 'object') {
      const members = (cfg.include ?? []).filter((n) => byName.has(n))
      if (members.length > 0) {
        const union = getObjectUnion(def.name, f.name, members)
        return {
          type: cfg.many === true ? new GraphQLList(union) : union,
          resolve: r?.objectRef?.(def.name, f.name),
        }
      }
      return { type: GraphQLJSON }   // no resolvable include types → raw refs
    }
    const scalar = scalarOutput(f.fieldType)
    return { type: scalar ?? GraphQLJSON }
  }

  // ── WhereInput + OrderBy per type ─────────────────────────────────────────
  const getWhereInput = (name: string): GraphQLInputObjectType => {
    if (whereInputs.has(name)) return whereInputs.get(name)!
    const def = byName.get(name)!
    const input = new GraphQLInputObjectType({
      name: whereInputName(name),
      fields: () => {
        const fields: GraphQLInputFieldConfigMap = {
          id: { type: fieldFilterInput('id', GraphQLID) },
          status: { type: fieldFilterInput('status', GraphQLString) },
          slug: { type: fieldFilterInput('slug', GraphQLString) },
          _and: { type: new GraphQLList(new GraphQLNonNull(input)) },
          _or: { type: new GraphQLList(new GraphQLNonNull(input)) },
        }
        for (const f of def.fields ?? []) {
          if (f.fieldType === 'relation' || f.fieldType === 'media' || f.fieldType === 'json') continue
          fields[f.name] = { type: fieldFilterInput(f.name, filterScalarInput(f.fieldType)) }
        }
        return fields
      },
    })
    whereInputs.set(name, input)
    return input
  }

  const filterInputCache = new Map<string, GraphQLInputObjectType>()
  function fieldFilterInput(key: string, scalar: GraphQLInputType): GraphQLInputObjectType {
    const cacheKey = (scalar as { name?: string }).name ?? key
    if (filterInputCache.has(cacheKey)) return filterInputCache.get(cacheKey)!
    const input = new GraphQLInputObjectType({
      name: `${(scalar as { name?: string }).name ?? 'String'}Filter`,
      fields: {
        eq: { type: scalar }, ne: { type: scalar },
        gt: { type: scalar }, lt: { type: scalar }, gte: { type: scalar }, lte: { type: scalar },
        in: { type: new GraphQLList(new GraphQLNonNull(scalar as import('graphql').GraphQLNullableInputType)) as GraphQLInputType },
        contains: { type: scalar },
      },
    })
    filterInputCache.set(cacheKey, input)
    return input
  }

  const getOrderByInput = (name: string): GraphQLInputObjectType => {
    if (orderByInputs.has(name)) return orderByInputs.get(name)!
    const input = new GraphQLInputObjectType({
      name: orderByName(name),
      fields: { field: { type: new GraphQLNonNull(GraphQLString) }, direction: { type: GraphQLString } },
    })
    orderByInputs.set(name, input)
    return input
  }

  // ── Root query ────────────────────────────────────────────────────────────
  // ── Publish cascade plan types ───────────────────────────────────────────
  const PublishPlanNode = new GraphQLObjectType({
    name: 'PublishPlanNode',
    fields: {
      typeName: { type: new GraphQLNonNull(GraphQLString) },
      typeLabel: { type: new GraphQLNonNull(GraphQLString) },
      id: { type: new GraphQLNonNull(GraphQLID) },
      title: { type: new GraphQLNonNull(GraphQLString) },
      status: { type: new GraphQLNonNull(GraphQLString) },
      reason: { type: GraphQLString },
    },
  })
  const PublishPlan = new GraphQLObjectType({
    name: 'PublishPlan',
    fields: {
      needsCascade: { type: new GraphQLNonNull(GraphQLBoolean) },
      dependencies: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(PublishPlanNode))) },
      blockers: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(PublishPlanNode))) },
    },
  })

  const queryFields: GraphQLFieldConfigMap<unknown, unknown> = {}
  for (const def of types) {
    const listArgs: GraphQLFieldConfigArgumentMap = {
      where: { type: getWhereInput(def.name) },
      orderBy: { type: getOrderByInput(def.name) },
      limit: { type: GraphQLInt },
      offset: { type: GraphQLInt },
      after: { type: GraphQLString },
      locale: { type: GraphQLString },
      /** 'published' (default — the snapshot frozen at publish), 'draft', or 'any'. */
      status: { type: GraphQLString },
    }
    queryFields[listQueryNameFor(def.name, (def as { plural?: string | null }).plural)] = {
      type: new GraphQLNonNull(getConnectionType(def.name)),
      args: listArgs,
      resolve: r?.list?.(def.name),
    }
    queryFields[singleQueryName(def.name)] = {
      type: getObjectType(def.name)!,
      args: { id: { type: GraphQLID }, slug: { type: GraphQLString }, locale: { type: GraphQLString }, status: { type: GraphQLString } },
      resolve: r?.single?.(def.name),
    }
    // Publish preflight — the cascade plan (dependencies + blockers), no writes.
    queryFields[`preflight${typeName(def.name)}`] = {
      type: PublishPlan,
      args: { id: { type: new GraphQLNonNull(GraphQLID) } },
      resolve: r?.preflight?.(def.name),
    }
  }
  // ── Custom tables → table_<name> queries ─────────────────────────────────
  for (const table of opts.customTables ?? []) {
    const rowTypeName = `${typeName(table.name)}Row`
    const rowType = new GraphQLObjectType({
      name: rowTypeName,
      fields: () => {
        const f: GraphQLFieldConfigMap<unknown, unknown> = { id: { type: new GraphQLNonNull(GraphQLID) } }
        for (const [col, def] of Object.entries(table.columns ?? {})) {
          f[col] = { type: tableColumnType(def.type) }
        }
        return f
      },
    })
    const rowConn = new GraphQLObjectType({
      name: `${typeName(table.name)}RowConnection`,
      fields: () => ({
        data: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(rowType))) },
        meta: { type: new GraphQLNonNull(QueryMeta) },
      }),
    })
    queryFields[`table_${table.name}`] = {
      type: new GraphQLNonNull(rowConn),
      args: { where: { type: GraphQLJSON }, orderBy: { type: TableOrderBy }, limit: { type: GraphQLInt }, offset: { type: GraphQLInt } },
      resolve: r?.table?.(table.name),
    }
  }

  // ── Globals → global(name): JSON ──────────────────────────────────────────
  if ((opts.globalNames ?? []).length > 0) {
    queryFields.global = {
      type: GraphQLJSON,
      args: { name: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: r?.global?.(),
    }
  }

  // Ensure at least one field exists (empty schema still builds)
  if (Object.keys(queryFields).length === 0) {
    queryFields._empty = { type: GraphQLString, resolve: () => null }
  }

  // ── Mutations (optional) ──────────────────────────────────────────────────
  let mutationType: GraphQLObjectType | undefined
  if (opts.mutations && types.length > 0) {
    const inputTypes = new Map<string, GraphQLInputObjectType>()
    const getInputType = (name: string): GraphQLInputObjectType => {
      if (inputTypes.has(name)) return inputTypes.get(name)!
      const def = byName.get(name)!
      const input = new GraphQLInputObjectType({
        name: `${typeName(name)}Input`,
        fields: () => {
          const f: GraphQLInputFieldConfigMap = {
            title: { type: GraphQLString },
            slug: { type: GraphQLString },
          }
          for (const fd of def.fields ?? []) {
            const cfg = (fd.config ?? {}) as { targetType?: string; many?: boolean }
            if (fd.fieldType === 'relation') {
              f[fd.name] = { type: cfg.many ? new GraphQLList(new GraphQLNonNull(GraphQLID)) : GraphQLID }
            } else if (fd.fieldType === 'media') {
              f[fd.name] = { type: GraphQLID }
            } else {
              f[fd.name] = { type: (filterScalarInput(fd.fieldType) as GraphQLInputType) === GraphQLFloat ? GraphQLFloat : (fd.fieldType === 'boolean' ? GraphQLBoolean : GraphQLString) }
            }
          }
          return f
        },
      })
      inputTypes.set(name, input)
      return input
    }

    const DeleteResult = new GraphQLObjectType({
      name: 'DeleteResult',
      fields: { id: { type: new GraphQLNonNull(GraphQLID) }, deleted: { type: GraphQLBoolean } },
    })

    const mutationFields: GraphQLFieldConfigMap<unknown, unknown> = {}
    for (const def of types) {
      const T = typeName(def.name)
      const objType = getObjectType(def.name)!
      mutationFields[`create${T}`] = {
        type: objType,
        args: { input: { type: new GraphQLNonNull(getInputType(def.name)) } },
        resolve: r?.create?.(def.name),
      }
      mutationFields[`update${T}`] = {
        type: objType,
        args: { id: { type: new GraphQLNonNull(GraphQLID) }, input: { type: new GraphQLNonNull(getInputType(def.name)) } },
        resolve: r?.update?.(def.name),
      }
      mutationFields[`publish${T}`] = {
        type: objType,
        args: { id: { type: new GraphQLNonNull(GraphQLID) }, cascade: { type: GraphQLBoolean } },
        resolve: r?.publish?.(def.name),
      }
      mutationFields[`unpublish${T}`] = {
        type: objType, args: { id: { type: new GraphQLNonNull(GraphQLID) } }, resolve: r?.unpublish?.(def.name),
      }
      mutationFields[`delete${T}`] = {
        type: DeleteResult, args: { id: { type: new GraphQLNonNull(GraphQLID) } }, resolve: r?.remove?.(def.name),
      }
    }
    mutationType = new GraphQLObjectType({ name: 'Mutation', fields: mutationFields })
  }

  return new GraphQLSchema({
    query: new GraphQLObjectType({ name: 'Query', fields: queryFields }),
    ...(mutationType ? { mutation: mutationType } : {}),
    // Realtime R5: the Subscription root over the realtime envelopes, only when asked for.
    ...(opts.subscriptions ? { subscription: buildSubscriptionType(types, { JSON: GraphQLJSON, DateTime: GraphQLDateTime }) } : {}),
    types: [Media, QueryMeta, GraphQLJSON, GraphQLDateTime],
  })
}
