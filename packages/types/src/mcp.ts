/**
 * File Name: mcp.ts
 * Purpose: MCP (Model Context Protocol) configuration and exposure types —
 *          how a workspace opts its content into agent-operable tools.
 *          OFF by default; the site developer enables per env and controls
 *          exposure per type (`mcp: false` on the type) and per field
 *          (`mcp: false` on the field config).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Consumed by the API's /api/v1/mcp endpoint and the
 *          `tangen mcp` stdio server. Write tools default to draft-only.
 */

/** MCP write policy. 'draft' = create/update tools always produce drafts. */
export type McpWriteMode = 'draft' | 'full' | false

export interface McpConfig {
  /** Master switch — the endpoint 404s and tools vanish when false/absent. */
  enabled: boolean
  /**
   * What write tools may do:
   *  - 'draft' (default when enabled) — create_object/update_object force
   *    status 'draft' and never touch publish/schedule fields
   *  - 'full'  — status changes allowed when the API key's grant allows them
   *  - false   — read-only server (write tools are not listed)
   */
  write?: McpWriteMode
  /**
   * Tool allow-list — omit for all built-in tools. Extension tools are
   * always additionally gated by the extension being installed.
   */
  tools?: string[]
}

/** Identity builder for app/config/mcp.ts. */
export function defineMcpConfig(config: McpConfig): McpConfig {
  return config
}

/**
 * Per-custom-table MCP exposure (`CustomTableDefinition.mcp`). Tables are
 * EXPOSED by default (opt-out, like content types) — the API key's
 * `tables:read` grant is the real gate; this controls schema/config-level
 * visibility to agents. Shorthand `mcp: false` hides the table entirely;
 * `mcp: true`/absent exposes it.
 */
export interface TableMcpConfig {
  /** Expose this table to MCP tools (default true). false = never visible to agents. */
  enabled?: boolean
  /**
   * Columns MCP must never see — stripped from `query_table` rows and hidden
   * from `get_schema`. Opt-out redaction, independent of the RAG
   * `knowledge.columns` opt-in (which chooses what to INDEX, not what agents read).
   */
  hiddenColumns?: string[]
}
