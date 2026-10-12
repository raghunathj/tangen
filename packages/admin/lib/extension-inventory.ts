/**
 * File Name: extension-inventory.ts
 * Purpose: What Settings > Extensions says about each installation, as rules
 *          rather than as JSX - so the two facts an operator acts on are
 *          testable without a browser:
 *
 *          - its STATE: running, switched off here, or installed with its code
 *            no longer present (the row that explains an unexplainable
 *            workspace);
 *          - whether a newer version exists, which is TWO different questions:
 *            the code in this project already ships a newer manifest (an
 *            upgrade the platform runs itself, with migrations and a grant
 *            review), or the registry has a newer package (which only a
 *            dependency install can fetch).
 *
 * Author: Raghunath J
 * License: MIT
 */

export interface ExtensionRow {
  extensionId: string
  name: string
  description?: string
  author?: string
  homepage?: string
  license?: string
  icon?: string
  /** A connector pack's own brand mark, as an inline image. */
  brandIcon?: string
  kind: 'extension' | 'connector-pack'
  version: string | null
  codeVersion: string | null
  state: string
  enabled: boolean
  settings: boolean
  package: string | null
  installedAt?: string | null
  installedBy?: string | null
  upgradedAt?: string | null
}

export interface UpdateVerdict {
  extensionId: string
  current: string | null
  latest: string | null
  updateAvailable: boolean
  package: string | null
  message?: string
}

export type ExtensionState = 'running' | 'disabled' | 'code-missing' | 'retired'

export interface StateVerdict {
  state: ExtensionState
  label: string
  tone: 'success' | 'warning' | 'error' | 'neutral'
  /** What it means, for the row's title and the sheet. */
  detail: string
}

/** One derivation of the badge, so the table and the sheet cannot disagree. */
export function extensionState(row: ExtensionRow): StateVerdict {
  if (row.state !== 'installed') {
    return {
      state: 'retired', label: 'Retired', tone: 'neutral',
      detail: 'Uninstalled here. Its data is kept, so installing it again adopts what was left behind.',
    }
  }
  if (row.codeVersion === null) {
    return {
      state: 'code-missing', label: 'Code missing', tone: 'error',
      detail: 'Installed in this workspace, but its code is not in the project any more. Add its package back, or uninstall it to release what it owns.',
    }
  }
  if (!row.enabled) {
    return {
      state: 'disabled', label: 'Disabled', tone: 'warning',
      detail: 'Installed and switched off here. It contributes nothing - no routes, no hooks, no pages - and its data is untouched.',
    }
  }
  return { state: 'running', label: 'Enabled', tone: 'success', detail: 'Running in this workspace.' }
}

export interface VersionVerdict {
  /** The version this installation runs, or null when nothing was recorded. */
  running: string | null
  /** The code ships this and the installation has not caught up: upgrade here. */
  upgradeTo: string | null
  /** The registry has this: update the package, then upgrade. */
  updateTo: string | null
}

/**
 * The version story for one row. `upgradeTo` is only ever set from the code in
 * the project, and `updateTo` only from a registry answer - conflating them
 * would tell an operator to click a button that cannot help.
 */
export function versionVerdict(row: ExtensionRow, update?: UpdateVerdict): VersionVerdict {
  const running = row.version ?? null
  const upgradeTo = row.codeVersion && running && row.codeVersion !== running ? row.codeVersion : null
  // A registry version that the code already ships is not news: the upgrade
  // above is the actionable half.
  const updateTo = update?.updateAvailable && update.latest && update.latest !== row.codeVersion ? update.latest : null
  return { running, upgradeTo, updateTo }
}

/** Alphabetical by name, so a list of twenty is scannable. Pure. */
export function sortExtensions(rows: ExtensionRow[]): ExtensionRow[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name))
}

/** The rows a search and the status/kind facets leave. */
export function filterExtensions(
  rows: ExtensionRow[],
  opts: { search?: string; states?: string[]; kinds?: string[]; statesNegated?: boolean; kindsNegated?: boolean },
): ExtensionRow[] {
  const needle = (opts.search ?? '').trim().toLowerCase()
  return rows.filter((row) => {
    if (needle !== '') {
      const haystack = `${row.name} ${row.extensionId} ${row.description ?? ''} ${row.author ?? ''}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    if (opts.states?.length) {
      const has = opts.states.includes(extensionState(row).state)
      if (has === Boolean(opts.statesNegated)) return false
    }
    if (opts.kinds?.length) {
      const has = opts.kinds.includes(row.kind)
      if (has === Boolean(opts.kindsNegated)) return false
    }
    return true
  })
}
