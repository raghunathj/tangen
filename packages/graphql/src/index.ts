/**
 * File Name: index.ts
 * Purpose: @tangen/graphql — the GraphQL API for Tangen CMS as an
 *          independent, optionally-installed package. The GraphQL schema is
 *          GENERATED from the content SchemaDefinition (G1+); this entry
 *          exposes config resolution, the execute helper, and (for G0) a
 *          minimal ping schema so the API mount is real before generation
 *          lands.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends only on @tangen/types + graphql.
 */
import {
  parse, validate, execute, getOperationAST, GraphQLError,
  GraphQLSchema, GraphQLObjectType, GraphQLString,
  NoSchemaIntrospectionCustomRule, specifiedRules,
  type ExecutionResult, type GraphQLFieldResolver, type ValidationRule,
} from 'graphql'
import { createMaxDepthRule } from './depth-limit'

export { resolveGraphqlConfig, type ResolvedGraphqlConfig } from './config'
export { createMaxDepthRule, measureQueryDepth } from './depth-limit'
export { buildContentSchema, type BuildSchemaOptions } from './schema-builder'
export { GraphQLJSON, GraphQLDateTime } from './scalars'
export { createResolvers, createRequestContext, type ResolverHooks, type GraphqlRequestContext } from './resolvers'
export { whereToFilter } from './filter'
export { canReadType, canWriteType, canReadDraftsType, canPublishTypeObjects } from './permissions'
export { createBatchLoaders, type BatchLoaders } from './loaders'
export { graphiqlHTML } from './graphiql'
// Realtime R5: the Subscription type and what a socket adapter needs to run one.
export {
  buildSubscriptionType, subscriptionTopic, prepareSubscription,
  type RealtimeSubscriber, type RealtimeEventLike, type PreparedSubscription,
} from './subscriptions'
export { subscribe as subscribeGraphql, type ExecutionResult as GraphqlExecutionResult } from 'graphql'
export { printSchema as printSchemaSDL } from 'graphql'
export * as naming from './naming'

export interface ExecuteGraphqlArgs {
  schema: GraphQLSchema
  source: string
  variableValues?: Record<string, unknown> | null
  operationName?: string | null
  contextValue?: unknown
  rootValue?: unknown
  /** When false, __schema/__type queries are rejected (production lockdown). */
  introspection?: boolean
  /**
   * Deepest selection-set nesting allowed. Omit (or pass < 1) to keep the
   * pre-CF-2 contract of no depth limit at all; the API mount always passes
   * the resolved `graphql.maxDepth`.
   */
  maxDepth?: number
}

/**
 * Runs one operation. Never throws for query-level problems — parse,
 * validation, and resolver errors all come back in `errors` so the HTTP
 * mount can return a 200 GraphQL envelope (the GraphQL convention). With
 * `introspection: false`, introspection queries are refused at validation.
 * A subscription operation is refused here by name (Realtime R5): it runs
 * over the realtime WebSocket, never over a request.
 */
export async function executeGraphql(args: ExecuteGraphqlArgs): Promise<ExecutionResult> {
  const depthLimited = typeof args.maxDepth === 'number' && args.maxDepth >= 1
  // parse → validate with the rules → execute; the same steps graphql()
  // takes, spelled out so extra validation rules and the operation check fit.
  let document
  try {
    document = parse(args.source)
  } catch (e) {
    return { errors: [e as GraphQLError] }
  }
  if (getOperationAST(document, args.operationName ?? undefined)?.operation === 'subscription') {
    return { errors: [new GraphQLError(
      'Subscriptions run over the realtime WebSocket: open GET /api/v1/realtime?ticket=<ticket> with the graphql-transport-ws subprotocol',
      { extensions: { code: 'SUBSCRIPTIONS_NEED_WEBSOCKET' } },
    )] }
  }
  const rules: ValidationRule[] = [...specifiedRules]
  if (args.introspection === false) rules.push(NoSchemaIntrospectionCustomRule)
  if (depthLimited) rules.push(createMaxDepthRule(args.maxDepth as number))
  const validationErrors = validate(args.schema, document, rules)
  if (validationErrors.length > 0) return { errors: validationErrors }
  return execute({
    schema: args.schema,
    document,
    variableValues: args.variableValues ?? undefined,
    operationName: args.operationName ?? undefined,
    contextValue: args.contextValue,
    rootValue: args.rootValue,
  })
}

/**
 * A trivial schema (`{ ping }`) — the G0 placeholder that proves the mount
 * end to end before the generated schema (G1) replaces it.
 */
export function pingSchema(): GraphQLSchema {
  const resolvePing: GraphQLFieldResolver<unknown, unknown> = () => 'pong'
  return new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: { ping: { type: GraphQLString, resolve: resolvePing } },
    }),
  })
}
export { applyGraphqlContributions, type GraphqlContribution, type GraphqlExtensionContext } from './extensions'
