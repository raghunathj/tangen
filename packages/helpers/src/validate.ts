/**
 * File Name: validate.ts
 * Purpose: Wraps valibot to parse and validate request body and query parameters, throwing structured RouteError 422 responses on failure.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Uses valibot for schema validation; depends on @tangen/types for RouteContext and RouteError.
 */
import * as valibot from 'valibot'
import { RouteError } from '@tangen/types'
import type { RouteContext } from '@tangen/types'

/** The full valibot namespace — use this to build schemas. */
export * as v from 'valibot'

/**
 * Parse and validate the request body against a valibot schema.
 * Throws RouteError 422 with structured fieldErrors on failure.
 *
 * @example
 * const body = parseBody(ctx, v.object({
 *   name: v.optional(v.string()),
 *   bio:  v.optional(v.pipe(v.string(), v.maxLength(500))),
 * }))
 */
export function parseBody<S extends valibot.GenericSchema>(
  ctx: RouteContext,
  schema: S,
): valibot.InferOutput<S> {
  return _parse(ctx.body, schema, 'Invalid request body')
}

/**
 * Parse and validate query parameters against a valibot schema.
 *
 * @example
 * const query = parseQuery(ctx, v.object({
 *   status: v.optional(v.picklist(['active', 'blocked'])),
 *   q:      v.optional(v.string()),
 * }))
 */
export function parseQuery<S extends valibot.GenericSchema>(
  ctx: RouteContext,
  schema: S,
): valibot.InferOutput<S> {
  return _parse(ctx.query, schema, 'Invalid query parameters')
}

function _parse<S extends valibot.GenericSchema>(
  input: unknown,
  schema: S,
  fallbackMessage: string,
): valibot.InferOutput<S> {
  const result = valibot.safeParse(schema, input)
  if (result.success) return result.output

  const flat = valibot.flatten<S>(result.issues)

  if (flat.root?.length) {
    throw new RouteError(422, flat.root[0] ?? fallbackMessage)
  }

  const fieldErrors: Record<string, string> = {}
  const nested = Object.entries(flat.nested ?? {}) as [string, string[] | undefined][]
  for (const [path, messages] of nested) {
    fieldErrors[path] = messages?.[0] ?? 'Invalid'
  }
  throw new RouteError(422, fallbackMessage, { fieldErrors })
}
