/**
 * File Name: contract.ts
 * Purpose: The SEO contract (closure plan Phase 9A). Two shapes and one
 *          boundary: what an editor STORES, what a website RECEIVES, and the
 *          one function only the consuming application can supply - how its
 *          own URLs are built.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Types and pure constants only, so this module is
 *          importable from a browser panel, a server route and a framework
 *          adapter alike. Phase 6B settled that Tangen resolves content
 *          IDENTITY and the application resolves site ROUTING; every absolute
 *          URL in here therefore arrives from the application or is omitted.
 *          Nothing here invents one.
 */

// ── Robots ───────────────────────────────────────────────────────────────────

/**
 * The two directives with a concrete v1 consumer. Typed rather than free text
 * so an editor cannot write `noindex,index` and so serialization is one
 * function with one output per input.
 */
export interface SeoRobots {
  index: boolean
  follow: boolean
}

export const DEFAULT_ROBOTS: SeoRobots = { index: true, follow: true }

// ── Social ───────────────────────────────────────────────────────────────────

/** Open Graph values. One set, shared by every network that reads OG. */
export interface SeoSocial {
  title?: string | null
  description?: string | null
  /** Media IDENTITY, never a storage path - the URL is resolved at read time. */
  imageId?: string | null
  /** og:type. Free text by the vocabulary's nature; 'website' when unset. */
  type?: string | null
  /** og:image:alt - what the share image shows (S3). Base-only; emitted only beside a resolved image. */
  imageAlt?: string | null
}

// ── Structured data ──────────────────────────────────────────────────────────

/** One JSON-LD node. `@type` is required; everything else is the vocabulary's. */
export interface JsonLdNode {
  '@type': string
  '@id'?: string
  [key: string]: unknown
}

/** Bounds: structure is validated, vocabulary is the author's responsibility. */
export const STRUCTURED_DATA_LIMITS = {
  maxNodes: 20,
  /** Serialized bytes for the whole array. */
  maxBytes: 32_768,
  maxDepth: 12,
} as const

// ── Stored editorial metadata ────────────────────────────────────────────────

/**
 * What an editor writes. Every field is an OVERRIDE: absent means "fall back",
 * never "empty". A field is either localized or it is not, and the split is
 * deliberate - see `SeoStored`.
 */
export interface SeoLocalizedMetadata {
  title?: string | null
  description?: string | null
  social?: SeoSocial | null
  /**
   * An absolute canonical the editor states outright, overriding whatever the
   * application would resolve. Localized because a site may point each
   * language at a different canonical.
   */
  canonicalOverride?: string | null
}

/** One frequently-asked question and its answer (for FAQPage JSON-LD / GEO). */
export interface FaqItem {
  question: string
  answer: string
}

/** Editorial metadata that is the same in every language. */
export interface SeoSharedMetadata {
  robots?: SeoRobots | null
  /** Keep this object out of the sitemap without touching robots. */
  sitemapExclude?: boolean | null
  structuredData?: JsonLdNode[] | null
  /** The existing editorial aid. Never leaves the Admin. */
  focusKeyword?: string | null
  /** Q/A pairs rendered as FAQPage JSON-LD - lifted by search and AI engines. */
  faqs?: FaqItem[] | null
  /**
   * A concise, factual summary written for AI answer engines to extract and
   * cite (GEO). Surfaced in the resolved output for the site to render.
   */
  answerSummary?: string | null
}

export type SeoMetadata = SeoLocalizedMetadata & SeoSharedMetadata

/**
 * The row an object's SEO occupies in `extension_data`.
 *
 * `draft` is what the editor sees; `published` is what a website sees, and it
 * is written only when the object publishes.
 *
 * CORRECTION (Phase 9D): Phase 9A said this pair existed because
 * `extension_data.published_data` had no writer. That finding was wrong - the
 * column has had one on the publish path all along, and Phase 9D gave it the
 * rest of the lifecycle plus `ctx.extensionData.getPublished`.
 *
 * The pair stays anyway, and now for a reason rather than for a mistake: it is
 * a PAYLOAD-level snapshot, so the locale dimension this extension carries
 * inside `data` travels with it, Porter moves both halves as one value, and
 * the promote/clear pair below is already symmetric on unpublish. An extension
 * that wants the platform's snapshot instead should call `getPublished`.
 *
 * A payload from before this contract is a bare `SeoMetadata`; `readStored`
 * accepts it as the draft base, so no migration and no data loss.
 */
/**
 * The current stored-payload schema version. It is stamped on every row this
 * module writes so a future shape change can be migrated in `readStored`
 * deterministically, instead of inferring an old row's meaning from its keys.
 * Bump this ONLY alongside a migration branch in `readStored`.
 */
export const SEO_SCHEMA_VERSION = 1

