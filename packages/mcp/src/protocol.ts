/**
 * File Name: protocol.ts
 * Purpose: Minimal, zero-dependency MCP server core — JSON-RPC 2.0 message
 *          handling for the subset of the Model Context Protocol Tangen
 *          speaks: initialize / ping / tools/list / tools/call /
 *          resources/list / resources/read. Transport-agnostic: the HTTP
 *          route and the stdio CLI both feed messages through here.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Deliberately NOT the official SDK — the protocol
 *          subset is small and core stays dependency-free (see plan's
 *          packaging boundary). Protocol revision pinned below.
 */

export const MCP_PROTOCOL_VERSION = '2025-03-26'

export interface McpToolDef {
  name: string
  description: string
  /** JSON Schema for the tool arguments. */
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

export interface McpResourceDef {
  uri: string
  name: string
  description?: string
  mimeType?: string
  read: () => Promise<string>
}

export interface McpServerOptions {
  serverInfo: { name: string; version: string }
  instructions?: string
  tools: McpToolDef[]
  resources?: McpResourceDef[]
}

interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

type JsonRpcResponse = Record<string, unknown>

const err = (id: string | number | null | undefined, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0', id: id ?? null, error: { code, message },
})
const ok = (id: string | number | null | undefined, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0', id: id ?? null, result,
})

/**
 * Handles one JSON-RPC message. Returns null for notifications (no reply).
 * Tool handler failures become tool results with isError (per MCP spec),
 * not protocol errors — agents read them as tool feedback.
 */
export async function handleMcpMessage(
  msg: JsonRpcMessage,
  opts: McpServerOptions,
): Promise<JsonRpcResponse | null> {
  const { id, method, params = {} } = msg

  if (msg.jsonrpc !== '2.0' || typeof method !== 'string') {
    return err(id, -32600, 'Invalid Request - expected a JSON-RPC 2.0 message')
  }

  // Notifications get no response
  if (method.startsWith('notifications/')) return null

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          ...(opts.resources?.length ? { resources: {} } : {}),
        },
        serverInfo: opts.serverInfo,
        ...(opts.instructions ? { instructions: opts.instructions } : {}),
      })

    case 'ping':
      return ok(id, {})

    case 'tools/list':
      return ok(id, {
        tools: opts.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      })

    case 'tools/call': {
      const name = params.name as string | undefined
      const tool = opts.tools.find((t) => t.name === name)
      if (!tool) return err(id, -32602, `Unknown tool: ${name}`)
      try {
        const result = await tool.handler((params.arguments as Record<string, unknown>) ?? {})
        return ok(id, {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
        })
      } catch (e) {
        return ok(id, {
          content: [{ type: 'text', text: (e as Error).message ?? 'Tool failed' }],
          isError: true,
        })
      }
    }

    case 'resources/list':
      return ok(id, {
        resources: (opts.resources ?? []).map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType })),
      })

    case 'resources/read': {
      const uri = params.uri as string | undefined
      const resource = (opts.resources ?? []).find((r) => r.uri === uri)
      if (!resource) return err(id, -32602, `Unknown resource: ${uri}`)
      try {
        const text = await resource.read()
        return ok(id, { contents: [{ uri: resource.uri, mimeType: resource.mimeType ?? 'application/json', text }] })
      } catch (e) {
        return err(id, -32603, (e as Error).message ?? 'Resource read failed')
      }
    }

    default:
      return err(id, -32601, `Method not found: ${method}`)
  }
}
