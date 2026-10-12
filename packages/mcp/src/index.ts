/**
 * File Name: index.ts
 * Purpose: @tangen/mcp — the MCP server for Tangen CMS as an independent,
 *          optionally-installed package. The Tangen API lazily imports it
 *          only when a workspace enables MCP (app/config/mcp.ts), so hosts
 *          that never enable it carry none of this code at runtime.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends ONLY on @tangen/types. All data access is
 *          injected by the host (see McpToolContext) — this package never
 *          reaches into API internals.
 */
import { handleMcpMessage, type McpServerOptions } from './protocol'
import { buildReadTools, buildSchemaResources, type McpToolContext } from './tools'
import { buildWriteTools, type McpWriteOps } from './writes'
import type { ResolvedMcpConfig } from './config'

export { MCP_PROTOCOL_VERSION, handleMcpMessage } from './protocol'
export type { McpToolDef, McpResourceDef, McpServerOptions } from './protocol'
export { buildReadTools, buildSchemaResources } from './tools'
export type { McpToolContext, McpQueryBuilder, McpMediaHit } from './tools'
export { resolveMcpConfig, type ResolvedMcpConfig } from './config'
export {
  exposedTypes, exposedFields, hiddenFieldNames,
  stripHiddenFields, rejectedWriteFields,
  isTableExposed, exposedTables, tableHiddenColumns, stripTableColumns,
} from './exposure'
export { keyCanObjects, keyCanMedia, keyCanTable, keySearchAudiences } from './permissions'
export { buildWriteTools, type McpWriteOps } from './writes'

export interface McpServer {
  /** Handles one JSON-RPC message (or null for notifications). */
  handle: (message: unknown) => Promise<Record<string, unknown> | null>
  /** Tool names currently exposed (for status/diagnostics). */
  toolNames: string[]
}

/**
 * Assembles a full MCP server for one authenticated key session:
 * read tools (+ write tools per the resolved write mode — A3), schema
 * resources, and the protocol handler.
 */
export function createMcpServer(
  ctx: McpToolContext,
  config: ResolvedMcpConfig,
  writeOps?: McpWriteOps,
  extraTools: import('./protocol').McpToolDef[] = [],
  serverInfo: { name: string; version: string } = { name: 'tangen', version: '1.0.0' },
): McpServer {
  let tools = [
    ...buildReadTools(ctx),
    ...(writeOps ? buildWriteTools(ctx, config.write, writeOps) : []),
    ...extraTools,
  ]
  if (config.tools) tools = tools.filter((t) => config.tools!.includes(t.name))

  const opts: McpServerOptions = {
    serverInfo,
    instructions:
      'Tangen CMS content tools. Call list_types first to learn the content model; ' +
      'search_content returns published content by default.',
    tools,
    resources: buildSchemaResources(ctx),
  }

  return {
    handle: (message) => handleMcpMessage(message as never, opts),
    toolNames: tools.map((t) => t.name),
  }
}
