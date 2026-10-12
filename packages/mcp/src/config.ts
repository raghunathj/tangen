/**
 * File Name: config.ts
 * Purpose: MCP config resolution — per-environment override wins over the
 *          workspace config (mirrors storage resolution); everything
 *          defaults OFF. Write mode defaults to 'draft' once enabled.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types. WorkspaceProject.mcp comes from
 *          app/config/mcp.ts via workspace.config.ts.
 */
import type { McpConfig, McpWriteMode, WorkspaceProject } from '@tangen/types'

export interface ResolvedMcpConfig {
  enabled: boolean
  write: McpWriteMode
  tools?: string[]
}

const DISABLED: ResolvedMcpConfig = { enabled: false, write: false }

/** project.mcp > disabled. */
export function resolveMcpConfig(
  project: WorkspaceProject | undefined,
): ResolvedMcpConfig {
  const config = (project as { mcp?: McpConfig } | undefined)?.mcp
  if (!config?.enabled) return DISABLED
  return {
    enabled: true,
    write: config.write === undefined ? 'draft' : config.write,
    tools: config.tools,
  }
}
