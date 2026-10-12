/**
 * File Name: ai.ts
 * Purpose: `tangen ai` — installs and inspects the Developer AI setup on a
 *          Tangen site repo. `init` writes agent guardrail files (CLAUDE.md,
 *          AGENTS.md, the tangen-developer skill, permission denies), `status`
 *          reports provider key presence (masked), `info` prints the allowed
 *          build surface.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: node:fs/path only; templates are site-repo flavored
 *          (CLI = `tangen …`, no packages/ directory).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CRITICAL_CONVENTIONS, MCP_HINT } from '../agent-conventions'

// ─── Templates (site-repo flavored) ──────────────────────────────────────────

const AGENT_GUIDE = `# Tangen site - agent guide

This is a Tangen CMS **site**: build in \`app/\` and \`extensions/\` only -
never node_modules, lockfiles, \`.env*\`, or generated files.

Skills live in \`skills/\` (tool-agnostic); this file and the other agent guides
are pointers:

- **Building a whole project or feature area?** Start with
  \`skills/tangen-ai-project/SKILL.md\` - the end-to-end playbook (model the
  domain → write schemas → \`push --plan\` → push → seed content → routes →
  frontend).
- **A single task** (one content type, one route, an extension)? Follow
  \`skills/tangen-developer/SKILL.md\` for the recipe.
- **Admin UI** (an extension page, sidebar panel, or field-type input)? Follow
  \`skills/tangen-admin-kit/SKILL.md\` - the \`@/kit\` surface + recipes.

Everything you need is in THIS project. \`docs/*.md\` mentions are external
references, not local files - don't hunt the filesystem (or a sibling Tangen
checkout) for them; the skills are self-contained.

Commands: \`tangen check\` · \`tangen push\` ·
\`tangen types\` · \`bun run dev\`. Give every AI-eligible field an
\`ai.hint\`; refresh the admin browser tab after a push.

${CRITICAL_CONVENTIONS}

${MCP_HINT}
`

// Cursor rules (.cursor/rules/*.mdc — frontmatter + Markdown body).
const CURSOR_RULES = `---
description: Tangen CMS site development - conventions, verify loop, MCP
globs: app/**,extensions/**
alwaysApply: true
---

# Tangen site development

Build in \`app/\` and \`extensions/\` only - never node_modules, lockfiles,
\`.env*\`, generated files, or Tangen core. For a **whole project or feature
area**, follow \`skills/tangen-ai-project/SKILL.md\` (the end-to-end playbook);
for a **single task**, follow \`skills/tangen-developer/SKILL.md\` (content types,
custom routes, custom tables, extensions, Content AI).

${CRITICAL_CONVENTIONS}

${MCP_HINT}
`

// Windsurf rules (.windsurfrules — plain Markdown, no frontmatter).
const WINDSURF_RULES = `# Tangen site development

Build in \`app/\` and \`extensions/\` only - never node_modules, lockfiles,
\`.env*\`, generated files, or Tangen core. Whole project →
\`skills/tangen-ai-project/SKILL.md\`; single task →
\`skills/tangen-developer/SKILL.md\`.

${CRITICAL_CONVENTIONS}

${MCP_HINT}
`

// The end-to-end "build a project" playbook (obs #33 / AG-1). Editor-agnostic —
// shipped for every tool by `tangen ai init` and referenced from each agent guide.
// MCP client config — points an editor at a locally-run \`tangen mcp\`.
const MCP_CONFIG = {
  mcpServers: {
    tangen: { command: 'tangen', args: ['mcp'] },
  },
}

const SETTINGS = {
  permissions: {
    deny: [
      // platform runtime — read to learn APIs, never write (harmless on npm
      // sites where packages/ does not exist)
      'Edit(./packages/**)',
      'Write(./packages/**)',
      'Edit(./node_modules/**)',
      'Write(./node_modules/**)',
      // secrets + lockfiles — configuration, never agent-authored
      'Edit(./.env*)',
      'Write(./.env*)',
      'Edit(./bun.lock*)',
      'Edit(./package-lock.json)',
      'Edit(./tangen.lock*)',
      // generated code — rewritten by `tangen push` / `tangen types`; hand
      // edits are overwritten, so never touch them (fix the schema instead)
      'Edit(./**/generated/**)',
      'Write(./**/generated/**)',
      'Edit(./**/*.d.ts)',
    ],
  },
}

// ─── Tools → files ───────────────────────────────────────────────────────────

/** Agent tool flavors `tangen ai init` can target. */
export const KNOWN_TOOLS = ['claude', 'codex', 'gemini', 'cursor', 'windsurf'] as const
export type Tool = (typeof KNOWN_TOOLS)[number]

/** Default tools when `--tools` is omitted — the terminal agents (Claude Code,
 *  ChatGPT Codex, Gemini CLI). Cursor/Windsurf are opt-in via `--tools`. */
