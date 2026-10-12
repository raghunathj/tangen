/**
 * File Name: connection-picker.tsx
 * Purpose: The two controls an operator configures an integration with
 *          (plan-connectors B3): WHICH connection, and WHICH resource inside
 *          it. Both store ids, never labels, so renaming a connection changes
 *          no stored configuration. Both read the platform's own picker
 *          routes, so the credential never comes near the browser, and both
 *          render the ONE state derivation - an unavailable integration
 *          explains itself here with the same sentence Settings shows, and
 *          offers the same fix.
 *
 *          The same pair backs an extension's settings form, a Flows node and
 *          anything a site developer builds on the kit, because a picker that
 *          works in one place teaches a rule with holes in it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @/kit primitives + adminFetch. No provider knowledge.
 *
 *          A refusal is rendered as a REFUSAL. An operator configuring an
 *          integration needs to see that something is wrong and what to do,
 *          not read it as a hint in the same grey as the placeholder text -
 *          so anything actionable goes through the kit's Callout, with the
 *          platform's own reason as the title and its fix underneath.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Select, SelectItem, SearchSelect, Button, Callout, Text, TEXT_LINK } from '@tangen/ui'
import { Spinner } from '@/kit/primitives'
import { adminFetch, ApiError } from '@/lib/api'

export interface PickableConnection {
  id: string
  label: string
  provider: string
  connectorId: string
  state: {
    state: 'pending' | 'connected' | 'needs_capability' | 'degraded' | 'revoked' | 'unreadable' | 'dormant'
    reason: string
    fix?: { action: string; hint: string; extensionIds?: string[] }
    authorizationKnown: boolean
  }
  /** The pack's own mark, inline: the same identity the Connections page shows. */
  brand?: { icon?: string; color?: string }
}

interface PickableAnswer {
  data: PickableConnection[]
  meta: {
    provider: string | null
    offered: Array<{ provider: string; connectorId: string; label: string; extensionId: string }>
    conflicts: Array<{ provider: string; extensionIds: string[] }>
    resources: Array<{ provider: string; type: string; label: string; parent: string | null }>
  }
}

/** One fetch per (workspace, provider, capabilities), shared by every picker on the page. */
function usePickable(provider: string, capabilities?: readonly string[]) {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const caps = (capabilities ?? []).join(',')
  const [answer, setAnswer] = useState<PickableAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const params = new URLSearchParams({ provider })
    if (caps) params.set('capabilities', caps)
    try {
      setAnswer(await adminFetch<PickableAnswer>(`/admin/workspaces/${workspaceId}/connections/pickable?${params.toString()}`))
    } catch (e) {
      setError((e as Error).message || 'The connections could not be loaded.')
    } finally { setLoading(false) }
  }, [workspaceId, provider, caps])

  useEffect(() => { void load() }, [load])
  return { answer, error, loading, reload: load, workspaceId }
}

/**
 * The tone a failure deserves. A missing capability, a dormant pack or a
 * provider conflict are all things an operator fixes, so they warn rather
 * than alarm; anything else went wrong and says so.
 */
const FIXABLE = new Set(['CONNECTION_CAPABILITY', 'PROVIDER_CONFLICT', 'CONFLICT', 'VALIDATION_ERROR', 'PROVIDER_REFUSED'])

/** A short heading per kind of refusal. The sentence belongs in the body. */
const HEADING: Record<string, string> = {
  CONNECTION_CAPABILITY: 'Not authorized',
  PROVIDER_CONFLICT: 'Two extensions offer this',
  CONFLICT: 'Unavailable',
  VALIDATION_ERROR: 'Not ready',
  // The provider said no, and usually said why. Not a platform failure.
  PROVIDER_REFUSED: 'The provider refused',
}

/**
 * One refusal, in a column narrow enough for a flow node's config panel.
 *
 * Two things this gets right that the first attempt did not: the TITLE is two
 * or three words, because a wrapped sentence in a title's leading reads as a
 * broken heading; and a retry sits BELOW the text rather than in the callout's
 * action column, which in a 280px panel squeezed the sentence into a third of
 * the width.
 */
