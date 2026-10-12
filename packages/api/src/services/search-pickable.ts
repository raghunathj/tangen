/**
 * File Name: search-pickable.ts
 * Purpose: R1 — resolves the sources a recommendation rule can pin/hide for an
 *   audience: all content types (always), plus custom tables that opted into
 *   search (`CustomTableDefinition.search.recommendable`) for that audience.
 *
 * Author: Raghunath J
 * License: MIT
 */

export interface PickableSource {
  name: string
  label: string
  kind: 'content' | 'table'
}

interface TypeLike { name: string; label?: string }
interface TableLike { name: string; search?: { recommendable?: boolean; audience?: ('internal' | 'public')[] } }

/** Content types are always pickable; custom tables only when opted in for `audience`. */
export function resolvePickableSources(
  types: TypeLike[] | undefined,
  customTables: TableLike[] | undefined,
  audience: 'internal' | 'public',
): PickableSource[] {
  const out: PickableSource[] = []
  for (const t of types ?? []) out.push({ name: t.name, label: t.label ?? t.name, kind: 'content' })
  for (const ct of customTables ?? []) {
    const s = ct.search
    if (s?.recommendable && (s.audience ?? ['internal']).includes(audience)) {
      out.push({ name: ct.name, label: ct.name, kind: 'table' })
    }
  }
  return out
}