export const DEFAULT_TOOLS: Tool[] = ['claude', 'codex', 'gemini']

// Written for every tool set — the canonical, tool-agnostic skills (whole-project
// playbook + per-task recipes).
const BASE_FILES = ['skills/tangen-ai-project/SKILL.md', 'skills/tangen-developer/SKILL.md', 'skills/tangen-admin-kit/SKILL.md']

// Per-tool files. Order matters only for stable output.
const TOOL_FILES: Record<Tool, string[]> = {
  claude: [
    'CLAUDE.md',
    '.claude/skills/tangen-ai-project/SKILL.md',
    '.claude/skills/tangen-developer/SKILL.md',
    '.claude/skills/tangen-admin-kit/SKILL.md',
    '.claude/settings.json',
    '.mcp.json',
  ],
  codex: ['AGENTS.md'],
  gemini: ['GEMINI.md', '.gemini/settings.json'],
  cursor: ['.cursor/rules/tangen.mdc', '.cursor/mcp.json'],
  windsurf: ['.windsurfrules'],
}

/** The de-duplicated, ordered file list for a set of tools (skill first). */
export function filesForTools(tools: Tool[]): string[] {
  const out: string[] = [...BASE_FILES]
  for (const t of tools) for (const f of TOOL_FILES[t] ?? []) if (!out.includes(f)) out.push(f)
  return out
}

/** Files written by the default tool set — the historical guardrail set + MCP. */
export const AI_INIT_FILES = filesForTools(DEFAULT_TOOLS)

/** Parse `--tools a,b,c` (case/space tolerant, unknown dropped) → tool list. */
export function parseToolsArg(args: string[]): Tool[] {
  const i = args.indexOf('--tools')
  if (i === -1 || !args[i + 1]) return [...DEFAULT_TOOLS]
  const parsed = args[i + 1]
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Tool => (KNOWN_TOOLS as readonly string[]).includes(s))
  return parsed.length ? parsed : [...DEFAULT_TOOLS]
}

// ─── Shipped skills ───────────────────────────────────────────────────────────
// The three site-facing skills are REAL FILES shipped in the package
// (packages/cli/skills/**), not inlined strings. Inlined copies drifted ~270
// lines behind the canonical skill while `create --ai` kept emitting them
// (finding #17); a file can be diffed, synced, and tested for staleness.

const SHIPPED_SKILLS_DIR = fileURLToPath(new URL('../../skills', import.meta.url))

/** Reads a skill shipped with the CLI package; loud failure over empty guidance. */
export function readShippedSkill(name: string): string {
  const p = join(SHIPPED_SKILLS_DIR, name, 'SKILL.md')
  try {
    return readFileSync(p, 'utf8')
  } catch {
    throw new Error(
      `shipped skill missing: ${p} - the @tangen/cli package publishes skills/**; `
      + `reinstall the package (or run from a full checkout)`,
    )
  }
}

/**
 * The `.claude/skills/<name>/SKILL.md` discovery stub for a shipped skill.
 *
 * Claude Code reads `.claude/skills/`, so this is the file its skill picker
 * sees; the canonical skill stays at `skills/<name>/SKILL.md` where a human
 * and every other tool can find one copy of it.
 *
 * The stub's `name` and `description` are READ FROM the canonical skill rather
 * than written here. They were hardcoded, and by Stage G12 all three had drifted
 * from the skill they point at - the tangen-developer stub still described a
 * skill confined "strictly within the app surface (app/ and extensions/)",
 * which is not what that skill has said since G11. A stale description is worse
 * than a missing one: it is what decides whether the skill is loaded at all.
 */
export function skillStub(name: string): string {
  const canonical = readShippedSkill(name)
  const fm = /^---\n([\s\S]*?)\n---/.exec(canonical)
  const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm?.[1] ?? '')?.[1]?.trim()
  const description = field('description')
  if (!description) throw new Error(`shipped skill ${name} has no description in its frontmatter - the stub is built from it`)
  return `---\nname: ${field('name') ?? name}\ndescription: ${description}\n---\n\n`
    + `Read \`skills/${name}/SKILL.md\` (repo root) and follow it - that file is\n`
    + `the canonical skill; this is a discovery stub.\n`
}

function contentFor(file: string): string {
  switch (file) {
    case 'CLAUDE.md':
    case 'AGENTS.md':
    case 'GEMINI.md':
      return AGENT_GUIDE
    case 'skills/tangen-ai-project/SKILL.md':
      return readShippedSkill('tangen-ai-project')
    case 'skills/tangen-developer/SKILL.md':
      return readShippedSkill('tangen-developer')
    case 'skills/tangen-admin-kit/SKILL.md':
      return readShippedSkill('tangen-admin-kit')
    case '.claude/skills/tangen-ai-project/SKILL.md':
      return skillStub('tangen-ai-project')
    case '.claude/skills/tangen-developer/SKILL.md':
      return skillStub('tangen-developer')
    case '.claude/skills/tangen-admin-kit/SKILL.md':
      return skillStub('tangen-admin-kit')
    case '.claude/settings.json':
      return JSON.stringify(SETTINGS, null, 2) + '\n'
    case '.cursor/rules/tangen.mdc':
      return CURSOR_RULES
    case '.windsurfrules':
      return WINDSURF_RULES
    case '.mcp.json':
    case '.cursor/mcp.json':
    case '.gemini/settings.json':
      return JSON.stringify(MCP_CONFIG, null, 2) + '\n'
    default:
      throw new Error(`Unknown init file: ${file}`)
  }
}

