/**
 * File Name: mcp.ts
 * Purpose: `tangen mcp` — stdio MCP server for local agents (Claude Code,
 *          Claude Desktop, IDEs). A thin bridge: JSON-RPC messages arrive
 *          newline-delimited on stdin and are forwarded to the running
 *          Tangen API's /api/v1/mcp with an API key; responses stream back
 *          on stdout. `--allow-schema` adds two CLI-LOCAL developer tools
 *          (schema_check / schema_push) that never leave the machine.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires the dev API to be running (bun run dev) and
 *          TANGEN_API_KEY (or --key). MCP itself must be enabled in
 *          app/config/mcp.ts — the bridge surfaces the server's 404 hint
 *          otherwise. schema_push runs only in a development deployment.
 */
import { resolveDeploymentRole } from '@tangen/types'

interface McpBridgeOptions {
  apiUrl: string
  apiKey: string
  allowSchema: boolean
}

interface LocalTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<string>
}

function localTools(opts: McpBridgeOptions): LocalTool[] {
  if (!opts.allowSchema) return []
  const run = async (argv: string[]): Promise<string> => {
    const proc = Bun.spawn([process.execPath, process.argv[1] ?? 'tangen', ...argv], {
      stdout: 'pipe', stderr: 'pipe',
    })
    const [out, errOut] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    await proc.exited
    return [out, errOut].filter(Boolean).join('\n').trim() || `(exit ${proc.exitCode})`
  }
  return [
    {
      name: 'schema_check',
      description: 'Type-check the local Tangen schema files (tangen check). Read-only.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => run(['check']),
    },
    {
      name: 'schema_push',
      description: 'Push local schema changes (tangen push). Affects the live development database.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => {
        if (resolveDeploymentRole(process.env) !== 'development') {
          return Promise.resolve('schema_push is limited to a development deployment.')
        }
        return run(['push'])
      },
    },
  ]
}