export interface SeoStored {
  /** Present on every row written since v1; absent on pre-versioning rows. */
  schemaVersion?: number
  draft: SeoScoped
  published?: SeoScoped
}

/**
 * One snapshot: values shared by every locale, plus per-locale overrides.
 * `extension_data` has no locale column, so the extension carries the locale
 * dimension inside its own payload and says so.
 */
export interface SeoScoped {
  base: SeoMetadata
  locales?: Record<string, SeoLocalizedMetadata>
}

// ── The resolved representation ──────────────────────────────────────────────

/**
 * What a website receives. Precedence has already been applied, so a frontend
 * never reconstructs Tangen's rules - that is the whole point of the shape.
 * Editorial-only state (the focus keyword, the checklist) is not in it.
 */
export interface ResolvedSeo {
  title?: string
  description?: string
  /** Absent when nothing could resolve one. Never a guess. */
  canonical?: string
  robots: SeoRobots & { content: string }
  openGraph?: {
    title?: string
    description?: string
    /** Absolute, from the media URL boundary; absent if it cannot resolve. */
    image?: string
    /** og:image:alt, only beside `image` (S3). */
    imageAlt?: string
    type?: string
    url?: string
  }
  structuredData: JsonLdNode[]
  /** Only locales whose URL actually resolved. Never fabricated. */
  alternates?: Array<{ hreflang: string; href: string }>
  /** The GEO answer summary, when the editor wrote one. Absent otherwise. */
  answerSummary?: string
}

// ── The application boundary ─────────────────────────────────────────────────

/** What the resolver is asked about. Identity, never a path. */
export interface SeoUrlInput {
  workspaceId: string
  type: string
  id: string
  locale?: string | null
  /** The object's slug, for a site whose routing uses it. Advisory only. */
  slug?: string | null
  /**
   * The value of the field the site DECLARED as this type's URL
   * (`urlField`), when there is one and the object has it. Absent otherwise,
   * so a resolver that only needs the slug never sees it.
   */
  fieldValue?: string | null
}

/**
 * The one thing Tangen cannot know. Returning `null` is a legitimate answer
 * and means "this object has no page"; every artifact that needs a URL omits
 * the object rather than inventing one.
 */
export type SeoUrlResolver = (input: SeoUrlInput) => string | null | Promise<string | null>

/** Resolves a media id to an absolute URL, for sites serving media from a CDN. */
export type SeoMediaUrlResolver = (input: { workspaceId: string; mediaId: string }) => string | null | Promise<string | null>

/** A robots.txt group. Paths are written as the file writes them. */
export interface RobotsTxtGroup {
  userAgents: string[]
  allow?: string[]
  disallow?: string[]
}

export interface RobotsTxtDocument {
  groups: RobotsTxtGroup[]
  sitemaps?: string[]
  /** Verbatim extra lines, appended last. */
  custom?: string[]
}

/**
 * Everything the consuming application declares, spread into the SEO
 * extension's entry options - the convention Flows already established for
 * site-supplied functions (`defineFlowHelpers`).
 */
export interface SeoHelpers {
  /** The site's origin, e.g. 'https://example.com'. Used for sitemap references. */
  siteUrl?: string
  /**
   * Which FIELD holds a type's URL path, for a site that routes by a field
   * rather than the slug: `{ page: 'path' }`, or one name for every type.
   * Tangen reads that one field - never the whole object - and, with
   * `siteUrl`, that is enough on its own: a type listed here needs no
   * `resolveUrl`. Most sites route by slug and need none of this.
   */
  urlField?: string | Record<string, string>
  /**
   * How this application builds a URL for a content object. Takes precedence
   * over `urlField`, and receives that field's value as `fieldValue` when one
   * is declared, so a resolver can prefix or localise it.
   */
  resolveUrl?: SeoUrlResolver
  /** How this application builds an absolute media URL. */
  resolveMediaUrl?: SeoMediaUrlResolver
  /** Locales to offer as sitemap alternates; only resolvable ones are emitted. */
  locales?: string[]
  /** Last-resort title and description when the content has neither. */
  fallback?: (input: SeoUrlInput) => { title?: string; description?: string } | undefined
  /** Site-wide JSON-LD, merged under every object's own nodes. */
  structuredData?: JsonLdNode[]
  /** Content types eligible for the sitemap. Absent = every type. */
  sitemapTypes?: string[]
  /** The robots.txt served where the environment holds the production role. */
  robotsTxt?: RobotsTxtDocument
  /**
   * The robots.txt served everywhere else. Absent means the safe default:
   * disallow everything, so a staging site is never indexed by accident.
   */
  nonProductionRobotsTxt?: RobotsTxtDocument
}

/** Identity builder for site developers (app/config/extensions.ts options). */
export function defineSeoHelpers(helpers: SeoHelpers): SeoHelpers {
  return helpers
}
