/**
 * File Name: permissions-editor.tsx
 * Purpose: The one permissions UI for API keys — system resources, feature
 *          resources with per-item scoping (Forms, declared apiResources),
 *          and custom-route groups, rendered as grant-summarizing accordions
 *          with search, a plain-English readout of the selection, and
 *          full-access detection.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: state in/out is PermissionsFormState (lib/api-keys
 *          permissionsToState / buildPermissions). Any feature that reports
 *          items automatically gets "all items or specific items" override
 *          rows — Forms is just one instance.
 */
import { useState } from 'react'
import { IconPlus, IconSearch, IconInfo } from '@tangen/icons'
import type { FeatureResource, RouteResourceGroup } from '@tangen/types'
import { Button } from '@/components/ui/button'
import { PERMISSION_RESOURCES, type PermissionResource, type PermissionsFormState } from '@/lib/api-keys'
import { ActionPill, ItemOverrideRow, humanizeAction, type OverrideOption } from './primitives'
import { SettingsSection } from '@/components/settings/settings-section'
import { CheckTable, ObjectLevelTree, actionIcon, resourceIcon, RESOURCE_HELP } from '@/components/permissions/check-table'

const OBJECT_ACTIONS = ['read', 'read_draft', 'write', 'publish', 'delete']

export interface TypeDef { name: string; label?: string }

// ── Summaries ─────────────────────────────────────────────────────────────────

function summarize(actions: string[] | undefined, overrides = 0, noun = 'override'): string {
  const parts: string[] = []
  if (actions?.length) parts.push(actions.map(humanizeAction).join(', '))
  if (overrides > 0) parts.push(`+${overrides} ${noun}${overrides > 1 ? 's' : ''}`)
  return parts.length > 0 ? parts.join(' · ') : '0 selected'
}

// ── Full-access detection ─────────────────────────────────────────────────────

/** True when every action on every visible resource is granted. */
export function isFullAccessState(
  state: PermissionsFormState,
  features: FeatureResource[],
  groups: RouteResourceGroup[],
): boolean {
  for (const r of PERMISSION_RESOURCES) {
    // Toolbar (performance headers) is an observability opt-in, not a data
    // permission - Full Access neither requires nor implies it.
    if (r.id === 'toolbar') continue
    const wanted = r.actions
    const granted = state.globalActions[r.id] ?? []
    if (!wanted.every((a) => granted.includes(a))) return false
  }
  for (const f of features) {
    const granted = (f.extensionId ? state.globalActions[f.id] : state.customRoutes[f.id]) ?? []
    if (!f.actions.every((a) => granted.includes(a))) return false
  }
  for (const g of groups) {
    const granted = state.customRoutes[g.id] ?? []
    if (!g.actions.every((a) => granted.includes(a))) return false
  }
  return true
}

// ── Plain-English readout ─────────────────────────────────────────────────────

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function actionPhrase(actions: string[]): string {
  return listJoin(actions.map((a) => humanizeAction(a).toLowerCase()))
}

