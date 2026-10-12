/**
 * File Name: extensions.ts
 * Purpose: `graphql.types@1` (Extension Kernel K8.4,
 *          tasks/plan-extension-kernel.md; plan-framework-extensibility §33).
 *          An extension extends the generated schema with SDL - its own
 *          types, fields on Query and Mutation, computed fields on content
 *          types - and supplies resolvers for exactly what it added. A
 *          resolver runs with the extension's ctx the request hands over
 *          (`context.extensionCtx(id)`: the API binds it to the caller's
 *          execution, so access is the caller's ∩ the extension's grants),
 *          never with raw access. A contribution that fails - SDL that does
 *          not parse, a type core already defines, a resolver for a field
 *          the extension did not add - is dropped with a warning and the
 *          schema keeps serving without it.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { extendSchema, parse, isObjectType, GraphQLError, type GraphQLSchema, type GraphQLFieldResolver } from 'graphql'

export interface GraphqlContribution {
  extensionId: string
  /** SDL: new types, `extend type Query { ... }`, `extend type Mutation { ... }`, `extend type <ContentType> { ... }`. */
  sdl: string
  /** Resolvers for the fields the SDL added, by type then field; each receives `context.ctx`, the extension's ctx. */
  resolvers?: Record<string, Record<string, GraphQLFieldResolver<unknown, GraphqlExtensionContext>>>
}

/** What a contributed resolver sees: the request context plus the extension's own ctx under `ctx`. */
export interface GraphqlExtensionContext {
  /** Present on a request the API built: the extension's ctx bound to the caller; null when the extension cannot run for this caller. */
  extensionCtx?: (extensionId: string) => Promise<unknown | null>
  ctx: unknown
  [key: string]: unknown
}

export interface ApplyGraphqlContributionsOptions {
  warn?: (message: string) => void
}

/** The (type, field) pairs a schema has, so a contribution's additions can be told apart from what was already there. */
function fieldSet(schema: GraphQLSchema): Set<string> {
  const out = new Set<string>()
  for (const type of Object.values(schema.getTypeMap())) {
    if (!isObjectType(type) || type.name.startsWith('__')) continue
    for (const field of Object.keys(type.getFields())) out.add(`${type.name}.${field}`)
  }
  return out
}

/** Wraps a contributed resolver so it runs with the extension's ctx, and fails its own field alone when the request cannot supply one. */
function wrap(extensionId: string, fn: GraphQLFieldResolver<unknown, GraphqlExtensionContext>): GraphQLFieldResolver<unknown, GraphqlExtensionContext> {
  return async (source, args, context, info) => {
    const ctx = typeof context?.extensionCtx === 'function' ? await context.extensionCtx(extensionId) : null
    if (!ctx) throw new GraphQLError(`Extension '${extensionId}' cannot serve '${info.parentType.name}.${info.fieldName}' for this request`, { extensions: { code: 'FORBIDDEN' } })
    return fn(source, args, { ...context, ctx }, info)
  }
}

export function applyGraphqlContributions(schema: GraphQLSchema, items: readonly GraphqlContribution[], opts: ApplyGraphqlContributionsOptions = {}): GraphQLSchema {
  if (items.length === 0) return schema
  const warn = opts.warn ?? (() => {})
  let current = schema
  for (const item of items) {
    const before = fieldSet(current)
    let extended: GraphQLSchema
    try {
      extended = extendSchema(current, parse(item.sdl), { assumeValidSDL: false })
    } catch (e) {
      warn(`graphql.types@1 from extension "${item.extensionId}" dropped: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    const added = fieldSet(extended)
    let ok = true
    // Resolvers only for what THIS contribution added: a core field or another extension's stays whose it was.
    for (const [typeName, fields] of Object.entries(item.resolvers ?? {})) {
      const type = extended.getType(typeName)
      if (!type || !isObjectType(type)) { warn(`graphql.types@1 from extension "${item.extensionId}": resolvers for unknown type '${typeName}' ignored`); continue }
      const typeFields = type.getFields()
      for (const [fieldName, fn] of Object.entries(fields)) {
        const key = `${typeName}.${fieldName}`
        if (before.has(key) || !added.has(key)) { warn(`graphql.types@1 from extension "${item.extensionId}": resolver for '${key}' ignored - not a field this extension added`); continue }
        if (typeof fn !== 'function') { warn(`graphql.types@1 from extension "${item.extensionId}": resolver for '${key}' is not a function`); continue }
        typeFields[fieldName]!.resolve = wrap(item.extensionId, fn)
      }
    }
    if (ok) current = extended
  }
  return current
}
