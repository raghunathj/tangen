/**
 * File Name: knowledge.ts
 * Purpose: Knowledge (RAG) configuration types — how a workspace opts its
 *          content into semantic search / ask. OFF by default at EVERY
 *          level: the config must enable it, types/tables must opt in, and
 *          fields are indexed only when explicitly allowed.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Consumed by the optional @tangen/knowledge package
 *          (pgvector store, embedding adapters, chunker) and the CLI
 *          (`tangen knowledge index|status`).
 */

/** Built-in embedding providers — all zero-dependency fetch adapters. */
export type EmbeddingProviderName =
  | 'openai'            // text-embedding-3-small/large
  | 'gemini'            // text-embedding-004 (free tier available)
  | 'voyage'            // what Anthropic recommends (Claude has no embeddings API)
  | 'ollama'            // self-hosted, free - nomic-embed-text, bge-m3, …
  | 'openai-compatible' // vLLM / LM Studio / llama.cpp / TEI / Together / … via baseUrl

/** A custom embedding adapter instance — wins over `provider` when set. */
export interface EmbeddingAdapter {
  name: string
  /** Vector dimension this adapter produces. */
  dimensions: number
  /** Embeds a batch of texts; must return one vector per input, in order. */
  embed: (texts: string[]) => Promise<number[][]>
}

export interface EmbeddingsConfig {
  provider?: EmbeddingProviderName
  /** Model name (provider-specific; required for ollama/openai-compatible). */
  model?: string
  /** Vector dimension — required unless the provider/model pair implies it. */
  dimensions?: number
  /** Base URL for ollama (default http://localhost:11434) / openai-compatible. */
  baseUrl?: string
  /**
   * In config: the NAME of the deployment variable holding the key (a
   * reference); per provider it defaults to OPENAI_API_KEY, GEMINI_API_KEY,
   * …, and to EMBEDDINGS_API_KEY for openai-compatible. The API and the CLI
   * resolve it to material before the adapter is built.
   */
  apiKey?: string
  /** Custom adapter instance — replaces provider/model/baseUrl entirely. */
  adapter?: EmbeddingAdapter
}

export interface KnowledgeSourcesConfig {
  /**
   * Repo file globs (relative to the project root) indexed at
   * `tangen knowledge index` time — the code-first knowledge base.
   * Markdown/txt only. Plain string = public; object form sets the
   * audience: { glob: 'internal-docs/**\/*.md', audience: 'internal' }.
   */
  repo?: Array<string | { glob: string; audience?: KnowledgeAudience }>
  /**
   * Media folder names whose DOCUMENT-category assets are extracted and
   * indexed. Core extracts text-native formats (md, txt, html, csv, json);
   * PDF/DOCX need an extractor package (e.g. @tangen/knowledge-pdf).
   * Plain string = public; { name, audience: 'internal' } scopes retrieval.
   */
  mediaFolders?: Array<string | { name: string; audience?: KnowledgeAudience }>
}

export interface KnowledgeConfig {
  /** Master switch — nothing indexes and no endpoint answers when false/absent. */
  enabled: boolean
  /**
   * Embedding model configuration. REQUIRED when enabled — there is no
   * silent default provider (enabling must never implicitly bill a key).
   */
  embeddings?: EmbeddingsConfig
  /** Chunking tuning (defaults: ~400 token-ish words per chunk, 60 overlap). */
  chunking?: { size?: number; overlap?: number }
  /** Document/file sources beyond content objects. */
  sources?: KnowledgeSourcesConfig
  /** Guardrail instructions appended to every /knowledge/ask generation. */
  ask?: { instructions?: string }
  /**
   * Document extractors for binary formats (PDF/DOCX/…) — extractor
   * packages export instances (e.g. @tangen/knowledge-pdf). Text-native
   * formats (md, txt, html, csv, json) work without any.
   */
  extractors?: Array<{
    name: string
    mimeTypes: string[]
    extract: (bytes: Uint8Array, filename: string) => Promise<string>
  }>
  /**
   * Curated Q&A tuning. `boost` multiplies the retrieval score of Q&A
   * chunks (default 1.15) so a vetted answer beats raw content at equal
   * relevance; 1 disables the boost.
   */
  qa?: { boost?: number }
  /**
   * Query-insights logging (default true). Retrievals record what was
   * asked and how well the index answered — the AI → Insights backlog.
   * Query text is end-user input: truncated to 500 chars, pruned at 90
   * days. Set false to log nothing.
   */
  insights?: boolean
}

/** Identity builder for app/config/knowledge.ts. */
export function defineKnowledgeConfig(config: KnowledgeConfig): KnowledgeConfig {
  return config
}

/** Who may retrieve a chunk — enforced INSIDE the vector SQL, never after. */
export type KnowledgeAudience = 'public' | 'internal'

/** Per-type opt-in (ObjectTypeDefinition.knowledge). Types are OFF until this. */
export interface TypeKnowledgeConfig {
  enabled: boolean
  /**
   * Retrieval audience for this type's chunks (default 'public').
   * 'internal' chunks are invisible to keys without the internal audience
   * grant — e.g. runbooks powering a staff-only assistant.
   */
  audience?: KnowledgeAudience
}

/** Per-custom-table opt-in (CustomTableDefinition.knowledge). */
export interface TableKnowledgeConfig {
  enabled: boolean
  /** Text columns to index — explicit, like field-level opt-in. */
  columns: string[]
  /** Retrieval audience for this table's chunks (default 'public'). */
  audience?: KnowledgeAudience
}
