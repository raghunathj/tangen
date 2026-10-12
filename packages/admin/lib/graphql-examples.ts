/**
 * File Name: graphql-examples.ts
 * Purpose: Schema-driven GraphQL starter queries — for every root Query field,
 *          generate a runnable operation with required args as variables
 *          (sample values included) and a sensible scalar selection set. The
 *          on-ramp for people who don't know GraphQL yet.
 *
 * Author: Raghunath J
 * License: MIT
 */
import {
  GraphQLSchema, GraphQLObjectType, getNamedType, isLeafType, isObjectType,
  isNonNullType, type GraphQLField, type GraphQLArgument,
} from 'graphql'

export interface GraphqlExample {
  /** Root field name, e.g. "posts" / "post" / "global". */
  name: string
  label: string
  query: string
  /** JSON text for the variables pane ('{}' when none). */
  variables: string
}

function sampleForArg(arg: GraphQLArgument): unknown {
  const named = getNamedType(arg.type)
  switch (named.name) {
    case 'ID': return arg.name.toLowerCase().includes('id') ? '{{id}}' : 'abc'
    case 'String': return arg.name === 'slug' ? 'hello-world' : arg.name === 'locale' ? 'en' : arg.name === 'status' ? 'published' : 'sample'
    case 'Int': return arg.name === 'limit' ? 10 : arg.name === 'offset' ? 0 : 1
    case 'Float': return 1.5
    case 'Boolean': return true
    default: return null   // input objects (where etc.) - omitted unless required
  }
}

/** Scalar-ish selection set, one nested hop for list wrappers (nodes/items/data). */
function selectionFor(type: unknown, depth: number): string[] {
  if (!isObjectType(type)) return []
  const fields = Object.values((type as GraphQLObjectType).getFields())
  const out: string[] = []
  for (const f of fields) {
    if (out.length >= 8) break
    const named = getNamedType(f.type)
    if (isLeafType(named)) {
      if (f.args.some((a) => isNonNullType(a.type))) continue   // skip fields demanding args
      out.push(f.name)
    } else if (depth > 0 && isObjectType(named) && ['nodes', 'items', 'data', 'edges'].includes(f.name)) {
      const inner = selectionFor(named, 0)
      if (inner.length) out.push(`${f.name} { ${inner.join(' ')} }`)
    }
  }
  return out.length ? out : ['__typename']
}

/** One example per root Query field, alphabetical, capped. */
export function buildGraphqlExamples(schema: GraphQLSchema, cap = 40): GraphqlExample[] {
  const queryType = schema.getQueryType()
  if (!queryType) return []
  const out: GraphqlExample[] = []
  const fields = Object.values(queryType.getFields()).sort((a, b) => a.name.localeCompare(b.name))
  for (const field of fields.slice(0, cap)) {
    out.push(exampleFor(field))
  }
  return out
}

function exampleFor(field: GraphQLField<unknown, unknown>): GraphqlExample {
  // Required args become variables; optional scalar id/slug/limit args included too
  const varDefs: string[] = []
  const argUses: string[] = []
  const varValues: Record<string, unknown> = {}
  for (const arg of field.args) {
    const required = isNonNullType(arg.type)
    const interesting = ['id', 'slug', 'limit', 'locale', 'status'].includes(arg.name)
    if (!required && !interesting) continue
    const sample = sampleForArg(arg)
    if (sample === null && !required) continue
    varDefs.push(`$${arg.name}: ${String(arg.type)}`)
    argUses.push(`${arg.name}: $${arg.name}`)
    varValues[arg.name] = sample
  }
  const named = getNamedType(field.type)
  const selection = selectionFor(named, 1)
  const head = varDefs.length ? `query ${opName(field.name)}(${varDefs.join(', ')})` : `query ${opName(field.name)}`
  const call = argUses.length ? `${field.name}(${argUses.join(', ')})` : field.name
  const body = isLeafType(named)
    ? `  ${call}`
    : `  ${call} {\n    ${selection.join('\n    ')}\n  }`
  return {
    name: field.name,
    label: field.name,
    query: `${head} {\n${body}\n}\n`,
    variables: Object.keys(varValues).length ? JSON.stringify(varValues, null, 2) : '{}',
  }
}

const opName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/[^A-Za-z0-9]/g, '')
