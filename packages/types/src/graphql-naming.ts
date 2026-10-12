/**
 * File Name: graphql-naming.ts
 * Purpose: Deterministic GraphQL name derivation from content type names —
 *          a content type 'post' → object type 'Post', list query 'posts',
 *          single query 'post', 'PostConnection', 'PostWhereInput', 'PostOrderBy'.
 *          Lives in @tangen/types (the shared root) so BOTH @tangen/graphql (the
 *          schema builder / resolvers) and @tangen/schema (push-time collision
 *          validation) derive names from ONE definition — no drift between what
 *          push rejects and what GraphQL would actually generate.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** 'blog_post' / 'blog-post' → 'BlogPost'. */
export function pascal(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

function camel(name: string): string {
  const p = pascal(name)
  return p.charAt(0).toLowerCase() + p.slice(1)
}

/** Naive-but-adequate pluralization for the list query field. */
export function pluralize(name: string): string {
  const c = camel(name)
  if (/[^aeiou]y$/.test(c)) return `${c.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/.test(c)) return `${c}es`
  return `${c}s`
}

/**
 * A content-type name that already reads as plural (products, categories) — but
 * NOT a singular word that merely ends in s (address, status, analysis). Used so
 * a plural type name isn't double-pluralized ('products' → 'productses').
 */
function looksPlural(c: string): boolean {
  return /s$/.test(c) && !/(ss|us|is)$/.test(c)
}

/** Best-effort English singular for the single-item query (irregulars pass through). */
export function singularize(name: string): string {
  const c = camel(name)
  if (!looksPlural(c)) return c
  if (/ies$/.test(c)) return `${c.slice(0, -3)}y`                  // categories → category
  if (/(sses|shes|ches|xes|zes)$/.test(c)) return c.slice(0, -2)   // boxes → box, dishes → dish
  return c.slice(0, -1)                                            // products → product
}

/**
 * Nouns that read as plural but are invariant/uncountable — their singular is
 * themselves. Naive singularization would mangle the OBJECT TYPE name
 * (`news` → `New`, `series` → `Sery`), so the type name keeps them intact.
 * Matched case-insensitively on the camelCased name.
 */
const INVARIANT_TYPE_NAMES = new Set([
  'news', 'series', 'species', 'analytics', 'statistics', 'physics',
  'mathematics', 'economics', 'media', 'metadata',
])

// The GraphQL object type is SINGULAR by convention — a content type named
// 'products' exposes type `Product` with fields `product` / `products`.
// singularize() returns camelCase; pascal() re-cases it (and folds 'blog_posts'
// → 'BlogPost'). Already-singular and invariant names ('post', 'news', 'series')
// pass through unchanged. This is also the collision KEY: two content-type names
// producing the same typeName() would generate the same GraphQL type — push
// blocks that. (Only the type name is invariant-guarded; the single/list query
// fields keep their historical derivation.)
export const typeName = (name: string): string => {
  const c = camel(name)
  return pascal(INVARIANT_TYPE_NAMES.has(c.toLowerCase()) ? c : singularize(name))
}
// Plural-aware query fields: a plural type name yields single "product" / list
// "products" (never "productses"), a singular name yields "product" / "products".
export const singleQueryName = (name: string): string => singularize(name)
export const listQueryName = (name: string): string =>
  looksPlural(camel(name)) ? camel(name) : pluralize(name)
/**
 * List query field name honoring an explicit `plural` override — the escape
 * hatch for irregulars inflection can't compute (`person` + plural 'people' →
 * `people`). Falls back to inflected listQueryName when no override is set.
 */
export const listQueryNameFor = (name: string, plural?: string | null): string =>
  plural ? camel(plural) : listQueryName(name)
// Derived type names track the (singular) object type so they never reintroduce
// the plural: `ProductConnection`, `ProductWhereInput`, `ProductOrderBy`.
export const connectionName = (name: string): string => `${typeName(name)}Connection`
export const whereInputName = (name: string): string => `${typeName(name)}WhereInput`
export const orderByName = (name: string): string => `${typeName(name)}OrderBy`