function Refusal({ message, hint, code, onRetry }: { message: string; hint?: string; code?: string; onRetry?: () => void }) {
  const fixable = code !== undefined && FIXABLE.has(code)
  return (
    // `compact` in a field's column: the icon chip costs a third of the width
    // in a flow node's panel, and the title already carries the tone.
    <Callout compact variant={fixable ? 'warning' : 'danger'} title={HEADING[code ?? ''] ?? (fixable ? 'Not ready' : 'Something went wrong')}>
      <p>{message}{hint ? ` ${hint}` : ''}</p>
      {onRetry && (
        <Button className="mt-2" variant="secondary" size="xs" onClick={onRetry}>Try again</Button>
      )}
    </Callout>
  )
}

export interface ConnectionPickerProps {
  /** The provider to pick within: `google`, `slack`. */
  provider: string
  /** The stored value: a connection id, never a label. */
  value: string | null
  onChange: (connectionId: string | null) => void
  /** Capabilities the thing being configured needs, so an unauthorized connection says so. */
  capabilities?: readonly string[]
  id?: string
  disabled?: boolean
}

/** Which connection. */
export function ConnectionPicker({ provider, value, onChange, capabilities, id, disabled }: ConnectionPickerProps) {
  const { answer, error, loading, reload, workspaceId } = usePickable(provider, capabilities)
  const rows = answer?.data ?? []
  const chosen = rows.find((r) => r.id === value)
  const conflict = answer?.meta.conflicts[0]
  const offered = (answer?.meta.offered ?? []).length > 0

  if (loading) return <div className="flex h-8 items-center gap-2 text-fg-subtle"><Spinner size="sm" /><span className="text-ui-xs">Loading connections</span></div>
  if (error) return <Refusal message={error} onRetry={() => { void reload() }} />

  // Nothing to pick: say which of the reasons it is, and where to go. Each of
  // these stops the operator, so each is a callout rather than a hint.
  if (conflict) {
    return (
      <Refusal
        code="PROVIDER_CONFLICT"
        message={`${conflict.extensionIds.join(' and ')} each offer ${provider}, so none of its connections can be used. Disable one of them under Extensions.`}
      />
    )
  }
  if (!offered) {
    return (
      <Callout compact variant="warning" title={`No ${provider} connector installed`}>
        <p>{`Nothing installed here offers ${provider}, so there is nothing to connect to yet.`}</p>
        <Link to={`/${workspaceId}/settings/extensions`}>
          <Button className="mt-2" variant="secondary" size="xs">See installed extensions</Button>
        </Link>
      </Callout>
    )
  }
  if (rows.length === 0) {
    return (
      <Callout variant="warning" title="Not connected">
        <p>{`${provider} is available here, and nothing is connected to it yet.`}</p>
        <Link to={`/${workspaceId}/settings/connections`}>
          <Button className="mt-2" variant="secondary" size="xs">{`Connect ${provider}`}</Button>
        </Link>
      </Callout>
    )
  }

  return (
    <div className="space-y-1.5">
      <Select
        id={id}
        value={value ?? ''}
        onValueChange={(v) => onChange(v || null)}
        disabled={disabled}
        placeholder="Choose a connection"
        aria-label={`${provider} connection`}
        {...(value ? { onClear: () => onChange(null) } : {})}
      >
        {rows.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            <span className="flex items-center gap-2">
              {/* The pack's own mark, inline from the connector - so a Slack
                  connection and a Google one are told apart at a glance, here
                  and on the Connections page alike (the user, 2026-09-19). */}
              {r.brand?.icon && <img src={r.brand.icon} alt="" width={16} height={16} className="shrink-0 rounded-[3px]" />}
              {r.state.state === 'connected' ? r.label : `${r.label} (${r.state.state.replace(/_/g, ' ')})`}
            </span>
          </SelectItem>
        ))}
      </Select>
      {/* A chosen connection that cannot do the job is the most important
          thing on the form: the flow will refuse at its first run otherwise. */}
      {chosen && chosen.state.state !== 'connected' && (
        <Refusal
          code={chosen.state.state === 'needs_capability' ? 'CONNECTION_CAPABILITY' : 'CONFLICT'}
          message={chosen.state.reason}
          {...(chosen.state.fix ? { hint: chosen.state.fix.hint } : {})}
        />
      )}
      {/* One click to where connections are added and repaired - an operator
          reading "add one under Settings, Connections" should not have to go
          and find it (the user, 2026-09-20). */}
      <Text variant="help">
        <Link className={TEXT_LINK} to={`/${workspaceId}/settings/connections`}>{`Manage ${provider} connections`}</Link>
      </Text>
    </div>
  )
}

