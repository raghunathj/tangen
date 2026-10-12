/**
 * File Name: config.ts
 * Purpose: Knowledge config resolution — per-environment override wins over
 *          the workspace config; everything defaults OFF. Enabling without
 *          an embeddings config is a hard, helpful error (never a silent
 *          default that bills someone's API key).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types only.
 */
import type {
  KnowledgeConfig, EmbeddingsConfig, WorkspaceProject,
  ObjectTypeDefinition, CustomTableDefinition,
} from '@tangen/types'

export interface ResolvedKnowledgeConfig {
  enabled: boolean
  embeddings?: EmbeddingsConfig
  chunking: { size: number; overlap: number }
  sources: {
    repo: Array<{ glob: string; audience: 'public' | 'internal' }>
    mediaFolders: Array<{ name: string; audience: 'public' | 'internal' }>
  }
  askInstructions?: string
  extractors: NonNullable<KnowledgeConfig['extractors']>
  /** Retrieval score multiplier for curated Q&A chunks (default 1.15). */
  qaBoost: number
  /** Query-insights logging (default on; knowledge.insights: false disables). */
  insights: boolean
}

const DISABLED: ResolvedKnowledgeConfig = {
  enabled: false,
  chunking: { size: 400, overlap: 60 },
  sources: { repo: [], mediaFolders: [] },
  extractors: [],
  qaBoost: 1.15,
  insights: false,
}

/** Normalizes 'glob' | {glob,audience} source entries (default public). */
function normalizeRepo(entries: unknown): Array<{ glob: string; audience: 'public' | 'internal' }> {
  return ((entries ?? []) as Array<string | { glob: string; audience?: 'public' | 'internal' }>)
    .map((e) => typeof e === 'string' ? { glob: e, audience: 'public' as const } : { glob: e.glob, audience: e.audience ?? 'public' })
}

function normalizeFolders(entries: unknown): Array<{ name: string; audience: 'public' | 'internal' }> {
  return ((entries ?? []) as Array<string | { name: string; audience?: 'public' | 'internal' }>)
    .map((e) => typeof e === 'string' ? { name: e, audience: 'public' as const } : { name: e.name, audience: e.audience ?? 'public' })
}

export const PROVIDER_MENU = `Configure embeddings in app/config/knowledge.ts - there is no default provider.
Free / self-hosted:  { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768 }
Cheapest hosted:     { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 }
Also built in:       'gemini', 'voyage', 'openai-compatible' (any vLLM/LM Studio/TEI baseUrl), or a custom adapter instance.`

/** project.knowledge > disabled. */
export function resolveKnowledgeConfig(project: WorkspaceProject | undefined): ResolvedKnowledgeConfig {
  const config = (project as { knowledge?: KnowledgeConfig } | undefined)?.knowledge
  if (!config?.enabled) return DISABLED
  return {
    enabled: true,
    embeddings: config.embeddings,
    chunking: {
      size: config.chunking?.size ?? 400,
      overlap: config.chunking?.overlap ?? 60,
    },
    sources: {
      repo: normalizeRepo(config.sources?.repo),
      mediaFolders: normalizeFolders(config.sources?.mediaFolders),
    },
    askInstructions: config.ask?.instructions,
    extractors: config.extractors ?? [],
    qaBoost: config.qa?.boost ?? 1.15,
    insights: config.insights !== false,
  }
}

/** Throws the provider menu when knowledge is enabled without embeddings. */
export function requireEmbeddingsConfig(config: ResolvedKnowledgeConfig): EmbeddingsConfig {
  if (!config.embeddings || (!config.embeddings.provider && !config.embeddings.adapter)) {
    throw new Error(`Knowledge is enabled but no embedding provider is configured.\n${PROVIDER_MENU}`)
  }
  return config.embeddings
}

/** Types opted into knowledge (both levels must agree). */
export function knowledgeTypes(types: ObjectTypeDefinition[]): ObjectTypeDefinition[] {
  // TL-2: disabled types drop out of retrieval + embedding, like every other surface
  return types.filter((t) => t.knowledge?.enabled === true && t.disabled !== true)
}

/** Retrieval audience for a type's chunks (default 'public'). */
export function typeAudience(type: ObjectTypeDefinition): 'public' | 'internal' {
  return type.knowledge?.audience ?? 'public'
}

/** Field names of a type that are explicitly opted in (`knowledge: true`). */
export function knowledgeFields(type: ObjectTypeDefinition): string[] {
  return type.fields
    .filter((f) => (f as { config?: { knowledge?: boolean } }).config?.knowledge === true)
    .map((f) => f.name)
}

/** Custom tables opted into knowledge with their indexed columns. */
export function knowledgeTables(
  tables: CustomTableDefinition[] | undefined,
): Array<{ name: string; columns: string[]; audience: 'public' | 'internal' }> {
  return (tables ?? [])
    .filter((t) => t.knowledge?.enabled === true && (t.knowledge.columns?.length ?? 0) > 0)
    .map((t) => ({ name: t.name, columns: t.knowledge!.columns, audience: t.knowledge!.audience ?? 'public' }))
}
