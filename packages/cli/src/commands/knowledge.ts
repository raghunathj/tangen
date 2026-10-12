/**
 * File Name: knowledge.ts
 * Purpose: `tangen knowledge index|status` — the turn-it-on backfill and
 *          the enabled/health report for the Knowledge (RAG) surface.
 *          index embeds existing PUBLISHED content (opted-in types +
 *          custom-table columns + repo file sources) with a cost estimate
 *          and confirmation before any provider is called.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires the optional @tangen/knowledge package and
 *          the pgvector extension (preflight prints exact install steps).
 *          Content-hash skipping makes re-runs cheap; --rebuild wipes and
 *          re-embeds (required when switching embedding models).
 */
import { resolveProjectDeployment, embeddingsApiKeyFor, type ResolvedDeployment } from '@tangen/types'
import { resolveDeploymentDatabase, describeDatabaseError, deploymentRole, type DeploymentDatabase } from '../deployment-database'
import { join, resolve, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import type { KnowledgeConfig, ObjectTypeDefinition } from '@tangen/types'

interface KnowledgeCliArgs {
  configCwd: string
  workspaceId: string
  rebuild: boolean
  yes: boolean
  /** `--docs` — also index the project's own docs (markdown under `docs/`) for
   *  dev-time doc RAG (the `ask_docs` MCP tool), without needing a configured
   *  `sources.repo` glob. */
  docs?: boolean
}

const TABLE_NAME_RE = /^[a-z0-9_]+$/

async function loadWorkspaceConfig(configCwd: string): Promise<Record<string, any>> {
  for (const file of ['tangen.config.ts', 'workspace.config.ts']) {
    const p = join(configCwd, file)
    if (existsSync(p)) {
      const mod = await import(`${p}?t=${Date.now()}`)
      return (mod.default ?? mod) as Record<string, any>
    }
  }
  throw new Error(`No tangen.config.ts or workspace.config.ts in ${configCwd}`)
}

/**
 * Resolves the project the same way `tangen push` does: the thin
 * tangen.config.ts merged with the workspace config (feature config) via
 * resolveEffectiveConfig - so consumer repos work identically to the
 * monorepo. Exported for tests.
 */
export async function resolveKnowledgeProject(
  configCwd: string,
  workspaceIdArg: string | undefined,
): Promise<{
  config: Record<string, any>
  /** Null when this deployment has no database (the error says why). */
  database: DeploymentDatabase | null
  databaseError: string | null
  workspaceId: string
  knowledge: KnowledgeConfig | undefined
  deployment: ResolvedDeployment
}> {
  const thin = await loadWorkspaceConfig(configCwd)
  const { resolveEffectiveConfig } = await import('./push')
  const config = await resolveEffectiveConfig(configCwd, thin as never) as Record<string, any>
  const workspaceId = process.env.TANGEN_WORKSPACE_ID
    ?? (config.workspaceId as string | undefined)
    ?? workspaceIdArg
    ?? (config.project ? `wsp_${String(config.project).toLowerCase().replace(/[^a-z0-9]+/g, '_')}` : 'wsp_local_dev')
  // The deployment this command targets: its secret provider answers the
  // embedding key, so the knowledge package never reads the process itself.
  const deployment = resolveProjectDeployment({
    project: { workspaceId, config, siteConfig: config.siteConfig, declaredExtensions: config.extensions },
    role: deploymentRole(),
  })
  const knowledge = resolveKnowledge(config)
  let database: DeploymentDatabase | null = null
  let databaseError: string | null = null
  try { database = resolveDeploymentDatabase() } catch (e) { databaseError = describeDatabaseError(e) }
  return {
    config,
    database,
    databaseError,
    workspaceId,
    knowledge: knowledge?.embeddings ? { ...knowledge, embeddings: { ...knowledge.embeddings, apiKey: embeddingsApiKeyFor(deployment, knowledge.embeddings) } } : knowledge,
    deployment,
  }
}

function findProjectRoot(configCwd: string): string {
  let dir = configCwd
  while (true) {
    if (existsSync(join(dir, 'package.json')) || existsSync(join(dir, 'app'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return configCwd
    dir = parent
  }
}

function resolveKnowledge(config: Record<string, any>): KnowledgeConfig | undefined {
  return config.knowledge
}

/**
 * The opted-in schema types: workspace-config `schemas` when present
 * (monorepo shape), else loaded from the project's schema source like
 * `tangen push` does (consumer shape).
 */
export async function knowledgeSchemaTypes(
  configCwd: string,
  config: Record<string, any>,
): Promise<ObjectTypeDefinition[]> {
  let types = (config.schemas ?? []) as ObjectTypeDefinition[]
  if (!types.length) {
    try {
      const { loadLocalSchema } = await import('../schema-loader')
      types = (await loadLocalSchema(join(configCwd, 'tangen.config.ts'))).types as ObjectTypeDefinition[]
    } catch { /* no local schema - stays empty */ }
  }
  return types.filter((t) => t.knowledge?.enabled)
}

async function setup(args: KnowledgeCliArgs) {
  let knowledge: typeof import('@tangen/knowledge')
  try {
    knowledge = await import('@tangen/knowledge')
  } catch {
    console.error('tangen knowledge: the @tangen/knowledge package is not installed - run: bun add @tangen/knowledge')
    process.exit(1)
  }

  const project = await resolveKnowledgeProject(args.configCwd, args.workspaceId)
  const { config, database } = project
  if (!database) {
    console.error(`tangen knowledge: ${project.databaseError}`)
    process.exit(1)
  }
  // The config-derived workspace id wins over the CLI banner guess.
  args.workspaceId = project.workspaceId
  const kc = project.knowledge

  const { createDb } = await import('@tangen/db')
  const db: any = createDb(database.url)
  const raw = db.$rawClient ?? db.session?.client
  const exec = (text: string, params?: unknown[]) => raw.unsafe(text, (params ?? []) as never)
  const store = knowledge.createKnowledgeStore(exec)

  return { knowledge, config, kc, db, exec, store }
}

export async function runKnowledgeStatusCommand(args: KnowledgeCliArgs): Promise<void> {
  const { knowledge, config, kc, db, store } = await setup(args)
  try {
    console.log(`Knowledge status - workspace ${args.workspaceId}\n`)
    if (!kc?.enabled) {
      console.log('  Disabled (default). Enable in app/config/knowledge.ts and wire `knowledge:` into workspace.config.ts.')
      return
    }
    console.log(`  Enabled: yes`)
    try {
      const emb = knowledge.requireEmbeddingsConfig({ enabled: true, embeddings: kc.embeddings, chunking: { size: 400, overlap: 60 }, sources: { repo: [], mediaFolders: [] } } as never)
      const adapter = knowledge.getEmbeddingAdapter(emb)
      console.log(`  Embeddings: ${adapter.name} (${adapter.dimensions} dims)`)
    } catch (e) {
      console.log(`  Embeddings: NOT CONFIGURED\n${String((e as Error).message)}`)
    }

    const types = await knowledgeSchemaTypes(args.configCwd, config)
    const tables = knowledge.knowledgeTables(config.customTables)
    console.log(`  Types opted in: ${types.length ? types.map((t) => t.name).join(', ') : '(none - add knowledge:{enabled:true} to a type)'}`)
    console.log(`  Tables opted in: ${tables.length ? tables.map((t) => t.name).join(', ') : '(none)'}`)
    console.log(`  Repo sources: ${(kc.sources?.repo ?? []).map((e: any) => typeof e === 'string' ? e : `${e.glob}${e.audience === 'internal' ? ' (internal)' : ''}`).join(', ') || '(none)'}`)

    const pre = await store.preflight()
    if (!pre.ok || !pre.installed) {
      console.log(`\n  pgvector: ${pre.available ? 'available but not enabled (index run will enable it)' : 'MISSING'}`)
      if (pre.instructions) console.log(pre.instructions.split('\n').map((l) => `    ${l}`).join('\n'))
      return
    }
    const meta = await store.getMeta(args.workspaceId)
    if (meta) console.log(`  Index model: ${meta.provider}/${meta.model} (${meta.dimensions} dims)`)
    const counts = await store.counts(args.workspaceId)
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    console.log(`  Chunks: ${total}${total ? ` (${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ' - run: tangen knowledge index'}`)
    if (total) {
      const audiences = await store.audienceCounts(args.workspaceId)
      console.log(`  Audiences: ${Object.entries(audiences).map(([k, v]) => `${k}: ${v}`).join(', ')}`)
    }
  } finally {
    await db.end()
  }
}

export async function runKnowledgeIndexCommand(args: KnowledgeCliArgs): Promise<void> {
  const { knowledge, config, kc, db, exec, store } = await setup(args)
  try {
    if (!kc?.enabled) {
      console.error('tangen knowledge: knowledge is not enabled for this workspace/env (app/config/knowledge.ts).')
      process.exit(1)
    }
    const embeddings = knowledge.requireEmbeddingsConfig({
      enabled: true, embeddings: kc.embeddings,
      chunking: { size: kc.chunking?.size ?? 400, overlap: kc.chunking?.overlap ?? 60 },
      sources: { repo: [], mediaFolders: [] },
    } as never)
    const adapter = knowledge.getEmbeddingAdapter(embeddings)

    // pgvector preflight — exact instructions beat a runtime stack trace
    const pre = await store.preflight()
    if (!pre.available) {
      console.error(pre.instructions ?? 'pgvector unavailable')
      process.exit(1)
    }

    // Vector-space pin: switching models requires --rebuild
    const meta = await store.getMeta(args.workspaceId).catch(() => undefined)
    const indexedBy = meta ? knowledge.vectorSpaceName(meta) : null
    if (meta && (meta.dimensions !== adapter.dimensions || indexedBy !== adapter.name) && !args.rebuild) {
      console.error(`tangen knowledge: the index was built with ${indexedBy} (${meta.dimensions} dims) but config now says ${adapter.name} (${adapter.dimensions} dims).`)
      console.error('Re-run with --rebuild to wipe and re-embed with the new model.')
      process.exit(1)
    }

    // Gather sources
    const chunking = { size: kc.chunking?.size ?? 400, overlap: kc.chunking?.overlap ?? 60 }
    const types = await knowledgeSchemaTypes(args.configCwd, config)
    const tables = knowledge.knowledgeTables(config.customTables)
    const repoEntries = (kc.sources?.repo ?? []).map((e: any) =>
      typeof e === 'string' ? { glob: e, audience: 'public' as const } : { glob: e.glob, audience: e.audience ?? 'public' })
    const projectRoot = findProjectRoot(args.configCwd)

    const work: Array<{ kind: 'object' | 'table' | 'file' | 'qa'; run: () => Promise<{ action: string; chunks: number }>; words: number; label: string }> = []
    const deps = { store, adapter, chunking, workspaceId: args.workspaceId }

    for (const type of types) {
      if (!TABLE_NAME_RE.test(type.name)) continue
      const rows = await exec(
        `SELECT * FROM "${type.name}" WHERE workspace_id = $1 AND status = 'published'`,
        [args.workspaceId],
      ).catch(() => [] as Array<Record<string, unknown>>)
      for (const row of rows) {
        const fields = knowledge.knowledgeFields(type)
        const words = knowledge.estimateWords([String(row.title ?? ''), ...fields.map((f) => String(row[f] ?? ''))])
        work.push({ kind: 'object', words, label: `${type.name}/${row.id}`, run: () => knowledge.syncObject(deps, type, row) })
      }
    }

    for (const table of tables) {
      if (!TABLE_NAME_RE.test(table.name)) continue
      const rows = await exec(`SELECT * FROM "${table.name}" WHERE workspace_id = $1`, [args.workspaceId])
        .catch(() => [] as Array<Record<string, unknown>>)
      for (const row of rows) {
        const words = knowledge.estimateWords(table.columns.map((c) => String(row[c] ?? '')))
        work.push({ kind: 'table', words, label: `${table.name}/${row.id}`, run: () => knowledge.syncTableRow(deps, table, row) })
      }
    }

    for (const entry of repoEntries) {
      for await (const path of new Bun.Glob(entry.glob).scan({ cwd: projectRoot })) {
        if (!/\.(md|txt)$/i.test(path)) continue
        const text = await Bun.file(join(projectRoot, path)).text()
        work.push({
          kind: 'file', words: knowledge.estimateWords([text]), label: path,
          run: () => knowledge.syncDocument(deps, { sourceKind: 'file', sourceId: path, group: 'repo', text, audience: entry.audience, metadata: { path } }),
        })
      }
    }

    // --docs: index the project's own docs (dev-time doc RAG for `ask_docs`),
    // no sources.repo glob required. Grouped 'docs' so it is easy to spot/rebuild.
    if (args.docs) {
      const seen = new Set(work.filter((w) => w.kind === 'file').map((w) => w.label))
      for await (const path of new Bun.Glob('docs/**/*.md').scan({ cwd: projectRoot })) {
        if (seen.has(path)) continue
        const text = await Bun.file(join(projectRoot, path)).text()
        work.push({
          kind: 'file', words: knowledge.estimateWords([text]), label: path,
          run: () => knowledge.syncDocument(deps, { sourceKind: 'file', sourceId: path, group: 'docs', text, audience: 'public', metadata: { path } }),
        })
      }
    }

    // Curated Q&A pairs (admin-managed) — synced like any other source;
    // disabled rows get their chunks removed by syncQa
    const qaStore = knowledge.createQaStore(exec)
    const qaRows: Awaited<ReturnType<typeof qaStore.list>>['rows'] = []
    try {
      for (let offset = 0; ; offset += 200) {
        const page = await qaStore.list(args.workspaceId, { limit: 200, offset })
        qaRows.push(...page.rows)
        if (page.rows.length < 200) break
      }
    } catch { /* knowledge_qa absent - no pairs yet */ }
    for (const qa of qaRows) {
      work.push({
        kind: 'qa', words: knowledge.estimateWords([qa.question, qa.answer]), label: `qa/${qa.id}`,
        run: () => knowledge.syncQa(deps, qa),
      })
    }

    const totalWords = work.reduce((n, w) => n + w.words, 0)
    const tokens = Math.round(totalWords * 1.3)
    console.log(`Index plan - ${work.length} sources, ~${totalWords.toLocaleString()} words (≈${tokens.toLocaleString()} tokens) via ${adapter.name}${args.rebuild ? ' [REBUILD]' : ''}`)
    if (work.length === 0) {
      console.log('Nothing to index - opt types in with knowledge:{enabled:true} and fields with knowledge:true.')
      return
    }
    if (!args.yes) {
      process.stdout.write('Proceed? [y/N] ')
      const answer = await new Promise<string>((res) => {
        process.stdin.once('data', (d) => res(String(d).trim().toLowerCase()))
      })
      if (answer !== 'y' && answer !== 'yes') {
        console.log('Aborted.')
        return
      }
    }

    if (args.rebuild) {
      await exec(`DELETE FROM knowledge_chunks WHERE workspace_id = $1`, [args.workspaceId])
    }
    // The tables are @tangen/db's (migration 0041); this pins the vector space
    // to the configured model - the one configuration-driven DDL step, owned there.
    const { pinKnowledgeVectorSpace } = await import('@tangen/db')
    await pinKnowledgeVectorSpace(exec, adapter.dimensions)
    await store.setMeta(args.workspaceId, {
      ...knowledge.splitAdapterName(adapter.name), dimensions: adapter.dimensions,
    })

    let indexed = 0, skipped = 0, failed = 0
    for (const item of work) {
      try {
        const r = await item.run()
        if (r.action === 'skipped') skipped++
        else indexed++
        process.stdout.write(`\r  ${indexed + skipped + failed}/${work.length}  indexed ${indexed} · skipped ${skipped} · failed ${failed}   `)
      } catch (e) {
        failed++
        console.error(`\n  ✗ ${item.label}: ${(e as Error).message}`)
      }
    }
    console.log(`\nDone - indexed ${indexed}, skipped ${skipped} (unchanged), failed ${failed}.`)
  } finally {
    await db.end()
  }
}
