/**
 * File Name: subscriptions.ts
 * Purpose: The generated Subscription type - one `<type>Changed(id)` field per
 *          content type plus the generic `objectsChanged(type, id)` - and the
 *          helpers a transport needs to run one: the topic a field maps to,
 *          and a parse-validate step that admits subscription operations
 *          only.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Realtime R5 of tasks/plan-realtime.md, built to
 *          tasks/realtime-client-architecture.md sections 14 and 56.9:
 *          realtime signals, it does not replicate, and REST/GraphQL stay
 *          the canonical data API. A subscription therefore yields the SAME
 *          envelope the realtime client receives on `objects:<type>` or
 *          `object:<id>` - ids, the type slug, the changed field names, the
 *          actor - and never the document; the page refetches through a
 *          query. Pure: the builder knows nothing about sockets. The
 *          `subscribe` resolver reads a `RealtimeSubscriber` off the request
 *          context, which only the WebSocket adapter installs
 *          (packages/api/src/realtime/graphql-ws.ts); over POST the field
 *          answers an error naming the socket, so there is one realtime
 *          transport and GraphQL is an adapter over it. Authorization is the
 *          hub's (the subscriber refuses a topic the identity may not hold);
 *          the `canRead` check here only makes the refusal read like a
 *          query's.
 */
import {
  GraphQLObjectType, GraphQLNonNull, GraphQLList, GraphQLID, GraphQLString, GraphQLError,
  parse, validate, getOperationAST, specifiedRules,
  type GraphQLSchema, type DocumentNode, type GraphQLScalarType, type GraphQLFieldConfigMap,
} from 'graphql'
import { singleQueryName } from './naming'

/** The realtime envelope as a transport hands it over: what `{ op: 'event' }` carries. */
export interface RealtimeEventLike {
  id: string
  ch: string
  topic: string
  t: number
  type: string
  data: Record<string, unknown>
}

/**
 * What a subscription resolver needs of the realtime layer: one topic in,
 * the envelopes out, ending when the connection does. A refused topic
 * rejects the first `next()` with an Error whose message is the reason.
 */
export interface RealtimeSubscriber {
  subscribe(topic: string): AsyncIterable<RealtimeEventLike>
}

/** What the subscribe resolvers read off the contextValue. */
interface SubscriptionContext {
  canRead: (typeName: string) => boolean
  realtime?: RealtimeSubscriber
}

/**
 * The topic a subscription field listens on: the one object when an id is
 * given, else every object of the type. The same strings the REST client
 * subscribes with, so both hear one publish.
 */
export function subscriptionTopic(args: { type: string; id?: string | null }): string {
  return args.id ? `object:${args.id}` : `objects:${args.type}`
}

/**
 * Filters a source of envelopes down to one type slug. Hand-rolled rather
 * than an async generator on purpose: a generator suspended in `for await`
 * queues `return()` behind the pending `next()`, so a client's `complete`
 * would not release the hub subscription until the next event arrived.
 * This iterator forwards `return()` to the source at once.
 */
function ofType(source: AsyncIterable<RealtimeEventLike>, typeSlug: string): AsyncIterable<RealtimeEventLike> {
  return {
    [Symbol.asyncIterator]() {
      const inner = source[Symbol.asyncIterator]()
      const done = (): Promise<IteratorResult<RealtimeEventLike>> => Promise.resolve({ value: undefined as never, done: true })
      return {
        async next() {
          for (;;) {
            const r = await inner.next()
            if (r.done || r.value.data.typeSlug === typeSlug) return r
          }
        },
        return() { return inner.return ? inner.return() : done() },
        throw(e?: unknown) { return inner.throw ? inner.throw(e) : Promise.reject(e) },
      }
    },
  }
}

function subscribeTo(typeSlug: string, id: string | null | undefined, ctx: SubscriptionContext): AsyncIterable<RealtimeEventLike> {
  if (!ctx.canRead(typeSlug)) {
    throw new GraphQLError(`You do not have permission to read '${typeSlug}'`, { extensions: { code: 'FORBIDDEN' } })
  }
  if (!ctx.realtime) {
    throw new GraphQLError(
      'Subscriptions run over the realtime WebSocket: open GET /api/v1/realtime?ticket=<ticket> with the graphql-transport-ws subprotocol',
      { extensions: { code: 'SUBSCRIPTIONS_NEED_WEBSOCKET' } },
    )
  }
  return ofType(ctx.realtime.subscribe(subscriptionTopic({ type: typeSlug, id })), typeSlug)
}

