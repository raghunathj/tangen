/**
 * File Name: search-engine.ts
 * Purpose: The content-search ENGINE contract - the seam that was missing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Tangen already had the SOURCE half of search:
 *   `SearchProvider` fans out over content, users, forms and extensions. What it
 *   did not have was an engine seam, so `contentProvider` called a search
 *   implementation directly and one datastore was welded into the one source
 *   that needs indexing. Everything here is provider-neutral: no caller, and no
 *   extension, should ever name PostgreSQL or any other engine.
 *
 *   Exactly one engine ships today. The contract is not therefore redundant -
 *   it is what lets a future ParadeDB or Typesense provider slot in without a
 *   caller changing, and the tests prove it holds by driving the same provider
 *   against a fake engine.
 *
 *   Capabilities are declared rather than assumed, because they genuinely
 *   differ. The native PostgreSQL engine cannot segment Chinese, Japanese,
 *   Korean or Thai - PostgreSQL's parser treats a whole CJK phrase as one
 *   lexeme - and it must say so rather than return quietly poor relevance.
 */

/** What an engine can actually do. Callers degrade against this, never guess. */
export interface SearchEngineCapabilities {
  /** Ranked full-text matching. Every engine must have this. */
  fullText: boolean
  /** Anchored title/slug prefix, for autocomplete. */
  prefix: boolean
  /** Typo tolerance. Opt-in: on PostgreSQL it costs more than full text does. */
  fuzzy: boolean
  /** Grouped counts alongside results. */
  facets: boolean
  /** Snippet generation. */
  highlight: boolean
  /** Whether writes land with the content transaction or behind a queue. */
  consistency: 'transactional' | 'eventual'
  /** Language handling, stated honestly - see `describeLanguageSupport`. */
  languages: {
    /** Locales this engine stems properly. */
    stemmed: string[]
    /** Locales it indexes but cannot segment or stem - relevance will be poor. */
    unsupported: string[]
  }
}

/** One document as the engine stores it. `locale` is part of the identity. */
export interface SearchDocumentInput {
  workspaceId: string
  /** 'content' | 'media' | 'ext:<extensionId>:<sourceId>'. */
  source: string
  typeSlug: string
  objectId: string
  locale: string
  title: string
  slug: string | null
  /** Full searchable text. */
  body: string
  /** Bounded snippet source; highlighting never touches `body`. */
  excerpt: string
  status: string
  isPublished: boolean
  metadata?: Record<string, unknown>
}

/** The identity of a document, without its content. */
export interface SearchDocumentRef {
  workspaceId: string
  source: string
  typeSlug: string
  objectId: string
  locale?: string
}

export interface EngineQuery {
  workspaceId: string
  query: string
  /** 'public' sees published only; 'internal' sees what the caller was allowed. */
  audience: 'internal' | 'public'
  locale?: string
  typeSlug?: string
  source?: string
  /** Types the caller may read. Undefined means no type restriction. */
  allowedTypes?: string[]
  limit: number
  offset?: number
  /** Metadata dimensions to count, derived from ONE materialised match set. */
  facets?: string[]
  highlight?: boolean
  /** Ask for typo tolerance. Ignored by engines without the capability. */
  fuzzy?: boolean
}

export interface EngineHit {
  objectId: string
  source: string
  typeSlug: string
  locale: string
  title: string
  slug: string | null
  status: string
  isPublished: boolean
  score: number
  highlight?: string
  metadata?: Record<string, unknown>
}

export interface EngineResult {
  hits: EngineHit[]
  facets?: Record<string, Array<{ value: string; count: number }>>
  /** True when the engine stopped early (timeout, or the result cap). */
  truncated?: boolean
}

/**
 * A content-search engine. Indexing methods accept an optional transaction so a
 * transactional engine can write with the content mutation and add no network
 * round trip; an eventual engine ignores it and is driven by the queue.
 */
export interface SearchEngine {
  readonly id: string
  readonly capabilities: SearchEngineCapabilities
  search(q: EngineQuery): Promise<EngineResult>
  /** Anchored prefix over title and slug. Never a ranked body scan. */
  suggest(q: Omit<EngineQuery, 'facets' | 'highlight'>): Promise<EngineHit[]>
  index(docs: SearchDocumentInput[], tx?: unknown): Promise<void>
  /**
   * Write only documents that do not exist yet.
   *
   * Backfill's window is between reading a content row and writing its
   * document: an editor saving in that gap writes the current document
   * transactionally, and an unconditional backfill write would then replace it
   * with the copy it read beforehand - search serving older text with nothing
   * failing and nothing to notice. Backfill exists to fill gaps, so it must
   * never win a conflict.
   */
  indexIfAbsent(docs: SearchDocumentInput[], tx?: unknown): Promise<void>
  remove(refs: SearchDocumentRef[], tx?: unknown): Promise<void>
  /** Drop everything a source owns - how an extension uninstall cleans up. */
  removeSource(workspaceId: string, source: string): Promise<number>
}

// ── Language support ─────────────────────────────────────────────────────────

/**
 * PostgreSQL text-search configurations, by the locale prefix Tangen uses.
 * Anything absent falls back to `simple`, which still gives exact and prefix
 * matching - just no stemming.
 */
export const PG_TEXT_CONFIGS: Record<string, string> = {
  ar: 'arabic', hy: 'armenian', eu: 'basque', ca: 'catalan', da: 'danish',
  nl: 'dutch', en: 'english', fi: 'finnish', fr: 'french', de: 'german',
  el: 'greek', hi: 'hindi', hu: 'hungarian', id: 'indonesian', ga: 'irish',
  it: 'italian', lt: 'lithuanian', ne: 'nepali', no: 'norwegian', pt: 'portuguese',
  ro: 'romanian', ru: 'russian', sr: 'serbian', es: 'spanish', sv: 'swedish',
  ta: 'tamil', tr: 'turkish', yi: 'yiddish',
}

/**
 * Languages PostgreSQL's default parser cannot segment at all. It splits on
 * whitespace and punctuation, so a Japanese sentence becomes ONE lexeme and
 * only an exact whole-string match can ever find it. Declared rather than
 * discovered by a user whose search returns nothing.
 */
export const PG_UNSEGMENTED_LOCALES = ['zh', 'ja', 'ko', 'th', 'lo', 'km', 'my'] as const

/** The text-search configuration for a locale, or `simple` when there is none. */
export function textConfigForLocale(locale: string | null | undefined): string {
  if (!locale) return 'simple'
  return PG_TEXT_CONFIGS[locale.toLowerCase().split(/[-_]/)[0]!] ?? 'simple'
}

/** True when this engine cannot meaningfully tokenize the locale's script. */
export function isUnsegmentedLocale(locale: string | null | undefined): boolean {
  if (!locale) return false
  return (PG_UNSEGMENTED_LOCALES as readonly string[]).includes(locale.toLowerCase().split(/[-_]/)[0]!)
}

/** The honest language section of a PostgreSQL engine's capabilities. */
export function describeLanguageSupport(): SearchEngineCapabilities['languages'] {
  return { stemmed: Object.keys(PG_TEXT_CONFIGS).sort(), unsupported: [...PG_UNSEGMENTED_LOCALES] }
}
