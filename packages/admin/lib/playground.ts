/**
 * File Name: playground.ts
 * Purpose: PG-1 — pure helpers for the merged API Playground takeover: tab
 *          resolution from the URL, the exit target (remembered origin →
 *          dashboard fallback), and {{variable}} interpolation used by both
 *          the REST and GraphQL tabs (PG-3).
 *
 * Author: Raghunath J
 * License: MIT
 */

export type PlaygroundTab = 'rest' | 'graphql'

/** ?tab= resolution — anything but 'graphql' is the REST tab. */
export function playgroundTab(searchParams: URLSearchParams): PlaygroundTab {
  return searchParams.get('tab') === 'graphql' ? 'graphql' : 'rest'
}

/**
 * Where Exit goes: the remembered in-admin origin when we have one, else the
 * workspace dashboard. The origin is captured on entry (location.state.from)
 * so deep links / hard reloads still exit somewhere sensible.
 */
export function exitTarget(opts: { workspaceId: string; from?: string | null }): string {
  const dashboard = `/${opts.workspaceId}`
  if (!opts.from) return dashboard
  // Never exit back into the playground itself
  if (opts.from.includes('/devspace/playground') || opts.from.includes('/devspace/graphql')) return dashboard
  return opts.from
}

/** {{name}} placeholders present in a string. */
export function placeholdersIn(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)) out.add(m[1])
  return [...out]
}

/** Replaces {{name}} with values; unknown names are left verbatim. */
export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (raw, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : raw)
}

/** Placeholders across every request surface that have NO value set. */
export function unresolvedPlaceholders(
  surfaces: Array<string | null | undefined>,
  vars: Record<string, string>,
): string[] {
  const missing = new Set<string>()
  for (const s of surfaces) {
    if (!s) continue
    for (const name of placeholdersIn(s)) {
      if (!Object.prototype.hasOwnProperty.call(vars, name)) missing.add(name)
    }
  }
  return [...missing]
}

/** A key/value editor row (Params and Headers tabs). */
export interface KVRow { key: string; value: string; enabled: boolean }

/** Enabled, non-empty rows → a record (later keys win). */
export function rowsToRecord(rows: KVRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    const k = r.key.trim()
    if (!r.enabled || !k) continue
    out[k] = r.value
  }
  return out
}

/** Catalog search — matches group, label, method, or path (case-insensitive). */
export function filterCatalog<G extends { group: string; endpoints: Array<{ label: string; method: string; path: string }> }>(
  groups: G[],
  q: string,
): G[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return groups
  return groups
    .map((g) => ({
      ...g,
      endpoints: g.endpoints.filter((e) =>
        g.group.toLowerCase().includes(needle)
        || e.label.toLowerCase().includes(needle)
        || e.method.toLowerCase().includes(needle)
        || e.path.toLowerCase().includes(needle)),
    }))
    .filter((g) => g.endpoints.length > 0)
}

/**
 * Bulk-edit serialization (Postman-style): one `key: value` per line; a line
 * prefixed with `//` is a disabled row; blank lines are skipped.
 */
export function kvRowsToBulkText(rows: KVRow[]): string {
  return rows
    .filter((r) => r.key.trim() !== '')
    .map((r) => `${r.enabled ? '' : '//'}${r.key.trim()}: ${r.value}`)
    .join('\n')
}

/** Parses bulk text back into rows. Lines without a colon become key-only rows. */
export function bulkTextToKvRows(text: string): KVRow[] {
  const rows: KVRow[] = []
  for (const raw of text.split('\n')) {
    let line = raw.trim()
    if (!line) continue
    let enabled = true
    if (line.startsWith('//')) { enabled = false; line = line.slice(2).trim() }
    if (!line) continue
    const colon = line.indexOf(':')
    const key = (colon === -1 ? line : line.slice(0, colon)).trim()
    const value = colon === -1 ? '' : line.slice(colon + 1).trim()
    if (!key) continue
    rows.push({ key, value, enabled })
  }
  return rows
}