/** Capitalize only the first character — for sentences built from phrases. */
function sentence(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/**
 * Translates the current selection into sentences an admin can sanity-check,
 * e.g. "Read all objects, except Post: read and write only."
 */
export function describePermissions(
  state: PermissionsFormState,
  types: TypeDef[],
  features: FeatureResource[],
  groups: RouteResourceGroup[],
): string[] {
  const lines: string[] = []
  const typeLabel = (name: string) => types.find((t) => t.name === name)?.label ?? name

  const obj = state.globalActions.objects ?? []
  if (obj.length > 0) lines.push(`${sentence(actionPhrase(obj))} all object types.`)
  for (const o of state.typeOverrides) {
    lines.push(o.actions.length > 0
      ? `${typeLabel(o.type)} objects: ${actionPhrase(o.actions)} only${obj.length > 0 ? ' (overrides the grant above)' : ''}.`
      : `${typeLabel(o.type)} objects: denied.`)
  }

  const media = state.globalActions.media ?? []
  if (media.length > 0) lines.push(`${sentence(actionPhrase(media))} media.`)

  // An extension's scope (Forms, say): its actions and per-item overrides.
  for (const f of features.filter((x) => x.extensionId)) {
    const granted = state.globalActions[f.id] ?? []
    const itemName = (item: string) => f.items.find((i) => (i.slug ?? i.id) === item)?.name ?? item
    if (granted.length > 0) lines.push(`${sentence(actionPhrase(granted))} all ${f.label.toLowerCase()}.`)
    for (const o of state.extensionOverrides[f.id] ?? []) {
      lines.push(o.actions.length > 0
        ? `${f.label} - “${itemName(o.item)}”: ${actionPhrase(o.actions)} only${granted.length > 0 ? ' (overrides the grant above)' : ''}.`
        : `${f.label} - “${itemName(o.item)}”: denied.`)
    }
  }

  if ((state.globalActions.search ?? []).length > 0) lines.push('Search published content.')
  const globals = state.globalActions.globals ?? []
  if (globals.length > 0) lines.push(`${sentence(actionPhrase(globals))} globals.`)
  const schema = state.globalActions.schema ?? []
  if (schema.length > 0) lines.push(`${sentence(actionPhrase(schema))} the schema.`)

  for (const res of [...features.filter((f) => !f.extensionId), ...groups]) {
    const granted = state.customRoutes[res.id] ?? []
    if (granted.length > 0) lines.push(`${sentence(actionPhrase(granted))} on ${res.label}.`)
    const feature = features.find((f) => f.id === res.id)
    for (const row of state.resourceOverrides[res.id] ?? []) {
      const itemName = feature?.items.find((i) => (i.slug ?? i.id) === row.item)?.name ?? row.item
      lines.push(row.actions.length > 0
        ? `${res.label} - “${itemName}”: ${actionPhrase(row.actions)} only.`
        : `${res.label} - “${itemName}”: denied.`)
    }
  }

  return lines
}

// ── Override semantics tooltip ────────────────────────────────────────────────

function OverrideInfo({ itemNoun }: { itemNoun: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="text-fg-faint hover:text-fg-muted cursor-pointer"
        aria-label="How overrides work"
      >
        <IconInfo className="size-3.5" />
      </button>
      {open && (
        <span className="absolute left-5 top-1/2 -translate-y-1/2 z-20 w-72 rounded-lg border border-border bg-surface p-3 text-xs text-fg-muted shadow-lg font-normal normal-case">
          The global actions above apply to <b>every</b> {itemNoun}. Adding an override
          <b> replaces</b> those actions for that one {itemNoun} - it can grant more or
          less. An override with nothing selected denies that {itemNoun} entirely.
        </span>
      )}
    </span>
  )
}

// ── Override list (add/edit/remove rows for one resource) ────────────────────

function OverrideList({
  rows, options, actions, itemNoun, onChange,
}: {
  rows: { item: string; actions: string[] }[]
  options: OverrideOption[]
  actions: string[]
  itemNoun: string
  onChange: (rows: { item: string; actions: string[] }[]) => void
}) {
  const used = rows.map((r) => r.item)

  function add() {
    const next = options.find((o) => !used.includes(o.value))
    if (next) onChange([...rows, { item: next.value, actions: [] }])
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          Per-{itemNoun} overrides
          <OverrideInfo itemNoun={itemNoun} />
        </p>
        <Button
          size="xs"
          variant="secondary"
          icon={<IconPlus className="size-3.5" />}
          onClick={add}
          disabled={rows.length >= options.length}
        >
          Add override
        </Button>
      </div>
      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <ItemOverrideRow
              key={idx}
              value={row.item}
              options={options}
              usedValues={used}
              actions={actions}
              selectedActions={row.actions}
              onValueChange={(v) => onChange(rows.map((r, i) => i === idx ? { ...r, item: v } : r))}
              onActionToggle={(a) => onChange(rows.map((r, i) => i === idx
                ? { ...r, actions: r.actions.includes(a) ? r.actions.filter((x) => x !== a) : [...r.actions, a] }
                : r))}
              onRemove={() => onChange(rows.filter((_, i) => i !== idx))}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-fg-subtle">No overrides - all {itemNoun}s use the global actions above.</p>
      )}
    </div>
  )
}

// ── Editor ────────────────────────────────────────────────────────────────────