export interface ResourcePickerProps {
  /** The connection to look inside: a resource has no meaning without one. */
  connectionId: string | null
  /** The connector's resource type: `spreadsheet`, `tab`, `channel`. */
  type: string
  value: string | null
  onChange: (resourceId: string | null) => void
  /** The selected id of the parent type, when this one is listed within another. */
  parent?: string | null
  id?: string
  disabled?: boolean
  label?: string
  /** What the parent field is called, so a waiting message can name it. */
  parentLabel?: string
}

interface ResourceAnswer {
  data: Array<{ id: string; label: string; hint?: string; disabled?: { reason: string } }>
  meta: { type: string; label: string; limit: number; nextCursor?: string; truncated?: boolean }
}

/**
 * Which thing inside it: ONE control, with the search where the options are.
 * A separate search box above a select reads as two controls for one
 * decision, and in a narrow panel it doubles the height of every field.
 */
export function ResourcePicker({ connectionId, type, value, onChange, parent, id, disabled, label, parentLabel }: ResourcePickerProps) {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState<ResourceAnswer | null>(null)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (q: string, cursor?: string) => {
    if (!connectionId) { setAnswer(null); return }
    setLoading(true); setError(null)
    const params = new URLSearchParams()
    if (q) params.set('query', q)
    if (cursor) params.set('cursor', cursor)
    if (parent) params.set('parent', parent)
    try {
      const res = await adminFetch<ResourceAnswer>(`/admin/workspaces/${workspaceId}/connections/${connectionId}/resources/${type}?${params.toString()}`)
      setAnswer((prev) => (cursor && prev ? { data: [...prev.data, ...res.data], meta: res.meta } : res))
    } catch (e) {
      // The platform's own code decides the tone: a consent gap is fixable,
      // a provider refusing is the provider's, anything else is a failure.
      const err = e as ApiError
      setError({ message: err.message || 'That list could not be loaded.', ...(err.code ? { code: err.code } : {}) })
    } finally { setLoading(false) }
  }, [workspaceId, connectionId, type, parent])

  // The first page as soon as there is something to ask about; the search
  // itself is settled inside SearchSelect, so typing is not a request each.
  useEffect(() => { void load(query) }, [load])

  const options = (answer?.data ?? []).map((o) => ({
    value: o.id, label: o.label,
    ...(o.hint ? { hint: o.hint } : {}),
    ...(o.disabled ? { disabled: o.disabled } : {}),
  }))
  const name = (label ?? answer?.meta.label ?? type).toLowerCase()

  // Not yet answerable is a hint, not a refusal: the operator is mid-way
  // through the form and nothing is wrong.
  if (!connectionId) return <Text variant="help">Choose a connection first.</Text>
  if (parent === null) return <Text variant="help">{`Choose a ${parentLabel ?? 'spreadsheet'} first.`}</Text>
  // A refused listing, though, stops the operator here.
  if (error) return <Refusal code={error.code} message={error.message} onRetry={() => { void load(query) }} />

  return (
    <SearchSelect
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      loading={loading}
      onSearch={(q) => { setQuery(q); void load(q) }}
      {...(answer?.meta.nextCursor ? { onMore: () => { void load(query, answer.meta.nextCursor) } } : {})}
      placeholder={`Choose a ${name}`}
      searchPlaceholder={`Search ${name}`}
      aria-label={label ?? answer?.meta.label ?? type}
      // A value chosen earlier is shown even when the current search does not
      // include it, because what is stored is an id.
      {...(value && !options.some((o) => o.value === value) ? { selectedLabel: value } : {})}
      disabled={disabled}
    />
  )
}
