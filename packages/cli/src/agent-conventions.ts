/**
 * File Name: agent-conventions.ts
 * Purpose: The single source of truth for the Tangen conventions an AI coding
 *   agent needs — the gotchas that trip agents up, the verify loop, and how to
 *   connect over MCP. Embedded into every agent rules file by `tangen ai init`
 *   and into the docs/llms.txt bundle by scripts/build-llms.ts, so the guidance
 *   never drifts between surfaces.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** The gotchas every coding agent needs up front (Markdown block). */
export const CRITICAL_CONVENTIONS = `## Critical conventions (read first)

- **Environments:** the development env **slug is \`development\`**, not \`dev\`.
  Admin API calls address the one deployment the process serves; there is no environment parameter.
- **Local client, content types:** \`create({ title, values })\` - content field
  values go under \`values\`. Drafts are invisible to default queries, so
  \`publish\` on create if you need to read the row back immediately.
- **Local client, custom tables:** rows are flat - \`create({ email, rating })\`,
  no \`title\`/\`values\` wrapper.
- **Query filters:** the not-equal operator is \`ne\` (not \`neq\`); sort by
  \`created_at\`.
- **Verification loop (every change):** \`tangen check\` → \`tangen push --plan\`
  → \`tangen push\`. Give every AI-eligible field an \`ai.hint\`.`

/** How to bridge an editor/agent to a running Tangen over MCP (Markdown block). */
export const MCP_HINT = `## Connect your AI over MCP

A running Tangen exposes agent-operable content tools. Bridge your editor to it
with a local stdio server:

    tangen mcp        # add --allow-schema to let it push schema

\`tangen ai init\` writes the matching config (\`.mcp.json\` for Claude Code,
\`.cursor/mcp.json\` for Cursor). Reference: docs/mcp.md.`