export function PermissionsEditor({
  state, onChange, types, features, groups, featureActionsOverride, subject = 'key',
  extraResources, hiddenResources,
}: {
  state: PermissionsFormState
  onChange: (next: PermissionsFormState) => void
  /** Object types for per-type overrides. */
  types: TypeDef[]
  /** Feature resources from /route-resources: extension scopes (extensionId set) and declared apiResources. */
  features: FeatureResource[]
  /** Custom-route groups from /route-resources. */
  groups: RouteResourceGroup[]
  /** Current env slug — filters env-scoped feature items. */
  /**
   * Extra/replacement action lists per resource id (a system one or an extension's).
   */
  featureActionsOverride?: Record<string, string[]>
  /** Noun in the plain-English readout heading ('key' default; roles pass 'role'). */
  subject?: string
  /**
   * Additional resource sections rendered alongside the system ones — e.g.
   * the role editor adds Site Users (read/write) when the auth extension is
   * active. State rides globalActions under the resource id.
   */
  extraResources?: PermissionResource[]
  /** System resource ids to hide (auth on a role, toolbar). */
  hiddenResources?: string[]
}) {
  // Extension scopes (manifest apiKeyScope) ride globalActions + extensionOverrides;
  // declared resources (defineApiResource) ride customRoutes + resourceOverrides.
  const extensionFeatures = features.filter((f) => f.extensionId)
  const declared = features.filter((f) => !f.extensionId)

  const [filter, setFilter] = useState('')
  const matches = (label: string) => label.toLowerCase().includes(filter.trim().toLowerCase())

  const patch = (p: Partial<PermissionsFormState>) => onChange({ ...state, ...p })

  function toggleGlobal(resource: string, action: string) {
    const cur = state.globalActions[resource] ?? []
    patch({
      globalActions: {
        ...state.globalActions,
        [resource]: cur.includes(action) ? cur.filter((a) => a !== action) : [...cur, action],
      },
    })
  }

  function toggleRouteAction(groupId: string, action: string) {
    const cur = state.customRoutes[groupId] ?? []
    patch({
      customRoutes: {
        ...state.customRoutes,
        [groupId]: cur.includes(action) ? cur.filter((a) => a !== action) : [...cur, action],
      },
    })
  }

  const hidden = new Set(hiddenResources ?? [])
  const systemResources = [
    ...PERMISSION_RESOURCES.filter((r) => !hidden.has(r.id)),
    ...(extraResources ?? []),
  ]
  const description = describePermissions(state, types, features, groups)
  const visibleSystem = systemResources.filter((r) => matches(r.label))
  const visibleExtensions = extensionFeatures.filter((f) => matches(f.label))
  const visibleDeclared = declared.filter((f) => matches(f.label))
  const visibleGroups = groups.filter((g) => matches(g.label))
  const nothingMatches = visibleSystem.length + visibleExtensions.length + visibleDeclared.length + visibleGroups.length === 0

  const actionsOf = (resource: PermissionResource) => featureActionsOverride?.[resource.id] ?? resource.actions
  const setGlobal = (resource: string, actions: string[]) => patch({ globalActions: { ...state.globalActions, [resource]: actions } })
  const setRoute = (id: string, actions: string[]) => patch({ customRoutes: { ...state.customRoutes, [id]: actions } })
  const noun = (r: PermissionResource) => r.id === 'objects' ? 'records' : r.label.toLowerCase()

  // The benchmark's permission page (2026-09-08): one section per resource -
  // a select-all caption row, a checkbox row per action, and for Objects the
  // object-level tree; per-form and per-item overrides keep their picker rows.
  return (
    <div className="space-y-10">
      {/* Search */}
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <input
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
          placeholder="Search permissions…"
          aria-label="Search permissions"
          className="h-8 w-full rounded-control border border-border bg-surface-raised pl-8 pr-2 text-ui outline-none placeholder:text-fg-subtle transition-colors motion-fast focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25"
        />
      </div>

      {nothingMatches && (
        <p className="py-4 text-center text-sm text-fg-subtle">No permissions match “{filter}”.</p>
      )}

      {/* System resources */}
      {visibleSystem.map((resource) => (
        <SettingsSection key={resource.id} title={resource.label} description={RESOURCE_HELP[resource.id] ?? `What this ${subject} may do with ${resource.label.toLowerCase()}.`} flush>
          <div className="divide-y divide-border-subtle">
            <CheckTable
              caption={<span className="inline-flex items-center gap-2"><span className="text-fg-subtle [&_svg]:size-4" aria-hidden>{resourceIcon(resource.id)}</span>All {resource.label.toLowerCase()}</span>}
              rows={actionsOf(resource).map((a) => ({ id: a, icon: actionIcon(a), label: resource.id === 'toolbar' ? humanizeAction(a) : `${humanizeAction(a)} ${noun(resource)}` }))}
              checked={(a) => (state.globalActions[resource.id] ?? []).includes(a)}
              onToggle={(a) => toggleGlobal(resource.id, a)}
              onToggleAll={(on) => setGlobal(resource.id, on ? [...actionsOf(resource)] : [])}
            />
            {resource.id === 'objects' && (
              <ObjectLevelTree
                types={types}
                actions={actionsOf(resource)}
                globalActions={state.globalActions.objects ?? []}
                overrides={state.typeOverrides}
                onChange={(next) => patch({ typeOverrides: next })}
              />
            )}
          </div>
        </SettingsSection>
      ))}

      {/* Extension scopes - the manifest's apiKeyScope, items from the extension's server */}
      {visibleExtensions.map((feature) => {
        const itemOptions: OverrideOption[] = feature.items.map((i) => ({ value: i.slug ?? i.id, label: i.name }))
        const actions = featureActionsOverride?.[feature.id] ?? feature.actions
        return (
          <SettingsSection key={feature.id} title={feature.label} description={feature.description ?? `What this ${subject} may do with ${feature.label.toLowerCase()}.`} flush>
            <div className="divide-y divide-border-subtle">
              <CheckTable
                caption={`All ${feature.label.toLowerCase()}`}
                rows={actions.map((a) => ({ id: a, icon: actionIcon(a), label: `${humanizeAction(a)} ${feature.label.toLowerCase()}` }))}
                checked={(a) => (state.globalActions[feature.id] ?? []).includes(a)}
                onToggle={(a) => toggleGlobal(feature.id, a)}
                onToggleAll={(on) => setGlobal(feature.id, on ? [...actions] : [])}
              />
              {itemOptions.length > 0 && (
                <div className="px-4 py-3">
                  <OverrideList
                    rows={state.extensionOverrides[feature.id] ?? []}
                    options={itemOptions}
                    actions={actions}
                    itemNoun={feature.label.toLowerCase().replace(/s$/, '') || 'item'}
                    onChange={(rows) => patch({ extensionOverrides: { ...state.extensionOverrides, [feature.id]: rows } })}
                  />
                </div>
              )}
            </div>
          </SettingsSection>
        )
      })}

      {/* Declared resources - defineApiResource() */}
      {visibleDeclared.map((feature) => {
        const itemOptions: OverrideOption[] = feature.items.map((i) => ({ value: i.slug ?? i.id, label: i.name }))
        const rows = state.resourceOverrides[feature.id] ?? []
        return (
          <SettingsSection key={feature.id} title={feature.label} description={feature.description ?? 'A resource the site declares in code.'} flush>
            <div className="divide-y divide-border-subtle">
              <CheckTable
                caption={`All ${feature.label.toLowerCase()}`}
                rows={feature.actions.map((a) => ({ id: a, icon: actionIcon(a), label: humanizeAction(a) }))}
                checked={(a) => (state.customRoutes[feature.id] ?? []).includes(a)}
                onToggle={(a) => toggleRouteAction(feature.id, a)}
                onToggleAll={(on) => setRoute(feature.id, on ? [...feature.actions] : [])}
              />
              {itemOptions.length > 0 && (
                <div className="px-4 py-3">
                  <OverrideList
                    rows={rows}
                    options={itemOptions}
                    actions={feature.actions}
                    itemNoun="item"
                    onChange={(next) => patch({ resourceOverrides: { ...state.resourceOverrides, [feature.id]: next } })}
                  />
                </div>
              )}
            </div>
          </SettingsSection>
        )
      })}

      {/* Custom-route groups (inline apiGroup declarations) */}
      {visibleGroups.map((group) => (
        <SettingsSection key={group.id} title={group.label} description={group.description ?? 'Routes the site declares in code.'} flush>
          <CheckTable
            caption={`All ${group.label.toLowerCase()}`}
            rows={group.actions.map((a) => ({ id: a, icon: actionIcon(a), label: humanizeAction(a) }))}
            checked={(a) => (state.customRoutes[group.id] ?? []).includes(a)}
            onToggle={(a) => toggleRouteAction(group.id, a)}
            onToggleAll={(on) => setRoute(group.id, on ? [...group.actions] : [])}
          />
        </SettingsSection>
      ))}

      {/* Plain-English readout */}
      <div className="rounded-xl border border-border bg-surface-sunken px-4 py-3">
        <p className="text-xs font-medium text-fg-muted mb-1.5">This {subject} will be able to:</p>
        {description.length > 0 ? (
          <ul className="space-y-0.5">
            {description.map((line, i) => (
              <li key={i} className="text-xs text-fg-muted flex gap-1.5">
                <span className="text-accent">•</span> {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-fg-subtle">Nothing yet - select permissions above.</p>
        )}
      </div>
    </div>
  )
}
