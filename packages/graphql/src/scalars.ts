/**
 * File Name: scalars.ts
 * Purpose: Custom GraphQL scalars for content field types the built-ins
 *          don't cover — JSON (repeaters, components, groups, arbitrary
 *          blobs), DateTime (ISO strings), and Media (a thin object type is
 *          built in the schema-builder; the scalar here is the fallback).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { GraphQLScalarType, Kind, type ValueNode } from 'graphql'

/** Passes JSON-serializable values straight through (no transform). */
export const GraphQLJSON = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value (objects, arrays, or scalars).',
  serialize: (v) => v,
  parseValue: (v) => v,
  parseLiteral: function parseLiteral(ast: ValueNode): unknown {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value
      case Kind.INT:
      case Kind.FLOAT:
        return Number(ast.value)
      case Kind.NULL:
        return null
      case Kind.LIST:
        return ast.values.map(parseLiteral)
      case Kind.OBJECT:
        return Object.fromEntries(ast.fields.map((f) => [f.name.value, parseLiteral(f.value)]))
      default:
        return null
    }
  },
})

/** ISO-8601 timestamps, carried as strings. */
export const GraphQLDateTime = new GraphQLScalarType({
  name: 'DateTime',
  description: 'An ISO-8601 date-time string.',
  serialize: (v) => (v instanceof Date ? v.toISOString() : v),
  parseValue: (v) => v,
  parseLiteral: (ast) => (ast.kind === Kind.STRING ? ast.value : null),
})
