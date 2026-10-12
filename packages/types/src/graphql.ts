/**
 * File Name: graphql.ts
 * Purpose: GraphQL API configuration types. The GraphQL endpoint is OFF by
 *          default; enabling it requires the optional @tangen/graphql
 *          package. The schema is GENERATED per workspace×env from the
 *          content SchemaDefinition — there is nothing to author here
 *          beyond the switches.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Consumed by the API's /api/v1/graphql mount and the
 *          optional @tangen/graphql package (schema builder + resolvers).
 */

export interface GraphqlConfig {
  /** Master switch — the endpoint 404s when false/absent. */
  enabled: boolean
  /**
   * Serve the GraphiQL explorer at GET /api/v1/graphql (dev convenience).
   * Defaults to true in development, false otherwise.
   */
  graphiql?: boolean
  /**
   * Allow schema introspection. Defaults to true; set false to lock down a
   * production endpoint (clients must then know the schema out of band).
   */
  introspection?: boolean
  /**
   * Max query depth accepted (guards against pathologically nested
   * queries). Omit for the built-in default.
   */
  maxDepth?: number
  /**
   * Expose create/update/publish/unpublish/delete mutations. OFF by
   * default — enabling makes GraphQL a write surface (still gated by each
   * caller's object write grant). Read-only when false/absent.
   */
  mutations?: boolean
}

/** Identity builder for app/config/graphql.ts. */
export function defineGraphqlConfig(config: GraphqlConfig): GraphqlConfig {
  return config
}