export interface AiInitResult {
  written: string[]
  skipped: string[]
}

/**
 * Writes the Developer AI guardrail files into a site repo for the selected
 * tools (defaults to Claude + Codex). Existing files are left untouched unless
 * force is set.
 */
export function runAiInit(
  targetDir: string,
  opts: { force: boolean; tools?: Tool[] },
): AiInitResult {
  const written: string[] = []
  const skipped: string[] = []
  for (const file of filesForTools(opts.tools ?? DEFAULT_TOOLS)) {
    const dest = join(targetDir, file)
    if (existsSync(dest) && !opts.force) {
      skipped.push(file)
      continue
    }
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, contentFor(file))
    written.push(file)
  }
  return { written, skipped }
}

/**
 * `tangen skills update` - rewrites the base skills in an EXISTING project
 * from the versions shipped with the installed CLI. Without this, a scaffolded
 * repo was frozen at whatever the CLI emitted the day it ran, with no route
 * back to improvements (finding #17).
 *
 * Base skills are generated docs and are OVERWRITTEN; the per-tool discovery
 * stubs are refreshed only where they already exist (their presence encodes
 * which tools the project opted into).
 */
export function runSkillsUpdate(targetDir: string): AiInitResult {
  const written: string[] = []
  const skipped: string[] = []
  for (const file of BASE_FILES) {
    const dest = join(targetDir, file)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, contentFor(file))
    written.push(file)
  }
  for (const [, files] of Object.entries(TOOL_FILES)) {
    for (const file of files) {
      if (!file.includes('/skills/')) continue
      const dest = join(targetDir, file)
      if (!existsSync(dest)) { skipped.push(file); continue }
      writeFileSync(dest, contentFor(file))
      written.push(file)
    }
  }
  return { written, skipped }
}

// ─── status ───────────────────────────────────────────────────────────────────

const PROVIDER_KEYS: [string, string][] = [
  ['anthropic', 'ANTHROPIC_API_KEY'],
  ['openai', 'OPENAI_API_KEY'],
  ['gemini', 'GEMINI_API_KEY'],
]

/** Masks an API key to a short hint — never more than 8 characters of it. */
export function maskKey(key: string | undefined): string {
  if (!key) return 'not set'
  if (key.length < 12) return 'set'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

/** Builds the provider-key report from an environment record. */
export function buildAiStatusLines(env: Record<string, string | undefined>): string[] {
  return PROVIDER_KEYS.map(([name, varName]) => {
    const masked = maskKey(env[varName])
    return `  ${name.padEnd(10)} ${varName.padEnd(20)} ${masked}`
  })
}

const SURFACE_INFO = `Tangen agent build surface
  app/content-objects/      content type schemas (tangen push deploys)
  app/api/          custom REST routes  (/api/v1/custom/…)
  app/config/       workspace / extensions / ai
  app/globals/      global key-value definitions
  extensions/<id>/  extensions: panels, field types, hooks, AI opt-in

Out of bounds: node_modules, lockfiles, .env*, generated files, Tangen core.
Docs: docs/fields.md · docs/tangenql.md · docs/content-ai.md · docs/developer-ai.md`

/** CLI entrypoints ---------------------------------------------------------- */

export function runAiCommand(args: string[]): void {
  const sub = args[1]
  if (sub === 'init') {
    const force = args.includes('--force')
    const tools = parseToolsArg(args)
    const { written, skipped } = runAiInit(process.cwd(), { force, tools })
    for (const f of written) console.log(`  ✓ wrote ${f}`)
    for (const f of skipped) console.log(`  – kept ${f} (exists - use --force to overwrite)`)
    console.log(`\nAgent guardrails installed for: ${tools.join(', ')}.`)
    console.log('Point your coding agent at its rules file; run `tangen mcp` to connect it over MCP.')
  } else if (sub === 'status') {
    console.log('Content AI provider keys (from this process environment):\n')
    for (const line of buildAiStatusLines(process.env)) console.log(line)
    console.log('\nA provider is available to admins when its key resolves AND app/config/ai.ts permits it.')
  } else if (sub === 'info') {
    console.log(SURFACE_INFO)
  } else {
    console.error('Usage: tangen ai <init|status|info> [--force] [--tools claude,codex,gemini,cursor,windsurf]')
    process.exitCode = 1
  }
}
