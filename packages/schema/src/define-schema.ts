/**
 * File Name: define-schema.ts
 * Purpose: Exports defineSchema — validates that a collection of object type definitions has no duplicate names and returns a typed SchemaDefinition.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on @tangen/types for SchemaDefinition and ObjectTypeDefinition.
 */
import type { SchemaDefinition, ObjectTypeDefinition } from "@tangen/types";
import { findTypeNameCollisions } from "./type-name-collisions";

/**
 * Validates a schema definition and returns it as a typed SchemaDefinition.
 * Rejects (a) exact duplicate type names, and (b) two names that collapse to the
 * same GraphQL object type — the singular/plural clash, e.g. `product` +
 * `products` both → `Product` (GraphQL type names are singular). Caught here so
 * it fails at load / `tangen push`, not later at GraphQL schema build.
 * @param def - Object containing an array of ObjectTypeDefinition entries
 * @returns The validated SchemaDefinition
 */
export function defineSchema(def: {
  types: ObjectTypeDefinition[];
}): SchemaDefinition {
  const seen = new Set<string>();
  for (const t of def.types) {
    if (seen.has(t.name)) {
      throw new Error(`Duplicate type name "${t.name}" in schema`);
    }
    seen.add(t.name);
  }
  const [collision] = findTypeNameCollisions(def.types);
  if (collision) {
    const names = collision.names.map((n) => `"${n}"`).join(" and ");
    throw new Error(
      `Type names ${names} both map to the GraphQL type "${collision.graphqlType}" - ` +
        `content-type names must stay distinct after singular/plural normalization ` +
        `(GraphQL object types are singular). Rename one of them.`,
    );
  }
  return def;
}
