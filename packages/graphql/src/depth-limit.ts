/**
 * File Name: depth-limit.ts
 * Purpose: A GraphQL validation rule that rejects an operation whose selection
 *   sets nest deeper than a configured maximum - the enforcement half of
 *   `graphql.maxDepth`, which until now resolved to 12 and did nothing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Written here rather than pulled in as a dependency
 *   because the whole rule is forty lines and @tangen/graphql deliberately
 *   depends only on @tangen/types + graphql. It runs as a normal validation
 *   rule, so a violation arrives in the standard `errors` array with source
 *   locations and the HTTP mount keeps returning 200 - a depth denial must not
 *   be the one query-level problem that throws.
 *
 *   Depth is the maximum nesting of SELECTION SETS, so `{ ping }` is 1 and
 *   `{ post { author { name } } }` is 3. Fields whose names begin with `__`
 *   (`__typename`, `__schema`, `__type`) are not counted: they are answerable
 *   without touching the database, and introspection is gated separately by
 *   NoSchemaIntrospectionCustomRule. Named fragments ARE counted for what they
 *   expand to, because hiding depth behind a spread is the first thing anybody
 *   would try; a self-referencing fragment is walked once and then left to
 *   graphql's own NoFragmentCycles rule to report.
 */
import { GraphQLError, Kind, parse } from 'graphql'
import type { DocumentNode, FragmentDefinitionNode, SelectionSetNode, ValidationRule } from 'graphql'

/**
 * Maximum selection-set nesting reachable from one selection set.
 * @param set - The selection set to measure.
 * @param fragments - Named fragment definitions in the same document.
 * @param seen - Fragment names already expanded on this path (cycle guard).
 * @returns Depth in levels; 0 for an empty set.
 */
function depthOf(
  set: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  seen: ReadonlySet<string>,
): number {
  let max = 0
  for (const selection of set.selections) {
    if (selection.kind === Kind.FIELD) {
      // Introspection and __typename cost nothing to answer.
      if (selection.name.value.startsWith('__')) continue
      const inner = selection.selectionSet ? depthOf(selection.selectionSet, fragments, seen) : 0
      max = Math.max(max, 1 + inner)
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      // Selects on the SAME object, so it adds no fan-out and no level.
      max = Math.max(max, depthOf(selection.selectionSet, fragments, seen))
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const name = selection.name.value
      if (seen.has(name)) continue
      const fragment = fragments.get(name)
      if (!fragment) continue
      max = Math.max(max, depthOf(fragment.selectionSet, fragments, new Set([...seen, name])))
    }
  }
  return max
}

/**
 * Builds the validation rule for a resolved `maxDepth`.
 * @param maxDepth - Deepest operation allowed; values below 1 disable the rule.
 * @returns A graphql ValidationRule reporting one error per over-deep operation.
 */
export function createMaxDepthRule(maxDepth: number): ValidationRule {
  return (context) => {
    const fragments = new Map<string, FragmentDefinitionNode>()
    for (const definition of context.getDocument().definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition)
    }
    return {
      OperationDefinition(node) {
        if (!Number.isFinite(maxDepth) || maxDepth < 1) return false
        const depth = depthOf(node.selectionSet, fragments, new Set())
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(
              `Query is too deep: ${depth} levels of nesting exceeds the maximum of ${maxDepth}.`,
              { nodes: [node] },
            ),
          )
        }
        // The whole operation is measured here; descending would re-measure it.
        return false
      },
    }
  }
}

/**
 * The depth of a document as the rule above would charge it: the deepest
 * operation, measured the same way. Exists so the API's Gateway can hold a
 * ceiling ABOVE the rule (M6 of tasks/plan-gateway.md) without a schema in
 * hand - nesting is a property of the document alone.
 * @param source - The query text, or an already parsed document.
 * @returns Depth in levels, or null when the text does not parse (the
 *          normal execution path reports the syntax error).
 */
export function measureQueryDepth(source: string | DocumentNode): number | null {
  let document: DocumentNode
  try {
    document = typeof source === 'string' ? parse(source) : source
  } catch {
    return null
  }
  const fragments = new Map<string, FragmentDefinitionNode>()
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition)
  }
  let max = 0
  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue
    max = Math.max(max, depthOf(definition.selectionSet, fragments, new Set()))
  }
  return max
}
