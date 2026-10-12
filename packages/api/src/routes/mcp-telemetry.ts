/**
 * File Name: mcp-telemetry.ts
 * Purpose: One MCP tool call, observed (closure plan Phase 9D, Units 13 and
 *          21). Which tool ran and whether it worked is operational; what was
 *          asked and what came back is the caller's content, and a tool's
 *          arguments are the single most sensitive thing MCP handles.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Its own module rather than a closure inside the route,
 *          so the redaction is testable without standing up an MCP server.
 */
import { emitTelemetry } from '../telemetry/bus'

/** JSON-RPC error codes, as the small vocabulary an operator reads. */
const RPC_CODES: Record<number, string> = {
  [-32700]: 'parse_error',
  [-32600]: 'invalid_request',
  [-32601]: 'method_not_found',
  [-32602]: 'invalid_params',
  [-32603]: 'internal_error',
}

/** The tool a message calls, or null when the message is not a tool call. */
function toolNameOf(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null
  const m = message as { method?: unknown; params?: unknown }
  if (m.method !== 'tools/call') return null
  const name = (m.params as { name?: unknown } | undefined)?.name
  return typeof name === 'string' ? name : 'unknown'
}

/**
 * Runs the handler and records the outcome for a tool call. Anything else -
 * initialize, tools/list, a notification - is not a tool call and produces no
 * event: a taxonomy that fires on everything stops meaning anything.
 */
export async function observeMcpCall<T extends Record<string, unknown> | null>(
  message: unknown,
  handle: () => Promise<T>,
): Promise<T> {
  const tool = toolNameOf(message)
  if (!tool) return handle()

  const started = Date.now()
  try {
    const response = await handle()
    const error = (response as { error?: { code?: unknown } } | null)?.error
    const errorCode = error
      ? (typeof error.code === 'number' ? RPC_CODES[error.code] ?? 'error' : 'error')
      : undefined
    emitTelemetry({
      name: 'mcp.tool.completed', severity: errorCode ? 'warn' : 'info', durationMs: Date.now() - started,
      attributes: { tool, result: errorCode ? 'error' : 'ok', ...(errorCode ? { errorCode } : {}) },
    })
    return response
  } catch (err) {
    // The thrown value is rethrown, never described: a driver message names
    // columns, constraints and sometimes the values that collided.
    emitTelemetry({
      name: 'mcp.tool.completed', severity: 'warn', durationMs: Date.now() - started,
      attributes: { tool, result: 'error', errorCode: 'execution_failed' },
    })
    throw err
  }
}
