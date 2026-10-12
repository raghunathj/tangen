/**
 * File Name: suggestions.ts
 * Purpose: Studio-made sections built OVER a developer's components. A site
 *          that registers a `ProductCard` gets sensible ready-made sections
 *          using it - without anyone authoring presets for them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Shapes are DERIVED from the component's own schema,
 *          which is the only honest signal available: a headline of its own
 *          suggests a banner, a relation means it renders one record so
 *          several side by side is the obvious composition, and a repeater
 *          means it already lists internally so a grid would be wrong.
 *
 *          Offered, never imposed - these surface as a palette group beside
 *          saved presets, and inserting one is an ordinary insert.
 *
 *          Two refusals, matching autosection.ts: nothing is suggested that
 *          the blocks field does not allow, and kit blocks get nothing
 *          because the starter gallery (B-T7) already covers them.
 */

/** The slice of a component def these heuristics read. */
export interface SuggestDef {
  name: string
  label?: string
  fields?: Array<{ name: string; fieldType: string }>
}

export interface SectionSuggestion {
  id: string
  name: string
  block: Record<string, unknown>
}

/** Field names that read as a component's own headline. */
const HEADLINE_NAMES = ['heading', 'title', 'headline']

const has = (def: SuggestDef, pred: (f: { name: string; fieldType: string }) => boolean) =>
  (def.fields ?? []).some(pred)

/** Sections a developer's component plausibly wants, given its schema. */
export function suggestSectionsFor(
  def: SuggestDef,
  allowed: string[],
  mintKey: () => string,
): SectionSuggestion[] {
  // The starter gallery already covers the kit; suggesting over it would
  // just duplicate B-T7.
  if (!def?.name || def.name.startsWith('kit.')) return []
  if (!allowed.includes('kit.section') || !allowed.includes(def.name)) return []

  const label = def.label || def.name
  const one = () => ({ _key: mintKey(), _type: def.name })
  const section = (props: Record<string, unknown>, children: unknown[]) => ({
    _key: mintKey(), _type: 'kit.section', padding: 'lg', width: 'normal', ...props, children,
  })

  const out: SectionSuggestion[] = []

  // Always: the component in a section that gives it a box.
  out.push({ id: `suggest:${def.name}:plain`, name: `${label} section`, block: section({}, [one()]) })

  // Its own headline means it can carry a band on its own.
  if (has(def, (f) => f.fieldType === 'text' && HEADLINE_NAMES.includes(f.name.toLowerCase()))) {
    out.push({
      id: `suggest:${def.name}:banner`,
      name: `${label} banner`,
      block: section({ background: 'brand', padding: 'xl' }, [one()]),
    })
  }

  // A relation means it renders ONE record - several side by side is the
  // obvious composition. A repeater means it already lists, so a grid of
  // lists would be wrong.
  const rendersOne = has(def, (f) => f.fieldType === 'relation')
  const repeatsItself = has(def, (f) => f.fieldType === 'repeater')
  if (rendersOne && !repeatsItself && allowed.includes('kit.row')) {
    out.push({
      id: `suggest:${def.name}:grid`,
      name: `${label} grid`,
      block: section({}, [{
        _key: mintKey(), _type: 'kit.row', layout: '3', gap: 'md', align: 'top',
        col1: [one()], col2: [one()], col3: [one()],
      }]),
    })
  }

  return out
}
