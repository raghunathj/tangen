/**
 * File Name: naming.ts
 * Purpose: GraphQL name derivation for the builder and resolvers. The rules now
 *          live in @tangen/types/graphql-naming so push-time collision checks
 *          (@tangen/schema) and the actual schema build agree on every name;
 *          this module just re-exports them for the graphql package's callers.
 *
 * Author: Raghunath J
 * License: MIT
 */
export {
  pascal,
  pluralize,
  singularize,
  typeName,
  singleQueryName,
  listQueryName,
  listQueryNameFor,
  connectionName,
  whereInputName,
  orderByName,
} from '@tangen/types'
