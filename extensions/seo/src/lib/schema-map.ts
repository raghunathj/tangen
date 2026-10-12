/**
 * File Name: schema-map.ts
 * Purpose: The per-content-type JSON-LD mapping (plan-seo-next Phase 2). One
 *          validated store shape binding a content type to a schema kind and a
 *          field mapping (schema property -> content field name), plus the list
 *          of selectable kinds. Pure, so the Schemas tab and the resolve layer
 *          read the same trusted shape and a bad map never reaches /meta. The
 *          builder that turns a config into a node lives in schemas.ts.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** Per-content-type kinds. Organization/WebSite are site-level (from settings). */
export type SchemaKind = 'Article' | 'BlogPosting' | 'WebPage' | 'Product' | 'Person'

/** The kinds a type may be mapped to. `none` and site-level entities excluded. */
export const SCHEMA_KINDS: SchemaKind[] = ['Article', 'BlogPosting', 'WebPage', 'Product', 'Person']

export interface TypeSchemaConfig {
  kind: SchemaKind
  /** schema property -> content field name (e.g. { headline: 'title' }). */
  fieldMap: Record<string, string>
}

/** type name -> its schema config. A type absent here emits no per-type node. */
export type SchemaMap = Record<string, TypeSchemaConfig>

export const SEO_SCHEMA_MAP_KEY = 'schema-map'
export const DEFAULT_SCHEMA_MAP: SchemaMap = {}

/**
 * The schema properties a kind can map to a content field. The label property
 * (headline / name) comes first. Shared by the builder and the Schemas tab so
 * both agree on what is mappable.
 */
export function schemaPropsFor(kind: SchemaKind | 'none'): string[] {
  switch (kind) {
    case 'Article':
    case 'BlogPosting': return ['headline', 'description', 'image', 'datePublished', 'dateModified', 'author']
    case 'WebPage': return ['name', 'description', 'image']
    case 'Product': return ['name', 'description', 'image', 'sku', 'brand']
    case 'Person': return ['name', 'description', 'image']
    default: return []
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The one validated read path: unknown kinds, `none`, and junk fields dropped. */
export function normalizeSchemaMap(raw: unknown): SchemaMap {
  const src = isRecord(raw) ? raw : {}
  const out: SchemaMap = {}
  for (const [type, cfg] of Object.entries(src)) {
    if (!isRecord(cfg)) continue
    if (!SCHEMA_KINDS.includes(cfg.kind as SchemaKind)) continue // drops 'none' and unknown
    const fieldMap: Record<string, string> = {}
    if (isRecord(cfg.fieldMap)) {
      for (const [prop, field] of Object.entries(cfg.fieldMap)) {
        if (typeof field === 'string' && field.trim() !== '') fieldMap[prop] = field.trim()
      }
    }
    out[type] = { kind: cfg.kind as SchemaKind, fieldMap }
  }
  return out
}
