/**
 * File Name: label-inflection.ts
 * Purpose: The singular of a human label, for UI text that acts on ONE item.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Separate from `graphql-naming`'s `singularize` on
 *          purpose. That one builds an IDENTIFIER and camelCases, so it folds
 *          'Blog Posts' to 'blogPost'; a label is prose and keeps its words
 *          and its casing. The two share the inflection RULES and nothing else.
 *
 *          Best-effort by design: English irregulars ('People' -> 'Person')
 *          are not guessable, so `admin.labelSingular` is the escape hatch and
 *          this function leaves them alone rather than mangling them.
 */

/**
 * Nouns that read as plural but have no distinct singular. Without these,
 * 'News' becomes 'New' and 'Series' becomes 'Serie'.
 */
const UNCOUNTABLE = new Set([
  'news', 'series', 'species', 'analytics', 'statistics', 'physics',
  'mathematics', 'economics', 'media', 'metadata', 'data',
])

/** Ends in `s` as a PLURAL, not as part of a singular word (status, address, analysis). */
const readsPlural = (word: string): boolean => /s$/.test(word) && !/(ss|us|is)$/.test(word)

/** The singular of one word, preserving its case. */
function singularWord(word: string): string {
  if (UNCOUNTABLE.has(word.toLowerCase())) return word
  if (!readsPlural(word)) return word
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`                  // Categories -> Category
  if (/(sses|shes|ches|xes|zes)$/.test(word)) return word.slice(0, -2)   // Boxes -> Box
  return word.slice(0, -1)                                               // Posts -> Post
}

/** The plural of one word, preserving its case. */
function pluralWord(word: string): string {
  if (UNCOUNTABLE.has(word.toLowerCase())) return word
  if (readsPlural(word)) return word                                   // Posts stays Posts
  if (/[^aeiouAEIOU]y$/.test(word)) return `${word.slice(0, -1)}ies`   // Category -> Categories
  if (/[aeiouAEIOU]z$/.test(word)) return `${word}zes`                 // Quiz -> Quizzes
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`                 // Box -> Boxes
  return `${word}s`
}

/** The last word of a label, which is its head noun in every shape we have. */
function inflectHead(label: string, inflect: (word: string) => string): string {
  if (!label.trim()) return label
  const words = label.split(' ')
  for (let i = words.length - 1; i >= 0; i--) {
    if (!words[i]) continue                       // a double space: keep looking left
    words[i] = inflect(words[i]!)
    break
  }
  return words.join(' ')
}

/**
 * A collection label made singular: 'Posts' -> 'Post', 'Blog Posts' ->
 * 'Blog Post', 'News' -> 'News'.
 *
 * Only the LAST word is inflected, because that is the head noun in every
 * label shape we have ('Case Studies', 'Press Releases'). Whitespace is
 * returned as given, so a caller needs no empty-string guard.
 */
export const singularLabel = (label: string): string => inflectHead(label, singularWord)

/**
 * A type label made plural: 'Post' -> 'Posts', 'Case Study' -> 'Case Studies',
 * 'News' -> 'News'. A label that already reads plural is returned unchanged,
 * so this is safe to apply to a label of unknown number.
 */
export const pluralLabel = (label: string): string => inflectHead(label, pluralWord)