/** Forwards one JSON-RPC message to the remote MCP endpoint. */
async function forward(opts: McpBridgeOptions, message: unknown): Promise<unknown | null> {
  const res = await fetch(`${opts.apiUrl}/api/v1/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(message),
  })
  if (res.status === 202) return null                 // notification accepted
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const id = (message as { id?: unknown })?.id ?? null
    return {
      jsonrpc: '2.0', id,
      error: { code: -32603, message: `Tangen MCP endpoint ${res.status}: ${detail.slice(0, 300)}` },
    }
  }
  return res.json()
}

// ─── `tangen mcp expose` — auditable "what can agents see" report ────────────

interface McpExposeArgs { configCwd: string; workspaceId: string }

async function loadConfig(configCwd: string): Promise<Record<string, any>> {
  const { join } = await import('node:path')
  const { existsSync } = await import('node:fs')
  for (const file of ['workspace.config.ts', 'tangen.config.ts']) {
    const p = join(configCwd, file)
    if (existsSync(p)) {
      const mod = await import(p)
      return (mod.default ?? mod) as Record<string, any>
    }
  }
  throw new Error(`No workspace.config.ts or tangen.config.ts in ${configCwd}`)
}

const yn = (on: boolean) => (on ? 'yes' : ' - ')

/**
 * Prints, in one place, exactly which content types AND custom tables are
 * exposed to MCP and indexed for RAG — the "which is allowed" audit. Exposure
 * is computed from the same predicates the live tools use (@tangen/mcp), so it
 * can't drift from real behavior; falls back to the inline rule if the
 * optional package isn't installed.
 */
export async function runMcpExposeCommand(args: McpExposeArgs): Promise<void> {
  const config = await loadConfig(args.configCwd)
  const mcp = config.mcp
  const knowledge = config.knowledge
  const types = (config.schemas ?? []) as any[]
  const tables = (config.customTables ?? []) as any[]

  // Prefer the authoritative exposure fns; degrade gracefully if @tangen/mcp is absent.
  let isTableExposed = (t: any) => t.mcp !== false && t.mcp?.enabled !== false
  let tableHiddenColumns = (t: any): string[] => (typeof t.mcp === 'object' ? t.mcp.hiddenColumns ?? [] : [])
  try {
    // Indirect specifier: @tangen/mcp is optional, not a static CLI dependency.
    const pkg = '@tangen/mcp'
    const mod: any = await import(pkg)
    isTableExposed = mod.isTableExposed
    tableHiddenColumns = mod.tableHiddenColumns
  } catch { /* optional package not installed - inline rule stands */ }

  const mcpOn = mcp?.enabled === true
  const ragOn = knowledge?.enabled === true
  console.log(`Agent access - workspace ${args.workspaceId}`)
  console.log(`  MCP: ${mcpOn ? 'enabled' : 'DISABLED (app/config/mcp.ts)'}   RAG: ${ragOn ? 'enabled' : 'DISABLED (app/config/knowledge.ts)'}\n`)

  const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
  console.log(`  ${pad('CONTENT TYPE', 22)} ${pad('MCP', 5)} ${pad('RAG', 5)} audience`)
  for (const t of types) {
    const exposed = mcpOn && t.mcp !== false && t.disabled !== true
    const indexed = ragOn && t.knowledge?.enabled === true
    console.log(`  ${pad(t.name, 22)} ${pad(yn(exposed), 5)} ${pad(yn(indexed), 5)} ${indexed ? t.knowledge?.audience ?? 'public' : ''}`)
  }
  if (types.length === 0) console.log('  (no content types)')

  console.log(`\n  ${pad('CUSTOM TABLE', 22)} ${pad('MCP', 5)} ${pad('RAG', 5)} notes`)
  for (const t of tables) {
    const exposed = mcpOn && isTableExposed(t)
    const indexed = ragOn && t.knowledge?.enabled === true
    const notes: string[] = []
    const hidden = tableHiddenColumns(t)
    if (exposed && hidden.length) notes.push(`MCP hides: ${hidden.join(', ')}`)
    if (indexed) notes.push(`RAG cols: ${(t.knowledge?.columns ?? []).join(', ')} (${t.knowledge?.audience ?? 'public'})`)
    console.log(`  ${pad(t.name, 22)} ${pad(yn(exposed), 5)} ${pad(yn(indexed), 5)} ${notes.join(' · ')}`)
  }
  if (tables.length === 0) console.log('  (no custom tables)')
  console.log('\n  MCP exposure is opt-out (mcp:false to hide); RAG is opt-in (knowledge.enabled).')
  console.log('  Live reads are additionally gated by each API key’s grants.')
}

export async function runMcpCommand(args: string[]): Promise<void> {
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const opts: McpBridgeOptions = {
    apiUrl: flag('--url') ?? process.env.TANGEN_API_URL ?? 'http://localhost:3000',
    apiKey: flag('--key') ?? process.env.TANGEN_API_KEY ?? '',
    allowSchema: args.includes('--allow-schema'),
  }
  if (!opts.apiKey) {
    console.error('tangen mcp: an API key is required - pass --key or set TANGEEN_API_KEY'.replace('TANGEEN', 'TANGEN'))
    console.error('Add to Claude Code with:')
    console.error('  claude mcp add tangen -- tangen mcp --key <your-api-key>')
    process.exit(1)
  }

  const locals = localTools(opts)
  const write = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n')

  // stderr is the human channel; stdout carries only protocol messages
  console.error(`[tangen mcp] bridging stdio ↔ ${opts.apiUrl}/api/v1/mcp${locals.length ? ' (+ local schema tools)' : ''}`)

  let buffer = ''
  for await (const chunk of Bun.stdin.stream()) {
    buffer += new TextDecoder().decode(chunk)
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      let msg: { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
      try {
        msg = JSON.parse(line)
      } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
        continue
      }

      // Local developer tools are handled entirely in the CLI
      if (msg.method === 'tools/call' && locals.some((t) => t.name === msg.params?.name)) {
        const tool = locals.find((t) => t.name === msg.params?.name)!
        try {
          const text = await tool.handler(msg.params?.arguments ?? {})
          write({ jsonrpc: '2.0', id: msg.id ?? null, result: { content: [{ type: 'text', text }] } })
        } catch (e) {
          write({ jsonrpc: '2.0', id: msg.id ?? null, result: { content: [{ type: 'text', text: (e as Error).message }], isError: true } })
        }
        continue
      }

      const response = await forward(opts, msg)
      if (response === null) continue

      // Merge local tools into the remote listing
      if (msg.method === 'tools/list' && locals.length > 0) {
        const r = response as { result?: { tools?: unknown[] } }
        if (r.result?.tools) {
          r.result.tools.push(...locals.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })))
        }
      }
      write(response)
    }
  }
}