/**
 * Builds the Subscription root for the given content types.
 * @param types - The content types in the schema (disabled ones already dropped).
 * @param scalars - The JSON and DateTime scalars the schema already registers.
 */
export function buildSubscriptionType(
  types: Array<{ name: string }>,
  scalars: { JSON: GraphQLScalarType; DateTime: GraphQLScalarType },
): GraphQLObjectType {
  const ObjectEvent = new GraphQLObjectType({
    name: 'ObjectEvent',
    description: 'A realtime envelope: what changed, never the document. Refetch through a query.',
    fields: {
      id: { type: new GraphQLNonNull(GraphQLID), description: 'Per-channel monotonic event id (the realtime cursor).' },
      topic: { type: new GraphQLNonNull(GraphQLString) },
      type: { type: new GraphQLNonNull(GraphQLString), description: 'object.created | object.updated | object.published | object.unpublished | object.deleted | object.scheduled | publish.started | publish.completed | publish.failed' },
      t: { type: new GraphQLNonNull(scalars.DateTime), resolve: (e: RealtimeEventLike) => new Date(e.t) },
      objectId: { type: new GraphQLNonNull(GraphQLID), resolve: (e: RealtimeEventLike) => String(e.data.objectId ?? '') },
      typeSlug: { type: new GraphQLNonNull(GraphQLString), resolve: (e: RealtimeEventLike) => String(e.data.typeSlug ?? '') },
      changedFields: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)), resolve: (e: RealtimeEventLike) => Array.isArray(e.data.changedFields) ? e.data.changedFields : null },
      actorId: { type: GraphQLID, resolve: (e: RealtimeEventLike) => (typeof e.data.actorId === 'string' ? e.data.actorId : null) },
      actorName: { type: GraphQLString, resolve: (e: RealtimeEventLike) => (typeof e.data.actorName === 'string' ? e.data.actorName : null) },
      data: { type: new GraphQLNonNull(scalars.JSON), description: 'The whole envelope data, as the realtime client sees it.' },
    },
  })

  const fields: GraphQLFieldConfigMap<RealtimeEventLike, SubscriptionContext> = {
    objectsChanged: {
      type: new GraphQLNonNull(ObjectEvent),
      description: 'Every object of a type (objects:<type>), or one object of it when id is given (object:<id>).',
      args: { type: { type: new GraphQLNonNull(GraphQLString) }, id: { type: GraphQLID } },
      subscribe: (_root, args: { type: string; id?: string | null }, ctx) => subscribeTo(args.type, args.id, ctx),
      resolve: (event: RealtimeEventLike) => event,
    },
  }
  for (const def of types) {
    fields[`${singleQueryName(def.name)}Changed`] = {
      type: new GraphQLNonNull(ObjectEvent),
      description: `Changes to ${def.name} objects: objects:${def.name}, or object:<id> when id is given.`,
      args: { id: { type: GraphQLID } },
      subscribe: (_root, args: { id?: string | null }, ctx) => subscribeTo(def.name, args.id, ctx),
      resolve: (event: RealtimeEventLike) => event,
    }
  }
  return new GraphQLObjectType({ name: 'Subscription', fields })
}

export type PreparedSubscription =
  | { ok: true; document: DocumentNode }
  | { ok: false; errors: GraphQLError[] }

/**
 * Parses and validates one document for the socket: only a subscription
 * operation is admitted there, because queries and mutations belong to the
 * HTTP mount with its depth ceiling and access log. Never throws.
 * @param schema - The generated schema with its Subscription type.
 * @param source - The document text.
 * @param operationName - Which operation, when the document holds several.
 */
export function prepareSubscription(schema: GraphQLSchema, source: string, operationName?: string | null): PreparedSubscription {
  let document: DocumentNode
  try {
    document = parse(source)
  } catch (e) {
    return { ok: false, errors: [e as GraphQLError] }
  }
  const errors = validate(schema, document, specifiedRules)
  if (errors.length > 0) return { ok: false, errors: [...errors] }
  const operation = getOperationAST(document, operationName ?? undefined)
  if (!operation) {
    return { ok: false, errors: [new GraphQLError(operationName ? `Unknown operation "${operationName}"` : 'The document must contain exactly one operation, or name the one to run')] }
  }
  if (operation.operation !== 'subscription') {
    return { ok: false, errors: [new GraphQLError('Only subscription operations run over the realtime socket; send queries and mutations to POST /api/v1/graphql', { extensions: { code: 'NOT_A_SUBSCRIPTION' } })] }
  }
  return { ok: true, document }
}
