/**
 * File Name: type-name-collisions.ts
 * Purpose: Detect content-type names that collapse to the SAME GraphQL object
 *          type — the singular/plural clash (`product` + `products` both →
 *          `Product`). GraphQL type names are singular (see @tangen/types
 *          graphql-naming), so such a pair would collide at schema build; we
 *          surface it up front (defineSchema + `tangen push`) with a rename hint.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { typeName } from '@tangen/types'

export interface TypeNameCollision {
  /** The single GraphQL object type both names would generate. */
  graphqlType: string
  /** The colliding content-type names (2+). */
  names: string[]
}

/**
 * Group content-type names by the GraphQL type they'd produce and return any
 * group with more than one name. `typeName` is the exact key the GraphQL schema
 * builder uses, so a clash here is a clash there.
 */
export function findTypeNameCollisions(types: Array<{ name: string }>): TypeNameCollision[] {
  const byKey = new Map<string, string[]>()
  for (const t of types) {
    const key = typeName(t.name)
    const arr = byKey.get(key)
    if (arr) arr.push(t.name)
    else byKey.set(key, [t.name])
  }
  const out: TypeNameCollision[] = []
  for (const [graphqlType, names] of byKey) {
    if (names.length > 1) out.push({ graphqlType, names })
  }
  return out
}
